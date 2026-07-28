/**
 * auth.test.ts — Unit tests for BE-55 merchant authentication.
 *
 * Tests cover:
 *   1. generateChallenge — format, nonce uniqueness, expiry
 *   2. verifyChallenge   — valid flow, replay prevention, failure cases
 *   3. issueMerchantJwt  — payload shape, expiry
 *   4. verifyMerchantJwt — valid, expired, tampered, wrong secret
 *   5. requireMerchant   — middleware happy path and all 401/503 cases
 *   6. End-to-end        — full challenge → sign → token → middleware flow
 *
 * @stellar/stellar-sdk is mocked with a lightweight Node-crypto-backed
 * implementation (tests/helpers/stellarMock.ts) to avoid Jest's ESM
 * incompatibility with @noble/hashes and uint8array-extras.
 */

import {
  MockKeypair,
  MockTransaction,
  MockTransactionBuilder,
  MockAccount,
  MockOperation,
  BASE_FEE,
  Networks,
} from './helpers/stellarMock';

// ─── Mock @stellar/stellar-sdk ────────────────────────────────────────────────
// Must be declared before importing authService so the module factory runs first.
jest.mock('@stellar/stellar-sdk', () => {
  const mock = require('./helpers/stellarMock');
  return {
    Keypair: mock.MockKeypair,
    Transaction: mock.MockTransaction,
    TransactionBuilder: mock.MockTransactionBuilder,
    Account: mock.MockAccount,
    Operation: mock.MockOperation,
    BASE_FEE: mock.BASE_FEE,
    Networks: mock.Networks,
  };
});

// Import auth modules after mock is registered
import {
  generateChallenge,
  verifyChallenge,
  issueMerchantJwt,
  verifyMerchantJwt,
  AuthError,
  JWT_TTL_SECONDS,
  _clearChallengesForTesting,
} from '../src/services/authService';
import { requireMerchant } from '../src/middleware/merchantAuth';

// ─── Constants ────────────────────────────────────────────────────────────────

const NETWORK = 'Test SDF Network ; September 2015';
const JWT_SECRET = 'test-jwt-secret-for-unit-tests-only';

// ─── Deterministic test keypairs ─────────────────────────────────────────────
// Generate once at module load; re-used across tests.
const KEYPAIR_ALICE = MockKeypair.random();
const ALICE = KEYPAIR_ALICE.publicKey();

const KEYPAIR_BOB = MockKeypair.random();
const BOB = KEYPAIR_BOB.publicKey();

// ─── Helper: generate challenge + sign with keypair ──────────────────────────

function signChallenge(account: string, keypair: MockKeypair, network = NETWORK): string {
  const record = generateChallenge(account, network);
  const tx = new MockTransaction(record.transactionXdr, network);
  tx.sign(keypair);
  return tx.toEnvelope().toXDR('base64');
}

// ─── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(() => {
  _clearChallengesForTesting();
});

afterEach(() => {
  _clearChallengesForTesting();
  delete process.env.JWT_SECRET;
});

// =============================================================================
// 1. generateChallenge
// =============================================================================

describe('generateChallenge', () => {
  it('returns a base64-decodable transaction XDR with correct source', () => {
    const record = generateChallenge(ALICE, NETWORK);

    expect(record.account).toBe(ALICE);
    expect(record.transactionXdr).toBeTruthy();

    const tx = new MockTransaction(record.transactionXdr, NETWORK);
    expect(tx.source).toBe(ALICE);
  });

  it('includes a ManageData operation with "SorobanPay auth" key', () => {
    const record = generateChallenge(ALICE, NETWORK);
    const tx = new MockTransaction(record.transactionXdr, NETWORK);

    const op = tx.operations.find(
      (o) => o.type === 'manageData' && o.name === 'SorobanPay auth',
    );
    expect(op).toBeDefined();
    expect(op!.value).toBeTruthy();
  });

  it('embeds the nonce from the record into the ManageData value', () => {
    const record = generateChallenge(ALICE, NETWORK);
    const tx = new MockTransaction(record.transactionXdr, NETWORK);

    const op = tx.operations.find((o) => o.type === 'manageData')!;
    const embedded = (op.value as Buffer).toString('hex');
    expect(embedded).toBe(record.nonce);
  });

  it('generates a unique nonce on each call', () => {
    const r1 = generateChallenge(ALICE, NETWORK);
    const r2 = generateChallenge(ALICE, NETWORK);
    expect(r1.nonce).not.toBe(r2.nonce);
  });

  it('sets expiresAt approximately 5 minutes in the future', () => {
    const before = Math.floor(Date.now() / 1000);
    const record = generateChallenge(ALICE, NETWORK);
    const after = Math.floor(Date.now() / 1000);

    expect(record.expiresAt).toBeGreaterThanOrEqual(before + 5 * 60);
    expect(record.expiresAt).toBeLessThanOrEqual(after + 5 * 60 + 1);
  });

  it('supersedes the previous challenge for the same account', () => {
    // Generate first challenge and get its XDR
    const r1 = generateChallenge(ALICE, NETWORK);
    const tx1 = new MockTransaction(r1.transactionXdr, NETWORK);
    tx1.sign(KEYPAIR_ALICE);
    const oldSigned = tx1.toEnvelope().toXDR('base64');

    // Generate second challenge (overwrites r1 in the store)
    generateChallenge(ALICE, NETWORK);

    // r1's signed XDR should now fail (nonce mismatch)
    expect(() => verifyChallenge(oldSigned, NETWORK)).toThrow(AuthError);
  });

  it('throws on an invalid Stellar address', () => {
    expect(() => generateChallenge('not-a-stellar-address', NETWORK)).toThrow();
  });
});

// =============================================================================
// 2. verifyChallenge — valid flow
// =============================================================================

describe('verifyChallenge — valid', () => {
  it('returns the account address when correctly signed', () => {
    const signedXdr = signChallenge(ALICE, KEYPAIR_ALICE);
    expect(verifyChallenge(signedXdr, NETWORK)).toBe(ALICE);
  });

  it('consumes the challenge so it cannot be replayed', () => {
    const record = generateChallenge(ALICE, NETWORK);
    const tx = new MockTransaction(record.transactionXdr, NETWORK);
    tx.sign(KEYPAIR_ALICE);
    const signedXdr = tx.toEnvelope().toXDR('base64');

    expect(() => verifyChallenge(signedXdr, NETWORK)).not.toThrow();
    // Second call: challenge is gone
    expect(() => verifyChallenge(signedXdr, NETWORK)).toThrow(AuthError);
  });

  it('works for a different account (Bob)', () => {
    const signedXdr = signChallenge(BOB, KEYPAIR_BOB);
    expect(verifyChallenge(signedXdr, NETWORK)).toBe(BOB);
  });
});

// =============================================================================
// 3. verifyChallenge — failure cases
// =============================================================================

describe('verifyChallenge — failures', () => {
  it('throws AuthError for invalid XDR', () => {
    expect(() => verifyChallenge('not-valid-xdr!!', NETWORK))
      .toThrow(AuthError);
    expect(() => verifyChallenge('not-valid-xdr!!', NETWORK))
      .toThrow('Invalid transaction XDR');
  });

  it('throws AuthError when no pending challenge exists for the account', () => {
    // Create a valid-looking transaction for ALICE but never called generateChallenge
    const fakeEnv = {
      source: ALICE,
      networkPassphrase: NETWORK,
      operations: [{ type: 'manageData', name: 'SorobanPay auth', valueHex: 'deadbeef' }],
      signatures: [],
    };
    const fakeXdr = Buffer.from(JSON.stringify(fakeEnv)).toString('base64');
    const fakeTx = new MockTransaction(fakeXdr, NETWORK);
    fakeTx.sign(KEYPAIR_ALICE);
    const signedXdr = fakeTx.toEnvelope().toXDR('base64');

    expect(() => verifyChallenge(signedXdr, NETWORK))
      .toThrow('No pending challenge for this account');
  });

  it('throws AuthError when transaction has no signatures', () => {
    const record = generateChallenge(ALICE, NETWORK);
    // Submit the unsigned XDR directly
    expect(() => verifyChallenge(record.transactionXdr, NETWORK))
      .toThrow(AuthError);
    expect(() => verifyChallenge(record.transactionXdr, NETWORK))
      .toThrow(/no signatures|not signed/i);
  });

  it('throws AuthError when signed by the wrong account', () => {
    // Generate a challenge for ALICE, sign with BOB
    const record = generateChallenge(ALICE, NETWORK);
    const tx = new MockTransaction(record.transactionXdr, NETWORK);
    tx.sign(KEYPAIR_BOB); // wrong signer
    const wrongSigned = tx.toEnvelope().toXDR('base64');

    expect(() => verifyChallenge(wrongSigned, NETWORK))
      .toThrow(AuthError);
    expect(() => verifyChallenge(wrongSigned, NETWORK))
      .toThrow(/no valid signature/i);
  });

  it('throws AuthError for an expired challenge', () => {
    const realDateNow = Date.now;
    const record = generateChallenge(ALICE, NETWORK);
    const tx = new MockTransaction(record.transactionXdr, NETWORK);
    tx.sign(KEYPAIR_ALICE);
    const signedXdr = tx.toEnvelope().toXDR('base64');

    // Jump 6 minutes ahead — past the 5-minute TTL
    Date.now = () => realDateNow() + 6 * 60 * 1000;
    try {
      // Single call: evictExpired removes it, then "no pending challenge" is thrown.
      // Both "expired" and "no pending challenge" indicate the challenge is no longer valid.
      let threw = false;
      try { verifyChallenge(signedXdr, NETWORK); } catch (e) { threw = true; expect(e).toBeInstanceOf(AuthError); }
      expect(threw).toBe(true);
    } finally {
      Date.now = realDateNow;
    }
  });

  it('throws AuthError when nonce in transaction does not match stored nonce', () => {
    // Generate a real challenge
    generateChallenge(ALICE, NETWORK);
    // Build a tampered transaction with a different nonce
    const tamperedEnv = {
      source: ALICE,
      networkPassphrase: NETWORK,
      operations: [{ type: 'manageData', name: 'SorobanPay auth', valueHex: 'aabbccdd' }],
      signatures: [],
    };
    const tamperedXdr = Buffer.from(JSON.stringify(tamperedEnv)).toString('base64');
    const tamperedTx = new MockTransaction(tamperedXdr, NETWORK);
    tamperedTx.sign(KEYPAIR_ALICE);
    const signedXdr = tamperedTx.toEnvelope().toXDR('base64');

    expect(() => verifyChallenge(signedXdr, NETWORK))
      .toThrow(AuthError);
    expect(() => verifyChallenge(signedXdr, NETWORK))
      .toThrow(/nonce mismatch/i);
  });
});

// =============================================================================
// 4. issueMerchantJwt
// =============================================================================

describe('issueMerchantJwt', () => {
  it('returns a three-part dot-separated JWT', () => {
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    expect(token.split('.')).toHaveLength(3);
  });

  it('encodes the address claim in the payload', () => {
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
    expect(payload.address).toBe(ALICE);
  });

  it('sets exp exactly 24 hours after iat', () => {
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    const payload = JSON.parse(
      Buffer.from(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString(),
    );
    expect(payload.exp - payload.iat).toBe(JWT_TTL_SECONDS);
    expect(JWT_TTL_SECONDS).toBe(86400);
  });

  it('produces different tokens for different secrets', () => {
    expect(issueMerchantJwt(ALICE, 'secret-a')).not.toBe(issueMerchantJwt(ALICE, 'secret-b'));
  });
});

// =============================================================================
// 5. verifyMerchantJwt
// =============================================================================

describe('verifyMerchantJwt', () => {
  it('returns payload with correct address for a valid token', () => {
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    const payload = verifyMerchantJwt(token, JWT_SECRET);
    expect(payload.address).toBe(ALICE);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('throws AuthError for a token expired by 25 hours', () => {
    const realNow = Date.now;
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    Date.now = () => realNow() + 25 * 60 * 60 * 1000;
    try {
      expect(() => verifyMerchantJwt(token, JWT_SECRET)).toThrow(AuthError);
      expect(() => verifyMerchantJwt(token, JWT_SECRET)).toThrow(/expired/i);
    } finally {
      Date.now = realNow;
    }
  });

  it('throws AuthError when the signature is invalid (wrong secret)', () => {
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    expect(() => verifyMerchantJwt(token, 'wrong-secret')).toThrow(AuthError);
    expect(() => verifyMerchantJwt(token, 'wrong-secret')).toThrow(/invalid.*signature/i);
  });

  it('throws AuthError when the payload is tampered', () => {
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    const [header, , sig] = token.split('.');
    const tampered = Buffer.from(
      JSON.stringify({ address: BOB, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    expect(() => verifyMerchantJwt(`${header}.${tampered}.${sig}`, JWT_SECRET))
      .toThrow(/invalid.*signature/i);
  });

  it('throws AuthError for a malformed token (not 3 parts)', () => {
    expect(() => verifyMerchantJwt('only.two', JWT_SECRET)).toThrow(AuthError);
    expect(() => verifyMerchantJwt('only.two', JWT_SECRET)).toThrow(/invalid.*format/i);
  });

  it('throws AuthError when the address claim is missing', () => {
    const { createHmac } = require('crypto');
    const hdr = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const bdy = Buffer.from(
      JSON.stringify({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600 }),
    ).toString('base64url');
    const sig = createHmac('sha256', JWT_SECRET).update(`${hdr}.${bdy}`).digest('base64url');
    expect(() => verifyMerchantJwt(`${hdr}.${bdy}.${sig}`, JWT_SECRET))
      .toThrow(/missing address/i);
  });
});

// =============================================================================
// 6. requireMerchant middleware
// =============================================================================

describe('requireMerchant middleware', () => {
  /** Minimal Express-like req/res/next mock. */
  function makeContext(authHeader?: string) {
    const req = { headers: authHeader ? { authorization: authHeader } : {} } as any;
    let statusCode = 200;
    let jsonBody: unknown = null;
    const locals: Record<string, unknown> = {};
    const res = {
      locals,
      status(code: number) { statusCode = code; return res; },
      json(body: unknown) { jsonBody = body; return res; },
      getStatus: () => statusCode,
      getJson: () => jsonBody,
    } as any;
    return { req, res };
  }

  it('calls next() and sets res.locals.merchantAddress for a valid token', () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    const { req, res } = makeContext(`Bearer ${token}`);
    const next = jest.fn();

    requireMerchant(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.locals.merchantAddress).toBe(ALICE);
  });

  it('returns 401 when Authorization header is absent', () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const { req, res } = makeContext();
    const next = jest.fn();

    requireMerchant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.getStatus()).toBe(401);
    expect((res.getJson() as any).error).toMatch(/missing.*authorization/i);
  });

  it('returns 401 when Authorization header does not start with "Bearer "', () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    const { req, res } = makeContext(`Token ${token}`);
    const next = jest.fn();

    requireMerchant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.getStatus()).toBe(401);
  });

  it('returns 401 when the token is expired', () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const realNow = Date.now;
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    Date.now = () => realNow() + 25 * 60 * 60 * 1000; // +25 hours
    try {
      const { req, res } = makeContext(`Bearer ${token}`);
      const next = jest.fn();
      requireMerchant(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.getStatus()).toBe(401);
      expect((res.getJson() as any).error).toMatch(/expired/i);
    } finally {
      Date.now = realNow;
    }
  });

  it('returns 401 when the token is signed with wrong secret', () => {
    process.env.JWT_SECRET = JWT_SECRET;
    const token = issueMerchantJwt(ALICE, 'wrong-secret');
    const { req, res } = makeContext(`Bearer ${token}`);
    const next = jest.fn();

    requireMerchant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.getStatus()).toBe(401);
  });

  it('returns 503 when JWT_SECRET env var is not set', () => {
    delete process.env.JWT_SECRET;
    const token = issueMerchantJwt(ALICE, JWT_SECRET);
    const { req, res } = makeContext(`Bearer ${token}`);
    const next = jest.fn();

    requireMerchant(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.getStatus()).toBe(503);
    expect((res.getJson() as any).error).toMatch(/jwt_secret/i);
  });
});

// =============================================================================
// 7. End-to-end: challenge → sign → token → middleware
// =============================================================================

describe('end-to-end: full SEP-10 style auth flow', () => {
  it('authenticates a merchant through the complete flow', () => {
    process.env.JWT_SECRET = JWT_SECRET;

    // Step 1: Generate challenge
    const record = generateChallenge(ALICE, NETWORK);
    expect(record.transactionXdr).toBeTruthy();
    expect(record.account).toBe(ALICE);

    // Step 2: Merchant signs the challenge transaction
    const tx = new MockTransaction(record.transactionXdr, NETWORK);
    tx.sign(KEYPAIR_ALICE);
    const signedXdr = tx.toEnvelope().toXDR('base64');

    // Step 3: Server verifies signature and issues JWT
    const address = verifyChallenge(signedXdr, NETWORK);
    expect(address).toBe(ALICE);

    const token = issueMerchantJwt(address, JWT_SECRET);
    expect(token.split('.')).toHaveLength(3);

    // Step 4: Middleware accepts the JWT on subsequent requests
    const req = { headers: { authorization: `Bearer ${token}` } } as any;
    const locals: Record<string, unknown> = {};
    const res = {
      locals,
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    } as any;
    const next = jest.fn();

    requireMerchant(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.locals.merchantAddress).toBe(ALICE);
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects a second account trying to use the same challenge', () => {
    // Generate for Alice, Bob tries to use it
    const record = generateChallenge(ALICE, NETWORK);
    const tx = new MockTransaction(record.transactionXdr, NETWORK);
    tx.sign(KEYPAIR_BOB); // Bob signs Alice's challenge
    const signedXdr = tx.toEnvelope().toXDR('base64');

    expect(() => verifyChallenge(signedXdr, NETWORK)).toThrow(AuthError);
  });
});
