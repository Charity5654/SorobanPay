/**
 * Unit tests for WebhookWorker (#1375)
 *
 * Mocks HTTP delivery and pg Pool to test retry logic, signing, and DB writes.
 */

import { WebhookWorker, RETRY_DELAYS_MS, MAX_ATTEMPTS } from '../../src/workers/webhook';
import type { DecodedEvent } from '../../src/services/indexer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(type: string = 'executed'): DecodedEvent {
  return {
    type: type as DecodedEvent['type'],
    subscriber: 'GSUB1111',
    merchant: 'GMER1111',
    amount: '1000',
    txHash: 'txhash_abc',
    ledgerSeq: 1234,
    occurredAt: new Date('2025-01-15T00:00:00Z'),
  };
}

function makeMockPool(overrides?: Partial<{ query: jest.Mock; connect: jest.Mock }>) {
  const query = jest.fn().mockResolvedValue({ rows: [] });
  const connect = jest.fn().mockResolvedValue({ query, release: jest.fn() });
  return { query, connect, end: jest.fn(), ...overrides };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WebhookWorker', () => {
  let worker: WebhookWorker;
  let mockPool: ReturnType<typeof makeMockPool>;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.WEBHOOK_SECRET = 'test-secret-key';
    mockPool = makeMockPool();
    worker = new WebhookWorker(mockPool as never, 99999999);
  });

  afterEach(() => {
    worker.stop();
    delete process.env.WEBHOOK_SECRET;
  });

  // -------------------------------------------------------------------------
  // HMAC signing
  // -------------------------------------------------------------------------

  describe('sign()', () => {
    it('produces a non-empty hex string', () => {
      const sig = worker.sign('{"test":true}');
      expect(sig).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces the same signature for the same input', () => {
      const body = '{"event":"executed"}';
      expect(worker.sign(body)).toBe(worker.sign(body));
    });

    it('produces different signatures for different inputs', () => {
      expect(worker.sign('aaa')).not.toBe(worker.sign('bbb'));
    });

    it('returns empty string when WEBHOOK_SECRET is not set', () => {
      delete process.env.WEBHOOK_SECRET;
      const w = new WebhookWorker(mockPool as never);
      expect(w.sign('body')).toBe('');
    });
  });

  describe('verify()', () => {
    it('returns true for a valid signature', () => {
      const body = '{"event":"executed","amount":"100"}';
      const sig = worker.sign(body);
      expect(worker.verify(body, sig)).toBe(true);
    });

    it('returns false for a tampered body', () => {
      const body = '{"event":"executed"}';
      const sig = worker.sign(body);
      expect(worker.verify('{"event":"tampered"}', sig)).toBe(false);
    });

    it('returns false for a wrong signature', () => {
      const body = '{"event":"executed"}';
      expect(worker.verify(body, 'a'.repeat(64))).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // HTTP delivery
  // -------------------------------------------------------------------------

  describe('httpPost()', () => {
    it('rejects with error for an invalid URL', async () => {
      await expect(
        worker.httpPost('not-a-url', '{}', 'sig'),
      ).rejects.toThrow(/Invalid webhook URL/);
    });
  });

  // -------------------------------------------------------------------------
  // attemptDelivery
  // -------------------------------------------------------------------------

  describe('attemptDelivery()', () => {
    it('marks status delivered on HTTP 200', async () => {
      jest.spyOn(worker, 'httpPost').mockResolvedValue({
        statusCode: 200,
        body: 'OK',
      });

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await worker.attemptDelivery(
        1,
        'https://example.com/hook',
        {
          event_type: 'executed',
          subscriber: 'GSUB',
          merchant: 'GMER',
          amount: '100',
          tx_hash: 'hash',
          ledger_seq: 1,
          occurred_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
        },
        1,
      );

      expect(result.status).toBe('delivered');
      expect(result.responseStatus).toBe(200);
    });

    it('schedules retry on HTTP 500', async () => {
      jest.spyOn(worker, 'httpPost').mockResolvedValue({
        statusCode: 500,
        body: 'Server Error',
      });

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await worker.attemptDelivery(
        2,
        'https://example.com/hook',
        {
          event_type: 'executed',
          subscriber: 'GSUB',
          merchant: 'GMER',
          amount: '100',
          tx_hash: 'hash',
          ledger_seq: 1,
          occurred_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
        },
        1,
      );

      // attempt 1 is not last → status 'failed' (pending in DB)
      expect(result.status).toBe('failed');
    });

    it('moves to dead-letter queue on final attempt failure', async () => {
      jest.spyOn(worker, 'httpPost').mockResolvedValue({
        statusCode: 503,
        body: 'Service Unavailable',
      });

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await worker.attemptDelivery(
        3,
        'https://example.com/hook',
        {
          event_type: 'executed',
          subscriber: 'GSUB',
          merchant: 'GMER',
          amount: '100',
          tx_hash: 'hash',
          ledger_seq: 1,
          occurred_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
        },
        MAX_ATTEMPTS, // last allowed attempt
      );

      expect(result.status).toBe('dead');
    });

    it('records error_message on network error', async () => {
      jest
        .spyOn(worker, 'httpPost')
        .mockRejectedValue(new Error('ECONNREFUSED'));

      mockPool.query.mockResolvedValue({ rows: [] });

      const result = await worker.attemptDelivery(
        4,
        'https://example.com/hook',
        {
          event_type: 'executed',
          subscriber: 'GSUB',
          merchant: 'GMER',
          amount: '100',
          tx_hash: 'hash',
          ledger_seq: 1,
          occurred_at: new Date().toISOString(),
          delivered_at: new Date().toISOString(),
        },
        1,
      );

      expect(result.errorMessage).toMatch(/ECONNREFUSED/);
    });
  });

  // -------------------------------------------------------------------------
  // enqueue
  // -------------------------------------------------------------------------

  describe('enqueue()', () => {
    it('skips silently when no webhook config for merchant', async () => {
      // getMerchantWebhookConfig returns null
      mockPool.query.mockResolvedValueOnce({ rows: [] });

      const spyAttempt = jest.spyOn(worker, 'attemptDelivery');
      await worker.enqueue(makeEvent());

      expect(spyAttempt).not.toHaveBeenCalled();
    });

    it('creates delivery record and attempts delivery when config exists', async () => {
      // getMerchantWebhookConfig returns a URL
      mockPool.query
        .mockResolvedValueOnce({
          rows: [{ url: 'https://merchant.example.com/hook', secret: 'sec' }],
        })
        // createDeliveryRecord RETURNING id
        .mockResolvedValueOnce({ rows: [{ id: 42 }] });

      jest.spyOn(worker, 'attemptDelivery').mockResolvedValue({
        deliveryId: 42,
        attempt: 1,
        status: 'delivered',
        responseStatus: 200,
      });

      await worker.enqueue(makeEvent());

      expect(worker.attemptDelivery).toHaveBeenCalledWith(
        42,
        'https://merchant.example.com/hook',
        expect.objectContaining({ event_type: 'executed' }),
        1,
      );
    });
  });

  // -------------------------------------------------------------------------
  // Retry delays
  // -------------------------------------------------------------------------

  describe('retry delays', () => {
    it('defines 3 retry delays', () => {
      expect(RETRY_DELAYS_MS).toHaveLength(3);
    });

    it('delay sequence is 1s, 10s, 60s (exponential backoff)', () => {
      expect(RETRY_DELAYS_MS[0]).toBe(1_000);
      expect(RETRY_DELAYS_MS[1]).toBe(10_000);
      expect(RETRY_DELAYS_MS[2]).toBe(60_000);
    });

    it('MAX_ATTEMPTS equals length of RETRY_DELAYS_MS', () => {
      expect(MAX_ATTEMPTS).toBe(RETRY_DELAYS_MS.length);
    });
  });
});
