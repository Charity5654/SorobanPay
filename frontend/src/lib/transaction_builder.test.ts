/**
 * Regression tests: invalid token contract addresses must be rejected
 * by buildAndSubmitSubscribe before any RPC call is made.
 *
 * Covers: src/lib/transaction_builder.ts — address validation guard
 */

import { buildAndSubmitSubscribe, SubscribeParams } from './transaction_builder';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_C = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const BASE_PARAMS: SubscribeParams = {
  subscriber: VALID_G,
  merchant: VALID_G,
  token: VALID_C,
  amount: 100,
  interval: 86400,
};

const CONTRACT_ID = VALID_C;
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const RPC_URL = 'https://soroban-testnet.stellar.org';

// ─── Helper ───────────────────────────────────────────────────────────────────

function call(params: Partial<SubscribeParams>) {
  return buildAndSubmitSubscribe(
    { ...BASE_PARAMS, ...params },
    CONTRACT_ID,
    VALID_G,
    NETWORK_PASSPHRASE,
    RPC_URL,
  );
}

// ─── Token address validation — must throw before any network call ─────────────

describe('buildAndSubmitSubscribe: invalid token address', () => {
  it('throws synchronously (rejects immediately) for empty token address', async () => {
    await expect(call({ token: '' })).rejects.toThrow(/invalid token contract address/i);
  });

  it('throws for a G-address used as token (account ≠ contract)', async () => {
    await expect(call({ token: VALID_G })).rejects.toThrow(/invalid token contract address/i);
  });

  it('throws for a truncated C-address', async () => {
    await expect(call({ token: 'CAAAAAAA' })).rejects.toThrow(/invalid token contract address/i);
  });

  it('throws for an address with invalid base32 characters', async () => {
    const bad = 'C' + '0'.repeat(55); // '0' is not in A-Z2-7
    await expect(call({ token: bad })).rejects.toThrow(/invalid token contract address/i);
  });

  it('throws for a random string token address', async () => {
    await expect(call({ token: 'not-a-contract' })).rejects.toThrow(/invalid token contract address/i);
  });

  it('rejects before making any network call (no RPC mock needed)', async () => {
    // Use a deliberately unreachable RPC URL — if validation fires first, no
    // network request is attempted and the rejection is near-instant.
    const start = Date.now();
    await expect(
      buildAndSubmitSubscribe(
        { ...BASE_PARAMS, token: 'BADTOKEN' },
        CONTRACT_ID,
        VALID_G,
        NETWORK_PASSPHRASE,
        'https://0.0.0.0:1', // unreachable
      )
    ).rejects.toThrow(/invalid token contract address/i);
    // Validation guard must throw in < 100 ms — no TCP connection overhead
    expect(Date.now() - start).toBeLessThan(100);
  });
});

// ─── Subscriber / merchant address validation ─────────────────────────────────

describe('buildAndSubmitSubscribe: invalid subscriber/merchant addresses', () => {
  it('throws for invalid subscriber address (not G-address)', async () => {
    await expect(call({ subscriber: VALID_C })).rejects.toThrow(/invalid subscriber address/i);
  });

  it('throws for invalid merchant address (not G-address)', async () => {
    await expect(call({ merchant: 'BAD' })).rejects.toThrow(/invalid merchant address/i);
  });
});
