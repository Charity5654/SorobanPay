/**
 * authService.ts — SEP-10 style Stellar challenge-response authentication.
 *
 * Flow:
 *   1. GET /v1/auth/challenge?account=G…
 *      Server builds an unsigned Stellar ManageData transaction whose source is
 *      the merchant's account. The operation encapsulates a random nonce so
 *      each challenge is unique and non-replayable.
 *
 *   2. POST /v1/auth/token { transaction: "<base64-XDR>" }
 *      Server verifies:
 *        a. The XDR decodes to a valid Stellar transaction.
 *        b. The transaction matches a known pending challenge.
 *        c. The transaction carries a valid signature from the claimed account.
 *      On success a JWT is issued with payload { address, exp }.
 *
 * Reference: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
 */

import {
  Keypair,
  Transaction,
  TransactionBuilder,
  Operation,
  Account,
  BASE_FEE,
  Networks,
} from '@stellar/stellar-sdk';
import { createHmac, randomBytes, randomUUID } from 'crypto';
import { getRedisClient } from '../lib/redis';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChallengeRecord {
  /** The merchant's Stellar public key. */
  account: string;
  /** Random 32-byte nonce encoded as hex. */
  nonce: string;
  /** Unsigned challenge transaction XDR. */
  transactionXdr: string;
  /** Unix timestamp (seconds) when this challenge expires. */
  expiresAt: number;
}

export interface MerchantTokenPayload {
  /** Stellar public key of the authenticated merchant. */
  address: string;
  /** Issued-at timestamp (seconds). */
  iat: number;
  /** Expiry timestamp (seconds). */
  exp: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Challenge TTL: 5 minutes. After this the merchant must request a new one. */
export const CHALLENGE_TTL_SECONDS = 5 * 60;

/** JWT TTL: 24 hours. */
export const JWT_TTL_SECONDS = 24 * 60 * 60;

/**
 * ManageData operation key used to embed the challenge nonce.
 * Follows the SEP-10 convention: "<home_domain> auth".
 */
const MANAGE_DATA_KEY = 'SorobanPay auth';

// ─── Redis-backed challenge store (Issue #792) ─────────────────────────────────
//
// Was an in-memory Map: correct for a single process, but with 2+ backend
// instances a challenge issued by instance A could never be verified by
// instance B, since each process has its own Map. Moving the store to Redis
// fixes that — any instance can issue or verify a challenge against the same
// shared store — and gets two things "for free" that the Map had to fake:
//   - TTL: Redis's own `EX` expiry replaces the manual evictExpired() sweep.
//   - Atomicity: GETDEL reads and deletes in one round-trip, so two
//     concurrent verify attempts for the same challenge can't both succeed
//     (the second one gets nothing back) — a real replay-prevention guarantee
//     the old "get, check, then delete" sequence didn't have.

function challengeKey(account: string): string {
  return `sep10:challenge:${account}`;
}

/**
 * Resolve the shared Redis client or throw. Unlike the cache helpers in
 * lib/redis.ts (which silently fall back to Postgres on any Redis issue),
 * there is no fallback store for auth challenges — failing loudly here is
 * the correct behaviour for a security-critical path.
 */
function requireRedis() {
  const client = getRedisClient();
  if (!client) {
    throw new Error('Authentication challenge store unavailable (Redis not connected)');
  }
  return client;
}

// ─── Challenge generation ─────────────────────────────────────────────────────

/**
 * Build and return an unsigned Stellar challenge transaction for `account`.
 *
 * The transaction uses the server's account as the fee-payer source so the
 * merchant doesn't need an on-chain sequence number.  The challenge transaction
 * is never broadcast to the network — it only serves as a sign-this-data
 * vehicle.
 *
 * @param account  Merchant's Stellar public key (G…).
 * @param networkPassphrase  Stellar network passphrase.
 * @returns ChallengeRecord including the unsigned XDR.
 * @throws Error if the Redis challenge store is unavailable.
 */
export async function generateChallenge(
  account: string,
  networkPassphrase: string,
): Promise<ChallengeRecord> {
  // Validate address format — Keypair.fromPublicKey throws on invalid input
  Keypair.fromPublicKey(account);

  const nonce = randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + CHALLENGE_TTL_SECONDS;

  // Build a minimal transaction that just carries the nonce as ManageData.
  // We use the merchant's account as source with sequence 0 so the server
  // doesn't need to know the real sequence number, and the tx is never
  // submitted.
  const source = new Account(account, '0');
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      Operation.manageData({
        name: MANAGE_DATA_KEY,
        // 32-byte nonce as raw buffer per SEP-10 convention
        value: Buffer.from(nonce, 'hex'),
      }),
    )
    .setTimeout(CHALLENGE_TTL_SECONDS)
    .build();

  const transactionXdr = tx.toEnvelope().toXDR('base64');

  const record: ChallengeRecord = { account, nonce, transactionXdr, expiresAt };

  const client = requireRedis();
  // One active challenge per account — SET (no NX) means a new request
  // simply overwrites any existing challenge, same as the old Map.set().
  // EX makes Redis expire the key itself — no manual eviction needed.
  await client.set(challengeKey(account), JSON.stringify(record), 'EX', CHALLENGE_TTL_SECONDS);

  return record;
}

// ─── Signature verification ───────────────────────────────────────────────────

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

/**
 * Verify a signed challenge transaction and return the merchant's address.
 *
 * Checks:
 *   1. The XDR decodes to a valid Stellar transaction.
 *   2. A pending (not expired) challenge exists for the transaction's source
 *      account — fetched via an atomic Redis GETDEL, so this step also
 *      consumes the challenge regardless of what the later checks find.
 *   3. The ManageData nonce in the transaction matches the stored nonce.
 *   4. At least one signature on the transaction is valid for the source account.
 *
 * The challenge is consumed as soon as it's read (step 2), not only on full
 * success — it is single-use per verification attempt, which also prevents
 * it being used as a signature/nonce oracle across repeated tries.
 *
 * @param signedXdr        Base64-encoded signed transaction XDR.
 * @param networkPassphrase Stellar network passphrase.
 * @returns The merchant's Stellar public key.
 * @throws AuthError on any verification failure.
 * @throws Error if the Redis challenge store is unavailable.
 */
export async function verifyChallenge(
  signedXdr: string,
  networkPassphrase: string,
): Promise<string> {
  // 1. Decode the transaction
  let tx: Transaction;
  try {
    tx = new Transaction(signedXdr, networkPassphrase);
  } catch {
    throw new AuthError('Invalid transaction XDR');
  }

  // 2. Identify the account from the transaction source
  const account = tx.source;

  // Atomic read-and-delete: the challenge is consumed the instant it's read,
  // so two concurrent requests racing to verify the same challenge can't
  // both succeed — this is what actually prevents replay, vs. the old
  // get-then-check-then-delete sequence which had a window between them.
  // Redis's own TTL means a missing key covers both "never existed" and
  // "expired" — there's no separate manual expiry check needed anymore.
  const client = requireRedis();
  const raw = await client.getdel(challengeKey(account));

  if (!raw) {
    throw new AuthError('No pending challenge for this account');
  }

  const record: ChallengeRecord = JSON.parse(raw);

  // 3. Verify the ManageData nonce matches
  const ops = tx.operations;
  const manageDataOp = ops.find(
    (op): op is Operation.ManageData =>
      op.type === 'manageData' && op.name === MANAGE_DATA_KEY,
  );

  if (!manageDataOp || !manageDataOp.value) {
    throw new AuthError('Challenge transaction missing ManageData operation');
  }

  const submittedNonce = (manageDataOp.value as Buffer).toString('hex');
  if (submittedNonce !== record.nonce) {
    throw new AuthError('Nonce mismatch');
  }

  // 4. Verify at least one valid signature from the account
  if (!tx.signatures || tx.signatures.length === 0) {
    throw new AuthError('Transaction has no signatures');
  }

  const keypair = Keypair.fromPublicKey(account);
  const txHash = tx.hash();
  let signatureValid = false;

  for (const sig of tx.signatures) {
    try {
      if (keypair.verify(txHash, sig.signature())) {
        signatureValid = true;
        break;
      }
    } catch {
      // Try next signature
    }
  }

  if (!signatureValid) {
    throw new AuthError('No valid signature from account');
  }

  // Note: the challenge was already consumed by the GETDEL above, before any
  // of these validation checks ran. A failed nonce/signature check does not
  // leave the challenge available for a retry — it's single-use per attempt,
  // which is stricter than (and a superset of) "single-use per success".

  return account;
}

// ─── JWT helpers ──────────────────────────────────────────────────────────────

/**
 * Encode a string to base64url format.
 */
function base64url(input: string | Buffer): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

/**
 * Issue a merchant JWT.
 *
 * Payload: `{ address: string; iat: number; exp: number }`
 *
 * Signed with HMAC-SHA256 using `JWT_SECRET` from the environment
 * (matching the approach used in adminAuth.ts).
 *
 * @param address  Merchant's Stellar public key.
 * @param secret   JWT signing secret (from environment).
 * @returns Compact JWT string.
 */
export function issueMerchantJwt(address: string, secret: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: MerchantTokenPayload = {
    address,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
  };

  const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;

  const signature = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Verify a merchant JWT and return its payload.
 *
 * @param token  Compact JWT string.
 * @param secret JWT signing secret.
 * @returns Decoded MerchantTokenPayload.
 * @throws AuthError if the token is invalid, expired, or the signature fails.
 */
export function verifyMerchantJwt(token: string, secret: string): MerchantTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 3) throw new AuthError('Invalid JWT format');

  const [headerB64, payloadB64, receivedSig] = parts;

  // Re-compute expected signature
  const signingInput = `${headerB64}.${payloadB64}`;
  const expectedSig = createHmac('sha256', secret)
    .update(signingInput)
    .digest('base64url');

  if (expectedSig !== receivedSig) {
    throw new AuthError('Invalid token signature');
  }

  // Decode payload
  let payload: MerchantTokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(payloadB64.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'),
    ) as MerchantTokenPayload;
  } catch {
    throw new AuthError('Malformed token payload');
  }

  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp < now) {
    throw new AuthError('Token expired');
  }

  if (!payload.address) {
    throw new AuthError('Token missing address claim');
  }

  return payload;
}

// ─── Exposed for testing only ─────────────────────────────────────────────────

/**
 * Clear all pending challenges. Only intended for test teardown.
 * @internal
 */
export async function _clearChallengesForTesting(): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  const keys = await client.keys('sep10:challenge:*');
  if (keys.length > 0) {
    await client.del(...keys);
  }
}

// ─── Refresh Token Rotation (Issue #1062) ────────────────────────────────────
//
// Design:
//   - Each refresh token is a 32-byte random hex string, unique per issuance.
//   - Tokens belong to a "family" (shared `familyId`).  Every rotation stays
//     within the same family.
//   - When a token is used it is atomically deleted from Redis and a new token
//     in the same family is issued.
//   - To detect replay: after deletion the used token's key is stored in a
//     short-lived "used" sentinel so a second presentation of the old token
//     can be recognised as a replay.
//   - On replay: the entire family is revoked (a revocation sentinel is set).
//     Any subsequent attempt to rotate any token in that family fails, even
//     if the new token was legitimately issued.
//   - All error messages exposed to callers are identical and non-disclosing,
//     so replay vs. expiry vs. revocation cannot be distinguished externally.

/** Refresh token TTL: 30 days. */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** A refresh token record stored in Redis and returned to callers. */
export interface RefreshTokenRecord {
  /** UUID v4 — unique per token issuance. */
  tokenId: string;
  /** UUID v4 — constant across all rotations within a family. */
  familyId: string;
  /** Merchant Stellar public key. */
  address: string;
  /** 32-byte random hex — the opaque bearer value presented by the client. */
  token: string;
  /** Unix timestamp (seconds) when this token expires. */
  expiresAt: number;
}

/** Thrown for all refresh-token errors. Message is always non-disclosing. */
export class RefreshTokenError extends Error {
  constructor(message = 'Invalid or expired refresh token') {
    super(message);
    this.name = 'RefreshTokenError';
  }
}

// Redis key helpers
function rtTokenKey(token: string): string {
  return `refresh:token:${token}`;
}
function rtUsedKey(token: string): string {
  return `refresh:used:${token}`;
}
function rtFamilyRevokedKey(familyId: string): string {
  return `refresh:family:revoked:${familyId}`;
}

/**
 * Issue a new refresh token for `address`.
 *
 * Stores the token record in Redis with a TTL of REFRESH_TOKEN_TTL_SECONDS.
 * The `familyId` is freshly generated (starts a new family).
 *
 * @throws Error if the Redis store is unavailable.
 */
export async function issueRefreshToken(address: string): Promise<RefreshTokenRecord> {
  const client = requireRedis();

  const tokenId = randomUUID();
  const familyId = randomUUID();
  const token = randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + REFRESH_TOKEN_TTL_SECONDS;

  const record: RefreshTokenRecord = { tokenId, familyId, address, token, expiresAt };

  await client.set(
    rtTokenKey(token),
    JSON.stringify(record),
    'EX',
    REFRESH_TOKEN_TTL_SECONDS,
  );

  return record;
}

/**
 * Rotate a refresh token.
 *
 * Steps:
 *  1. Check if the family is already revoked → fail (non-disclosing).
 *  2. Atomically fetch-and-delete the current token from Redis.
 *  3. If not found:
 *     a. If a "used" sentinel exists for this token → replay detected.
 *        → Revoke the family; fail (non-disclosing).
 *     b. Otherwise (truly unknown / expired) → fail (non-disclosing).
 *  4. Mark the old token as "used" (replay detection sentinel).
 *  5. Issue a new token in the same family.
 *  6. Return the new record.
 *
 * All failure paths return `RefreshTokenError` with the same message so the
 * caller cannot distinguish replay, revocation, or expiry.
 *
 * @throws RefreshTokenError on any validation failure (non-disclosing).
 * @throws Error if the Redis store is unavailable.
 */
export async function rotateRefreshToken(token: string): Promise<RefreshTokenRecord> {
  const client = requireRedis();

  // Step 1: Attempt to atomically consume the token (fetch + delete in one round-trip)
  const rawRecord = await client.getdel(rtTokenKey(token));

  if (!rawRecord) {
    // Token not found — check if it was already used (replay) or simply expired/unknown
    const usedSentinel = await client.get(rtUsedKey(token));
    if (usedSentinel) {
      // Replay detected: this token was already rotated.  Parse the family from
      // the sentinel so we can revoke it.
      let familyId: string | undefined;
      try {
        const sentinelData = JSON.parse(usedSentinel) as { familyId?: string };
        familyId = sentinelData.familyId;
      } catch {
        // Sentinel value is just the familyId string directly
        familyId = usedSentinel;
      }

      if (familyId) {
        // Revoke the entire family so all future rotations fail
        await client.set(
          rtFamilyRevokedKey(familyId),
          '1',
          'EX',
          REFRESH_TOKEN_TTL_SECONDS * 2,
        );
        console.warn(
          `[authService] Refresh token replay detected for family ${familyId} — family revoked`,
        );
      }
    }
    // Non-disclosing: same message for replay, expiry, and unknown token
    throw new RefreshTokenError();
  }

  // We have the record — parse it
  let record: RefreshTokenRecord;
  try {
    record = JSON.parse(rawRecord) as RefreshTokenRecord;
  } catch {
    throw new RefreshTokenError();
  }

  // Step 2: Check if the family has been revoked (could happen if a sibling was replayed)
  const revoked = await client.get(rtFamilyRevokedKey(record.familyId));
  if (revoked) {
    console.warn(
      `[authService] Refresh token presented for revoked family ${record.familyId}`,
    );
    throw new RefreshTokenError();
  }

  // Step 3: Store a used sentinel so a re-presentation of this token triggers replay detection
  await client.set(
    rtUsedKey(token),
    JSON.stringify({ familyId: record.familyId }),
    'EX',
    REFRESH_TOKEN_TTL_SECONDS * 2,
  );

  // Step 4: Issue the replacement token in the same family
  const newTokenId = randomUUID();
  const newToken = randomBytes(32).toString('hex');
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + REFRESH_TOKEN_TTL_SECONDS;

  const newRecord: RefreshTokenRecord = {
    tokenId: newTokenId,
    familyId: record.familyId,
    address: record.address,
    token: newToken,
    expiresAt,
  };

  await client.set(
    rtTokenKey(newToken),
    JSON.stringify(newRecord),
    'EX',
    REFRESH_TOKEN_TTL_SECONDS,
  );

  return newRecord;
}

/**
 * Clear all refresh token keys. Only intended for test teardown.
 * @internal
 */
export async function _clearRefreshTokensForTesting(): Promise<void> {
  const client = getRedisClient();
  if (!client) return;
  const patterns = ['refresh:token:*', 'refresh:used:*', 'refresh:family:revoked:*'];
  for (const pattern of patterns) {
    const keys = await client.keys(pattern);
    if (keys.length > 0) {
      await client.del(...keys);
    }
  }
}
