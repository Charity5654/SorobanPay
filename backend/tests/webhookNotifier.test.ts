/**
 * Issue #822 — WebhookDelivery.eventId idempotency key.
 *
 * eventId must be a deterministic sha256(txHash + eventIndex) so merchant
 * webhook consumers can use it to deduplicate retries of the same
 * underlying on-chain event.
 */
import { createHash } from 'crypto';
import { deriveEventId } from '../src/services/webhookNotifier';

describe('deriveEventId()', () => {
  it('computes sha256(txHash + eventIndex) as a hex digest', () => {
    const txHash = 'abc123txhash';
    const eventIndex = 2;
    const expected = createHash('sha256')
      .update(txHash + eventIndex.toString())
      .digest('hex');

    expect(deriveEventId(txHash, eventIndex)).toBe(expected);
  });

  it('is stable across repeated calls for the same event (retry attempts)', () => {
    const txHash = 'stable-tx-hash-000';
    const eventIndex = 0;

    // Simulate the value being re-derived on every retry attempt (1st, 2nd, 3rd…) —
    // it must come back byte-for-byte identical every time.
    const attempt1 = deriveEventId(txHash, eventIndex);
    const attempt2 = deriveEventId(txHash, eventIndex);
    const attempt3 = deriveEventId(txHash, eventIndex);

    expect(attempt1).toBe(attempt2);
    expect(attempt2).toBe(attempt3);
  });

  it('produces different IDs for different event indices within the same transaction', () => {
    const txHash = 'multi-event-tx';
    expect(deriveEventId(txHash, 0)).not.toBe(deriveEventId(txHash, 1));
  });

  it('produces different IDs for different transactions at the same index', () => {
    expect(deriveEventId('tx-a', 0)).not.toBe(deriveEventId('tx-b', 0));
  });
});
