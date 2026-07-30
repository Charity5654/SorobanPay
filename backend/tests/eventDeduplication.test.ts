import { EventDeduplicator, PaymentEventRecord } from '../src/services/eventDeduplication';

describe('Event Deduplication Architecture (#398 / BE-63)', () => {
  let deduplicator: EventDeduplicator;

  beforeEach(() => {
    deduplicator = new EventDeduplicator();
  });

  const paymentEvent: PaymentEventRecord = {
    txHash: '0xabc123def456',
    ledger: 500100,
    data: { amount: '100.00' }
  };

  it('should process payment event and update cursor atomically', async () => {
    const res = await deduplicator.processPaymentEventAtomic(paymentEvent, 500100, 'tok_1');
    expect(res.inserted).toBe(true);

    const cursor = deduplicator.getCursor();
    expect(cursor.lastLedger).toBe(500100);
    expect(cursor.pagingToken).toBe('tok_1');
  });

  it('should ignore duplicate event delivery idempotently using composite key (tx_hash, ledger)', async () => {
    const res1 = await deduplicator.processPaymentEventAtomic(paymentEvent, 500100, 'tok_1');
    expect(res1.inserted).toBe(true);

    // Delivery 2 (duplicate delivery on indexer restart)
    const res2 = await deduplicator.processPaymentEventAtomic(paymentEvent, 500100, 'tok_1');
    expect(res2.inserted).toBe(false);
  });

  it('should deduplicate generic events via processed_events hash', async () => {
    const res1 = await deduplicator.processGenericEventAtomic('hash_999', 500101, 'tok_2');
    expect(res1.processed).toBe(true);

    const res2 = await deduplicator.processGenericEventAtomic('hash_999', 500101, 'tok_2');
    expect(res2.processed).toBe(false);
  });
});
