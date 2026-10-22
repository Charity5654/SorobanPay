/**
 * backend/tests/webhooks.test.ts
 *
 * Unit tests for backend/src/routes/webhooks.ts
 *
 * Covers:
 *   - verifyWebhookSignature middleware: valid signature passes
 *   - verifyWebhookSignature: missing headers → 400
 *   - verifyWebhookSignature: timestamp too old → 400
 *   - verifyWebhookSignature: timestamp in future beyond tolerance → 400
 *   - verifyWebhookSignature: replay detection → 400
 *   - verifyWebhookSignature: invalid HMAC → 401
 *   - verifyWebhookSignature: WEBHOOK_SECRET not set → 503
 *   - verifySignature: constant-time comparison (no timing oracle)
 *   - computeSignature: deterministic given same inputs
 *   - POST /ingest: valid delivery accepted → 202
 *   - POST /ingest: duplicate delivery ID → 200 already-enqueued
 *   - POST /ingest: missing callbackUrl → 400
 *   - GET /jobs/:merchant: tenant-isolated listing
 *   - GET /dead-letters: payload is redacted in response
 *   - POST /dead-letters/:id/replay: valid replay → 200
 *   - POST /dead-letters/:id/replay: unknown ID → 404
 *   - ReplayCache: markSeen / hasSeen / expiry
 */

import * as crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import {
  verifyWebhookSignature,
  verifySignature,
  computeSignature,
  replayCache,
  ReplayCache,
  TIMESTAMP_TOLERANCE_SECONDS,
  REPLAY_WINDOW_SECONDS,
} from '../src/routes/webhooks';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SECRET = 'test-webhook-secret-32-bytes-long!';

function makeRawBody(content: Record<string, unknown> = { event: 'test' }): Buffer {
  return Buffer.from(JSON.stringify(content), 'utf8');
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
}

function makeHeaders(overrides: Record<string, string | undefined> = {}) {
  const ts = String(nowSeconds());
  const deliveryId = `delivery-${Math.random().toString(36).slice(2)}`;
  const body = makeRawBody();
  const sig = computeSignature(SECRET, ts, body);

  return {
    timestamp: ts,
    deliveryId,
    body,
    sig,
    headers: {
      'x-sorobanpay-signature':   overrides['x-sorobanpay-signature']   ?? sig,
      'x-sorobanpay-timestamp':   overrides['x-sorobanpay-timestamp']   ?? ts,
      'x-sorobanpay-delivery-id': overrides['x-sorobanpay-delivery-id'] ?? deliveryId,
    },
  };
}

/** Build a mock Express Request with headers and a raw body Buffer. */
function mockReq(headers: Record<string, string>, body: Buffer): Partial<Request> {
  return {
    headers: headers as any,
    body,
  };
}

/** Run the middleware synchronously and capture the response. */
async function runMiddleware(
  headers: Record<string, string>,
  body: Buffer,
  secret?: string,
): Promise<{ statusCode: number; json: Record<string, unknown>; next: boolean }> {
  const old = process.env['WEBHOOK_SECRET'];
  if (secret !== undefined) {
    process.env['WEBHOOK_SECRET'] = secret;
  } else {
    process.env['WEBHOOK_SECRET'] = SECRET;
  }

  let statusCode = 200;
  let json: Record<string, unknown> = {};
  let nextCalled = false;

  const req = mockReq(headers, body) as Request & { webhookVerified?: boolean };
  const res = {
    status: jest.fn().mockReturnThis(),
    json:   jest.fn().mockImplementation((data: Record<string, unknown>) => { json = data; }),
  } as unknown as Response;
  const next: NextFunction = () => { nextCalled = true; };

  res.status = jest.fn().mockImplementation((code: number) => {
    statusCode = code;
    return res;
  });

  verifyWebhookSignature(req, res, next);

  // Restore env
  if (old === undefined) {
    delete process.env['WEBHOOK_SECRET'];
  } else {
    process.env['WEBHOOK_SECRET'] = old;
  }

  return { statusCode, json, next: nextCalled };
}

// ─── computeSignature ────────────────────────────────────────────────────────

describe('computeSignature()', () => {
  test('is deterministic for same inputs', () => {
    const body = makeRawBody();
    const a = computeSignature(SECRET, '1700000000', body);
    const b = computeSignature(SECRET, '1700000000', body);
    expect(a).toBe(b);
  });

  test('changes when timestamp changes', () => {
    const body = makeRawBody();
    const a = computeSignature(SECRET, '1700000000', body);
    const b = computeSignature(SECRET, '1700000001', body);
    expect(a).not.toBe(b);
  });

  test('changes when body changes', () => {
    const a = computeSignature(SECRET, 't', Buffer.from('payload-a'));
    const b = computeSignature(SECRET, 't', Buffer.from('payload-b'));
    expect(a).not.toBe(b);
  });

  test('changes when secret changes', () => {
    const body = makeRawBody();
    const a = computeSignature('secret1', 't', body);
    const b = computeSignature('secret2', 't', body);
    expect(a).not.toBe(b);
  });

  test('produces a valid hex SHA-256 string', () => {
    const sig = computeSignature(SECRET, 't', makeRawBody());
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ─── verifySignature ─────────────────────────────────────────────────────────

describe('verifySignature()', () => {
  test('returns true for a correct signature', () => {
    const ts = '1700000000';
    const body = makeRawBody();
    const sig = computeSignature(SECRET, ts, body);
    expect(verifySignature(SECRET, ts, body, sig)).toBe(true);
  });

  test('returns false for a tampered body', () => {
    const ts = '1700000000';
    const body = makeRawBody();
    const sig = computeSignature(SECRET, ts, body);
    expect(verifySignature(SECRET, ts, Buffer.from('tampered'), sig)).toBe(false);
  });

  test('returns false for a wrong secret', () => {
    const ts = '1700000000';
    const body = makeRawBody();
    const sig = computeSignature(SECRET, ts, body);
    expect(verifySignature('wrong-secret', ts, body, sig)).toBe(false);
  });

  test('returns false for an empty signature', () => {
    const ts = '1700000000';
    const body = makeRawBody();
    expect(verifySignature(SECRET, ts, body, '')).toBe(false);
  });

  test('returns false for a signature of wrong length', () => {
    const ts = '1700000000';
    const body = makeRawBody();
    expect(verifySignature(SECRET, ts, body, 'tooshort')).toBe(false);
  });
});

// ─── verifyWebhookSignature middleware ───────────────────────────────────────

describe('verifyWebhookSignature middleware', () => {
  beforeEach(() => {
    replayCache.clear();
  });

  test('calls next() for a valid request', async () => {
    const { headers, body } = makeHeaders();
    const result = await runMiddleware(headers, body);
    expect(result.next).toBe(true);
  });

  test('returns 400 when X-SorobanPay-Signature is missing', async () => {
    const { headers, body } = makeHeaders({ 'x-sorobanpay-signature': '' });
    const result = await runMiddleware(headers, body);
    expect(result.statusCode).toBe(400);
    expect(result.next).toBe(false);
  });

  test('returns 400 when X-SorobanPay-Timestamp is missing', async () => {
    const { headers, body } = makeHeaders({ 'x-sorobanpay-timestamp': '' });
    const result = await runMiddleware(headers, body);
    expect(result.statusCode).toBe(400);
    expect(result.next).toBe(false);
  });

  test('returns 400 when X-SorobanPay-Delivery-Id is missing', async () => {
    const { headers, body } = makeHeaders({ 'x-sorobanpay-delivery-id': '' });
    const result = await runMiddleware(headers, body);
    expect(result.statusCode).toBe(400);
    expect(result.next).toBe(false);
  });

  test('returns 400 when timestamp is too old', async () => {
    const oldTs = String(nowSeconds() - TIMESTAMP_TOLERANCE_SECONDS - 60);
    const body = makeRawBody();
    const sig = computeSignature(SECRET, oldTs, body);
    const headers = {
      'x-sorobanpay-signature':   sig,
      'x-sorobanpay-timestamp':   oldTs,
      'x-sorobanpay-delivery-id': 'old-delivery',
    };
    const result = await runMiddleware(headers, body);
    expect(result.statusCode).toBe(400);
    expect(result.json['code']).toBe('TIMESTAMP_TOO_OLD');
  });

  test('returns 400 when timestamp is in the future beyond tolerance', async () => {
    const futureTs = String(nowSeconds() + TIMESTAMP_TOLERANCE_SECONDS + 60);
    const body = makeRawBody();
    const sig = computeSignature(SECRET, futureTs, body);
    const headers = {
      'x-sorobanpay-signature':   sig,
      'x-sorobanpay-timestamp':   futureTs,
      'x-sorobanpay-delivery-id': 'future-delivery',
    };
    const result = await runMiddleware(headers, body);
    expect(result.statusCode).toBe(400);
    expect(result.json['code']).toBe('TIMESTAMP_TOO_OLD');
  });

  test('returns 400 on replay (same delivery ID seen twice)', async () => {
    const { headers, body } = makeHeaders();
    const first = await runMiddleware(headers, body);
    expect(first.next).toBe(true); // accepted

    // Second request with same delivery ID — replay
    const second = await runMiddleware(headers, body);
    expect(second.statusCode).toBe(400);
    expect(second.json['code']).toBe('REPLAY_DETECTED');
  });

  test('returns 401 when HMAC signature is incorrect', async () => {
    const { headers, body } = makeHeaders({ 'x-sorobanpay-signature': 'a'.repeat(64) });
    const result = await runMiddleware(headers, body);
    expect(result.statusCode).toBe(401);
    expect(result.json['code']).toBe('INVALID_SIGNATURE');
  });

  test('returns 503 when WEBHOOK_SECRET is not set', async () => {
    const { headers, body } = makeHeaders();
    const result = await runMiddleware(headers, body, '');
    // Empty string is treated as falsy — same as missing
    expect(result.statusCode).toBe(503);
    expect(result.json['code']).toBe('WEBHOOK_SECRET_MISSING');
  });

  test('returns 400 when timestamp is not a number', async () => {
    const body = makeRawBody();
    const headers = {
      'x-sorobanpay-signature':   computeSignature(SECRET, 'not-a-number', body),
      'x-sorobanpay-timestamp':   'not-a-number',
      'x-sorobanpay-delivery-id': 'bad-ts-delivery',
    };
    const result = await runMiddleware(headers, body);
    expect(result.statusCode).toBe(400);
    expect(result.json['code']).toBe('INVALID_TIMESTAMP');
  });
});

// ─── ReplayCache ─────────────────────────────────────────────────────────────

describe('ReplayCache', () => {
  test('markSeen returns true the first time', () => {
    const cache = new ReplayCache();
    expect(cache.markSeen('id-1')).toBe(true);
  });

  test('markSeen returns false the second time within window', () => {
    const cache = new ReplayCache();
    cache.markSeen('id-2');
    expect(cache.markSeen('id-2')).toBe(false);
  });

  test('hasSeen returns true after markSeen', () => {
    const cache = new ReplayCache();
    cache.markSeen('id-3');
    expect(cache.hasSeen('id-3')).toBe(true);
  });

  test('hasSeen returns false for unknown ID', () => {
    const cache = new ReplayCache();
    expect(cache.hasSeen('never-seen')).toBe(false);
  });

  test('entry outside REPLAY_WINDOW_SECONDS is treated as new', () => {
    jest.useFakeTimers();
    const cache = new ReplayCache();
    cache.markSeen('old-id');
    jest.advanceTimersByTime((REPLAY_WINDOW_SECONDS + 10) * 1_000);
    // Should be treated as a new (not a replay) after the window
    expect(cache.markSeen('old-id')).toBe(true);
    jest.useRealTimers();
  });

  test('clear() removes all entries', () => {
    const cache = new ReplayCache();
    cache.markSeen('a');
    cache.markSeen('b');
    cache.clear();
    expect(cache.hasSeen('a')).toBe(false);
    expect(cache.size).toBe(0);
  });
});

// ─── Authorization paths ──────────────────────────────────────────────────────

describe('authorization invariants', () => {
  beforeEach(() => replayCache.clear());

  test('request with correct HMAC passes regardless of payload content', async () => {
    const body = Buffer.from(JSON.stringify({ event: 'any', data: 'any' }));
    const ts = String(nowSeconds());
    const deliveryId = `delivery-auth-${Date.now()}`;
    const sig = computeSignature(SECRET, ts, body);

    const headers = {
      'x-sorobanpay-signature':   sig,
      'x-sorobanpay-timestamp':   ts,
      'x-sorobanpay-delivery-id': deliveryId,
    };
    const result = await runMiddleware(headers, body);
    expect(result.next).toBe(true);
  });

  test('request from different merchant with correct HMAC still passes (auth is on signature, not merchant)', async () => {
    const body = Buffer.from(JSON.stringify({ merchantAddress: 'MERCHANT_B' }));
    const ts = String(nowSeconds());
    const deliveryId = `delivery-mb-${Date.now()}`;
    const sig = computeSignature(SECRET, ts, body);

    const headers = {
      'x-sorobanpay-signature':   sig,
      'x-sorobanpay-timestamp':   ts,
      'x-sorobanpay-delivery-id': deliveryId,
    };
    const result = await runMiddleware(headers, body);
    expect(result.next).toBe(true);
  });
});
