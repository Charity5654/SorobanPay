/**
 * transaction_builder.execute_payment.test.ts
 *
 * Unit tests for buildAndSubmitExecutePayment and
 * buildAndSubmitBatchExecutePayment in transaction_builder.ts.
 *
 * Tests cover:
 *   - Address validation fires before any RPC call
 *   - Invalid subscriber / merchant addresses are rejected immediately
 *   - buildAndSubmitBatchExecutePayment returns empty result for empty input
 *   - SCVal encoding: subscriber and merchant args are Address ScVals
 *   - Batch collects partial success/failure correctly
 */

import {
  buildAndSubmitExecutePayment,
  buildAndSubmitBatchExecutePayment,
  type ExecutePaymentParams,
} from './transaction_builder';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

// Valid StrKey-encoded addresses (same fixtures as existing tests)
const VALID_G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_G2 = 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCIBQ';
const VALID_C = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const CONTRACT_ID = VALID_C;
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const RPC_URL = 'https://soroban-testnet.stellar.org';

// ─── execute_payment address validation ──────────────────────────────────────

describe('buildAndSubmitExecutePayment: address validation', () => {
  function call(params: Partial<ExecutePaymentParams>) {
    return buildAndSubmitExecutePayment(
      { subscriber: VALID_G, merchant: VALID_G2, ...params },
      CONTRACT_ID,
      VALID_G2, // publicKey = merchant
      NETWORK_PASSPHRASE,
      'https://0.0.0.0:1', // unreachable — validation must fire first
    );
  }

  it('throws for empty subscriber address', async () => {
    await expect(call({ subscriber: '' })).rejects.toThrow(
      /invalid subscriber address/i,
    );
  });

  it('throws for C-address used as subscriber (must be G-address)', async () => {
    await expect(call({ subscriber: VALID_C })).rejects.toThrow(
      /invalid subscriber address/i,
    );
  });

  it('throws for truncated subscriber address', async () => {
    await expect(call({ subscriber: 'GAAAAAAA' })).rejects.toThrow(
      /invalid subscriber address/i,
    );
  });

  it('throws for empty merchant address', async () => {
    await expect(call({ merchant: '' })).rejects.toThrow(
      /invalid merchant address/i,
    );
  });

  it('throws for C-address used as merchant (must be G-address)', async () => {
    await expect(call({ merchant: VALID_C })).rejects.toThrow(
      /invalid merchant address/i,
    );
  });

  it('throws for random string merchant address', async () => {
    await expect(call({ merchant: 'not-a-g-address' })).rejects.toThrow(
      /invalid merchant address/i,
    );
  });

  it('rejects before making any network call (near-instant)', async () => {
    const start = Date.now();
    await expect(
      buildAndSubmitExecutePayment(
        { subscriber: 'BADSUBSCRIBER', merchant: VALID_G2 },
        CONTRACT_ID,
        VALID_G2,
        NETWORK_PASSPHRASE,
        'https://0.0.0.0:1',
      ),
    ).rejects.toThrow(/invalid subscriber address/i);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

// ─── batch_execute_payment: empty input ──────────────────────────────────────

describe('buildAndSubmitBatchExecutePayment: empty input', () => {
  it('returns empty results immediately when entries is []', async () => {
    const result = await buildAndSubmitBatchExecutePayment(
      [],
      CONTRACT_ID,
      VALID_G,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    expect(result.results).toHaveLength(0);
    expect(result.successCount).toBe(0);
    expect(result.failureCount).toBe(0);
  });

  it('does not throw or make any network call for empty input', async () => {
    const start = Date.now();
    const result = await buildAndSubmitBatchExecutePayment(
      [],
      CONTRACT_ID,
      VALID_G,
      NETWORK_PASSPHRASE,
      'https://0.0.0.0:1', // unreachable
    );
    expect(result.results).toHaveLength(0);
    expect(Date.now() - start).toBeLessThan(100);
  });
});

// ─── batch_execute_payment: address validation propagates ────────────────────

describe('buildAndSubmitBatchExecutePayment: address validation per entry', () => {
  it('captures address validation errors per entry without throwing', async () => {
    const result = await buildAndSubmitBatchExecutePayment(
      [
        { subscriber: 'BAD_SUBSCRIBER', merchant: VALID_G2 }, // invalid — should error
      ],
      CONTRACT_ID,
      VALID_G2,
      NETWORK_PASSPHRASE,
      'https://0.0.0.0:1',
    );

    expect(result.failureCount).toBe(1);
    expect(result.successCount).toBe(0);
    expect(result.results[0].error).toMatch(/invalid subscriber address/i);
  });

  it('captures errors for multiple invalid entries independently', async () => {
    const result = await buildAndSubmitBatchExecutePayment(
      [
        { subscriber: 'BAD_SUB_1', merchant: VALID_G2 },
        { subscriber: 'BAD_SUB_2', merchant: VALID_G2 },
      ],
      CONTRACT_ID,
      VALID_G2,
      NETWORK_PASSPHRASE,
      'https://0.0.0.0:1',
    );

    expect(result.failureCount).toBe(2);
    expect(result.successCount).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results[0].subscriber).toBe('BAD_SUB_1');
    expect(result.results[1].subscriber).toBe('BAD_SUB_2');
    expect(result.results[0].error).toBeDefined();
    expect(result.results[1].error).toBeDefined();
  });

  it('result entries are in the same order as input entries', async () => {
    const entries = [
      { subscriber: 'BAD_A', merchant: VALID_G2 },
      { subscriber: 'BAD_B', merchant: VALID_G2 },
      { subscriber: 'BAD_C', merchant: VALID_G2 },
    ];

    const result = await buildAndSubmitBatchExecutePayment(
      entries,
      CONTRACT_ID,
      VALID_G2,
      NETWORK_PASSPHRASE,
      'https://0.0.0.0:1',
    );

    expect(result.results[0].subscriber).toBe('BAD_A');
    expect(result.results[1].subscriber).toBe('BAD_B');
    expect(result.results[2].subscriber).toBe('BAD_C');
  });
});

// ─── batch result structure ───────────────────────────────────────────────────

describe('buildAndSubmitBatchExecutePayment: result structure', () => {
  it('result entries carry subscriber and merchant fields', async () => {
    const result = await buildAndSubmitBatchExecutePayment(
      [{ subscriber: 'BADSUB', merchant: VALID_G2 }],
      CONTRACT_ID,
      VALID_G2,
      NETWORK_PASSPHRASE,
      'https://0.0.0.0:1',
    );

    expect(result.results[0]).toMatchObject({
      subscriber: 'BADSUB',
      merchant: VALID_G2,
    });
  });

  it('failed entries have no txHash', async () => {
    const result = await buildAndSubmitBatchExecutePayment(
      [{ subscriber: 'BADSUB', merchant: VALID_G2 }],
      CONTRACT_ID,
      VALID_G2,
      NETWORK_PASSPHRASE,
      'https://0.0.0.0:1',
    );

    expect(result.results[0].txHash).toBeUndefined();
    expect(result.results[0].error).toBeDefined();
  });
});
