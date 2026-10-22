/**
 * backend/tests/idempotencyConcurrency.test.ts
 *
 * Issue #1122 — Add idempotency concurrency tests (queentiffany1111-cloud)
 *
 * Simulates high-concurrency race conditions where identical requests or events
 * arrive concurrently in parallel promises:
 *   - Exactly one caller succeeds in acquiring or committing the operation
 *   - All concurrent duplicate requests are recognized as duplicates and rejected idempotently
 *   - No state corruption or duplicate records in database
 */

import { EventDeduplicator, PaymentEventRecord } from '../src/services/eventDeduplication';

describe('Idempotency Concurrency Tests (#1122)', () => {
  let deduplicator: EventDeduplicator;

  beforeEach(() => {
    deduplicator = new EventDeduplicator();
  });

  it('atomically deduplicates 50 concurrent payment executions with identical txHash', async () => {
    const paymentEvent: PaymentEventRecord = {
      txHash: '0xconcurrent_payment_tx_hash_123',
      ledger: 600200,
      data: { amount: '150.00' },
    };

    // Fire 50 concurrent deliveries simultaneously
    const concurrency = 50;
    const promises = Array.from({ length: concurrency }, (_, i) =>
      deduplicator.processPaymentEventAtomic(paymentEvent, 600200, `token_${i}`),
    );

    const results = await Promise.all(promises);

    // Exactly 1 inserted, 49 deduplicated
    const insertedCount = results.filter((r) => r.inserted).length;
    const deduplicatedCount = results.filter((r) => !r.inserted).length;

    expect(insertedCount).toBe(1);
    expect(deduplicatedCount).toBe(concurrency - 1);

    // Stable cursor verification
    const cursor = deduplicator.getCursor();
    expect(cursor.lastLedger).toBe(600200);
  });

  it('atomically handles 50 concurrent generic events with the same idempotency key', async () => {
    const eventKey = 'idempotent_event_key_abc_999';
    const concurrency = 50;

    const promises = Array.from({ length: concurrency }, (_, i) =>
      deduplicator.processGenericEventAtomic(eventKey, 700100 + i, `tok_${i}`),
    );

    const results = await Promise.all(promises);

    const processedCount = results.filter((r) => r.processed).length;
    const ignoredCount = results.filter((r) => !r.processed).length;

    expect(processedCount).toBe(1);
    expect(ignoredCount).toBe(concurrency - 1);
  });

  it('allows distinct events to proceed concurrently without cross-blocking', async () => {
    const eventA: PaymentEventRecord = { txHash: 'tx_A', ledger: 100, data: { amount: '10' } };
    const eventB: PaymentEventRecord = { txHash: 'tx_B', ledger: 101, data: { amount: '20' } };
    const eventC: PaymentEventRecord = { txHash: 'tx_C', ledger: 102, data: { amount: '30' } };

    const [resA, resB, resC] = await Promise.all([
      deduplicator.processPaymentEventAtomic(eventA, 100, 'tok_a'),
      deduplicator.processPaymentEventAtomic(eventB, 101, 'tok_b'),
      deduplicator.processPaymentEventAtomic(eventC, 102, 'tok_c'),
    ]);

    expect(resA.inserted).toBe(true);
    expect(resB.inserted).toBe(true);
    expect(resC.inserted).toBe(true);
  });
});
