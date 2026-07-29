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
import { createHmac, randomBytes } from 'crypto';

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
const CHALLENGE_TTL_SECONDS = 5 * 60;

/** JWT TTL: 24 hours. */
export const JWT_TTL_SECONDS = 24 * 60 * 60;

/**
 * ManageData operation key used to embed the challenge nonce.
 * Follows the SEP-10 convention: "<home_domain> auth".
 */
const MANAGE_DATA_KEY = 'SorobanPay auth';

// ─── In-memory challenge store ────────────────────────────────────────────────
// In production this should move to Redis so horizontal scaling works and TTL
// management is automatic.  For single-process deployments the Map is correct.

const pendingChallenges = new Map<string, ChallengeRecord>();

/**
 * Remove any expired entries from the in-memory challenge store.
 * Called before every lookup so stale challenges can't accumulate.
 */
function evictExpired(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [account, record] of pendingChallenges) {
    if (record.expiresAt <= now) {
      pendingChallenges.delete(account);
    }
  }
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
 */
export function generateChallenge(
  account: string,
  networkPassphrase: string,
): ChallengeRecord {
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

  evictExpired();
  // One active challenge per account — a new request supersedes the old one
  pendingChallenges.set(account, record);

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
 *   2. A pending challenge exists for the transaction's source account.
 *   3. The challenge has not expired.
 *   4. The ManageData nonce in the transaction matches the stored nonce.
 *   5. At least one signature on the transaction is valid for the source account.
 *
 * On success, the challenge is consumed (deleted) so it cannot be replayed.
 *
 * @param signedXdr        Base64-encoded signed transaction XDR.
 * @param networkPassphrase Stellar network passphrase.
 * @returns The merchant's Stellar public key.
 * @throws AuthError on any verification failure.
 */
export function verifyChallenge(
  signedXdr: string,
  networkPassphrase: string,
): string {
  // 1. Decode the transaction
  let tx: Transaction;
  try {
    tx = new Transaction(signedXdr, networkPassphrase);
  } catch {
    throw new AuthError('Invalid transaction XDR');
  }

  // 2. Identify the account from the transaction source
  const account = tx.source;

  evictExpired();
  const record = pendingChallenges.get(account);

  if (!record) {
    throw new AuthError('No pending challenge for this account');
  }

  // 3. Expiry guard (belt-and-suspenders on top of evictExpired)
  const now = Math.floor(Date.now() / 1000);
  if (record.expiresAt <= now) {
    pendingChallenges.delete(account);
    throw new AuthError('Challenge expired');
  }

  // 4. Verify the ManageData nonce matches
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

  // 5. Verify at least one valid signature from the account
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

  // Consume the challenge — prevents replay
  pendingChallenges.delete(account);

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
export function _clearChallengesForTesting(): void {
  pendingChallenges.clear();
}
