/**
 * refreshToken.test.ts — #1062
 *
 * Unit tests for refresh token rotation and reuse detection in authService.ts.
 *
 * Uses MockRedisClient (tests/helpers/redisMock.ts) so no real Redis server
 * is required. @stellar/stellar-sdk is stubbed out to avoid ESM issues.
 */

// ─── Mock @stellar/stellar-sdk ────────────────────────────────────────────────
// authService imports Keypair/Transaction/etc. at the top; we need the module
// to resolve even though we only test the refresh-token functions.

jest.mock('@stellar/stellar-sdk', () => ({
  Keypair: {
    fromPublicKey: jest.fn((k: string) => ({ publicKey: () => k })),
  },
  Transaction: jest.fn(),
  TransactionBuilder: jest.fn(),
  Account: jest.fn(),
  Operation: { manageData: jest.fn() },
  BASE_FEE: '100',
  Networks: { TESTNET: 'Test SDF Network ; September 2015' },
}));

// ─── Mock Redis ───────────────────────────────────────────────────────────────

import { MockRedisClient } from './helpers/redisMock';

const mockRedisClient = new MockRedisClient();

jest.mock('../src/lib/redis', () => ({
  getRedisClient: () => mockRedisClient,
}));

// ─── Import under test ────────────────────────────────────────────────────────

import {
  issueRefreshToken,
  rotateRefreshToken,
  RefreshTokenError,
  REFRESH_TOKEN_TTL_SECONDS,
  _clearRefreshTokensForTesting,
} from '../src/services/authService';

// ─── Constants ────────────────────────────────────────────────────────────────

const MERCHANT = 'GMERCHANT_REFRESH_TOKEN_TEST_ABCDEFGHIJ';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function clearStore() {
  await _clearRefreshTokensForTesting();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('issueRefreshToken', () => {
  afterEach(clearStore);

  it('returns a valid RefreshTokenRecord', async () => {
    const record = await issueRefreshToken(MERCHANT);

    expect(typeof record.tokenId).toBe('string');
    expect(record.tokenId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(typeof record.familyId).toBe('string');
    expect(record.familyId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
    expect(record.address).toBe(MERCHANT);
    expect(record.token).toMatch(/^[0-9a-f]{64}$/);
    expect(record.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('sets expiresAt approximately REFRESH_TOKEN_TTL_SECONDS from now', async () => {
    const before = Math.floor(Date.now() / 1000);
    const record = await issueRefreshToken(MERCHANT);
    const after = Math.floor(Date.now() / 1000);

    expect(record.expiresAt).toBeGreaterThanOrEqual(before + REFRESH_TOKEN_TTL_SECONDS);
    expect(record.expiresAt).toBeLessThanOrEqual(after + REFRESH_TOKEN_TTL_SECONDS + 1);
  });

  it('generates a unique token on each call', async () => {
    const r1 = await issueRefreshToken(MERCHANT);
    const r2 = await issueRefreshToken(MERCHANT);

    expect(r1.token).not.toBe(r2.token);
    expect(r1.tokenId).not.toBe(r2.tokenId);
    // Different issuances start different families
    expect(r1.familyId).not.toBe(r2.familyId);
  });
});

describe('rotateRefreshToken — successful rotation', () => {
  afterEach(clearStore);

  it('returns a new record with the same familyId and address but a new tokenId and token', async () => {
    const original = await issueRefreshToken(MERCHANT);
    const rotated = await rotateRefreshToken(original.token);

    expect(rotated.familyId).toBe(original.familyId);
    expect(rotated.address).toBe(MERCHANT);
    expect(rotated.tokenId).not.toBe(original.tokenId);
    expect(rotated.token).not.toBe(original.token);
    expect(rotated.token).toMatch(/^[0-9a-f]{64}$/);
  });

  it('the new token can itself be rotated', async () => {
    const first = await issueRefreshToken(MERCHANT);
    const second = await rotateRefreshToken(first.token);
    const third = await rotateRefreshToken(second.token);

    expect(third.familyId).toBe(first.familyId);
    expect(third.address).toBe(MERCHANT);
    expect(third.token).not.toBe(second.token);
  });
});

describe('rotateRefreshToken — old token invalidation', () => {
  afterEach(clearStore);

  it('invalidates the old token after rotation', async () => {
    const original = await issueRefreshToken(MERCHANT);
    await rotateRefreshToken(original.token);

    // Old token must no longer be accepted
    await expect(rotateRefreshToken(original.token)).rejects.toBeInstanceOf(RefreshTokenError);
  });

  it('throws RefreshTokenError with the non-disclosing message', async () => {
    const original = await issueRefreshToken(MERCHANT);
    await rotateRefreshToken(original.token);

    const err = await rotateRefreshToken(original.token).catch((e) => e);
    expect(err).toBeInstanceOf(RefreshTokenError);
    expect(err.message).toBe('Invalid or expired refresh token');
  });
});

describe('rotateRefreshToken — replay detection and family revocation', () => {
  afterEach(clearStore);

  it('revoking the family after replay prevents the newly issued token from being used', async () => {
    const first = await issueRefreshToken(MERCHANT);
    const second = await rotateRefreshToken(first.token);

    // Replay: present the old (already-rotated) token again
    await expect(rotateRefreshToken(first.token)).rejects.toBeInstanceOf(RefreshTokenError);

    // Now the family is revoked — the legitimate new token must also fail
    await expect(rotateRefreshToken(second.token)).rejects.toBeInstanceOf(RefreshTokenError);
  });

  it('replay error is non-disclosing (same message as other failures)', async () => {
    const first = await issueRefreshToken(MERCHANT);
    await rotateRefreshToken(first.token);

    const err = await rotateRefreshToken(first.token).catch((e) => e);
    expect(err.message).toBe('Invalid or expired refresh token');
  });
});

describe('rotateRefreshToken — unknown / expired token', () => {
  afterEach(clearStore);

  it('throws RefreshTokenError for a completely unknown token', async () => {
    const unknownToken = 'a'.repeat(64); // valid hex length but never issued
    await expect(rotateRefreshToken(unknownToken)).rejects.toBeInstanceOf(RefreshTokenError);
  });

  it('unknown token error is non-disclosing', async () => {
    const err = await rotateRefreshToken('b'.repeat(64)).catch((e) => e);
    expect(err.message).toBe('Invalid or expired refresh token');
  });
});

describe('RefreshTokenError class', () => {
  it('has name "RefreshTokenError"', () => {
    const err = new RefreshTokenError();
    expect(err.name).toBe('RefreshTokenError');
  });

  it('uses the default non-disclosing message when none provided', () => {
    const err = new RefreshTokenError();
    expect(err.message).toBe('Invalid or expired refresh token');
  });

  it('is an instance of Error', () => {
    expect(new RefreshTokenError()).toBeInstanceOf(Error);
  });
});
