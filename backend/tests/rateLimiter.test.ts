/**
 * rateLimiter.test.ts — #1075
 *
 * Unit tests for the per-tenant quota middleware added in #1075.
 *
 * Verifies:
 *   1. Requests within quota call next() and set correct headers.
 *   2. Auth quota (path includes '/auth') is tracked separately.
 *   3. Read quota (GET) is tracked separately.
 *   4. Mutation quota (POST) is tracked separately.
 *   5. Different tenants maintain independent counters.
 *   6. 429 response includes Retry-After, X-RateLimit-* headers.
 *   7. X-RateLimit-Remaining decrements correctly.
 *   8. Missing x-tenant-id falls back to 'anonymous' bucket.
 *   9. TenantQuotaStore.clear() resets counters.
 *  10. X-RateLimit-Policy carries the correct comment label.
 */

import {
  tenantQuotaMiddleware,
  TenantQuotaConfig,
  TenantQuotaStore,
  defaultTenantQuotas,
} from '../src/middleware/rateLimiter';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeReq(overrides: {
  method?: string;
  path?: string;
  headers?: Record<string, string>;
} = {}): Request {
  return {
    method: 'GET',
    path: '/api/subscriptions',
    headers: {},
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
}

function makeRes() {
  const headers: Record<string, string | number> = {};
  let statusCode = 200;
  let body: any = null;

  const res: any = {
    setHeader: (key: string, value: string | number) => { headers[key] = value; },
    status: (code: number) => { statusCode = code; return res; },
    json: (data: any) => { body = data; },
    _getHeader: (key: string) => headers[key],
    _status: () => statusCode,
    _body: () => body,
    _allHeaders: () => headers,
  };
  return res as Response & {
    _getHeader(k: string): string | number;
    _status(): number;
    _body(): any;
    _allHeaders(): Record<string, string | number>;
  };
}

const TIGHT_CONFIG: TenantQuotaConfig = {
  authLimit: 2,
  readLimit: 3,
  mutationLimit: 2,
  windowMs: 60_000,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('#1075 — tenantQuotaMiddleware', () => {
  let store: TenantQuotaStore;
  let next: jest.Mock;

  beforeEach(() => {
    store = new TenantQuotaStore();
    next = jest.fn();
  });

  // ── 1. Allows requests within quota ──────────────────────────────────────

  it('calls next() for a request within the read quota', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);
    const req = makeReq({ method: 'GET', headers: { 'x-tenant-id': 'tenant-a' } });
    const res = makeRes();

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res._status()).toBe(200); // no status override
  });

  // ── 2. 429 when auth quota is exceeded ────────────────────────────────────

  it('returns 429 after auth quota is exceeded', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);

    // Exhaust auth quota (limit = 2)
    for (let i = 0; i < TIGHT_CONFIG.authLimit; i++) {
      const req = makeReq({ method: 'POST', path: '/auth/login', headers: { 'x-tenant-id': 'tenant-auth' } });
      mw(req, makeRes(), next);
    }
    next.mockClear();

    // This request should be blocked
    const req = makeReq({ method: 'POST', path: '/auth/login', headers: { 'x-tenant-id': 'tenant-auth' } });
    const res = makeRes();
    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status()).toBe(429);
    expect(res._body().error).toBe('Too Many Requests');
  });

  // ── 3. 429 when read quota is exceeded ────────────────────────────────────

  it('returns 429 after read quota (GET) is exceeded', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);

    for (let i = 0; i < TIGHT_CONFIG.readLimit; i++) {
      const req = makeReq({ method: 'GET', headers: { 'x-tenant-id': 'tenant-read' } });
      mw(req, makeRes(), next);
    }
    next.mockClear();

    const req = makeReq({ method: 'GET', headers: { 'x-tenant-id': 'tenant-read' } });
    const res = makeRes();
    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status()).toBe(429);
  });

  // ── 4. 429 when mutation quota is exceeded ────────────────────────────────

  it('returns 429 after mutation quota (POST) is exceeded', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);

    for (let i = 0; i < TIGHT_CONFIG.mutationLimit; i++) {
      const req = makeReq({ method: 'POST', path: '/api/subscribe', headers: { 'x-tenant-id': 'tenant-mut' } });
      mw(req, makeRes(), next);
    }
    next.mockClear();

    const req = makeReq({ method: 'POST', path: '/api/subscribe', headers: { 'x-tenant-id': 'tenant-mut' } });
    const res = makeRes();
    mw(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res._status()).toBe(429);
  });

  // ── 5. Tenant isolation ───────────────────────────────────────────────────

  it('maintains separate quota buckets for different tenants', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);

    // Exhaust tenant-x read quota
    for (let i = 0; i < TIGHT_CONFIG.readLimit; i++) {
      mw(makeReq({ method: 'GET', headers: { 'x-tenant-id': 'tenant-x' } }), makeRes(), next);
    }

    // tenant-y should still have a fresh bucket
    const res = makeRes();
    mw(makeReq({ method: 'GET', headers: { 'x-tenant-id': 'tenant-y' } }), res, next);

    expect(res._status()).toBe(200); // not blocked
    expect(next).toHaveBeenCalled();
  });

  // ── 6. 429 headers ────────────────────────────────────────────────────────

  it('sets Retry-After and X-RateLimit-* headers on 429', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);

    // Exceed read quota
    for (let i = 0; i <= TIGHT_CONFIG.readLimit; i++) {
      const res = makeRes();
      mw(makeReq({ method: 'GET', headers: { 'x-tenant-id': 'tenant-headers' } }), res, jest.fn());
      if (i === TIGHT_CONFIG.readLimit) {
        expect(res._getHeader('Retry-After')).toBeDefined();
        expect(res._getHeader('X-RateLimit-Limit')).toBe(String(TIGHT_CONFIG.readLimit));
        expect(res._getHeader('X-RateLimit-Remaining')).toBe('0');
        expect(res._getHeader('X-RateLimit-Reset')).toBeDefined();
        expect(res._status()).toBe(429);
      }
    }
  });

  // ── 7. X-RateLimit-Remaining decrements ──────────────────────────────────

  it('decrements X-RateLimit-Remaining with successive requests', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);
    const tenant = 'tenant-rem';

    const remainingValues: number[] = [];

    for (let i = 0; i < TIGHT_CONFIG.readLimit; i++) {
      const res = makeRes();
      mw(makeReq({ method: 'GET', headers: { 'x-tenant-id': tenant } }), res, jest.fn());
      remainingValues.push(Number(res._getHeader('X-RateLimit-Remaining')));
    }

    // Should count down: readLimit-1, readLimit-2, 0
    expect(remainingValues[0]).toBe(TIGHT_CONFIG.readLimit - 1);
    expect(remainingValues[remainingValues.length - 1]).toBe(0);
    // Strictly decreasing
    for (let i = 1; i < remainingValues.length; i++) {
      expect(remainingValues[i]).toBeLessThan(remainingValues[i - 1]);
    }
  });

  // ── 8. Anonymous fallback ─────────────────────────────────────────────────

  it('uses anonymous bucket when x-tenant-id header is absent', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);

    // Exhaust anonymous read quota
    for (let i = 0; i < TIGHT_CONFIG.readLimit; i++) {
      mw(makeReq({ method: 'GET' }), makeRes(), next); // no x-tenant-id
    }
    next.mockClear();

    const res = makeRes();
    mw(makeReq({ method: 'GET' }), res, next);

    expect(res._status()).toBe(429);
    expect(next).not.toHaveBeenCalled();
  });

  // ── 9. TenantQuotaStore.clear() ───────────────────────────────────────────

  it('TenantQuotaStore.clear(tenantId) resets that tenant counter', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);
    const tenant = 'tenant-clear';

    // Fill read bucket
    for (let i = 0; i < TIGHT_CONFIG.readLimit; i++) {
      mw(makeReq({ method: 'GET', headers: { 'x-tenant-id': tenant } }), makeRes(), jest.fn());
    }

    // Should be at limit now
    const before = makeRes();
    mw(makeReq({ method: 'GET', headers: { 'x-tenant-id': tenant } }), before, jest.fn());
    expect(before._status()).toBe(429);

    // Clear and retry — should pass
    store.clear(tenant);
    const after = makeRes();
    const afterNext = jest.fn();
    mw(makeReq({ method: 'GET', headers: { 'x-tenant-id': tenant } }), after, afterNext);
    expect(after._status()).toBe(200);
    expect(afterNext).toHaveBeenCalled();
  });

  it('TenantQuotaStore.clear() with no argument clears all tenants', () => {
    store.increment('t1', 'read', 60_000);
    store.increment('t2', 'read', 60_000);

    store.clear();

    expect(store.getCount('t1', 'read', 60_000)).toBe(0);
    expect(store.getCount('t2', 'read', 60_000)).toBe(0);
  });

  // ── 10. X-RateLimit-Policy header ────────────────────────────────────────

  it('sets X-RateLimit-Policy header with correct comment for read', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);
    const res = makeRes();
    mw(makeReq({ method: 'GET', headers: { 'x-tenant-id': 'tenant-policy' } }), res, next);
    const policy = String(res._getHeader('X-RateLimit-Policy'));
    expect(policy).toContain('read');
  });

  it('sets X-RateLimit-Policy with auth comment for auth paths', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);
    const res = makeRes();
    mw(makeReq({ method: 'POST', path: '/api/auth/challenge', headers: { 'x-tenant-id': 'tenant-apol' } }), res, next);
    const policy = String(res._getHeader('X-RateLimit-Policy'));
    expect(policy).toContain('auth');
  });

  // ── 11. defaultTenantQuotas export ───────────────────────────────────────

  it('defaultTenantQuotas has expected values', () => {
    expect(defaultTenantQuotas.authLimit).toBe(10);
    expect(defaultTenantQuotas.readLimit).toBe(120);
    expect(defaultTenantQuotas.mutationLimit).toBe(30);
    expect(defaultTenantQuotas.windowMs).toBe(60_000);
  });

  // ── 12. HEAD treated as read ──────────────────────────────────────────────

  it('treats HEAD requests as read operations', () => {
    const mw = tenantQuotaMiddleware(TIGHT_CONFIG, store);

    for (let i = 0; i < TIGHT_CONFIG.readLimit; i++) {
      mw(makeReq({ method: 'HEAD', headers: { 'x-tenant-id': 'tenant-head' } }), makeRes(), jest.fn());
    }

    const res = makeRes();
    mw(makeReq({ method: 'HEAD', headers: { 'x-tenant-id': 'tenant-head' } }), res, jest.fn());
    expect(res._status()).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// TenantQuotaStore unit tests
// ---------------------------------------------------------------------------

describe('TenantQuotaStore', () => {
  let s: TenantQuotaStore;

  beforeEach(() => { s = new TenantQuotaStore(); });

  it('increment returns the new count', () => {
    expect(s.increment('t1', 'read', 60_000)).toBe(1);
    expect(s.increment('t1', 'read', 60_000)).toBe(2);
    expect(s.increment('t1', 'read', 60_000)).toBe(3);
  });

  it('getCount returns 0 for unknown tenant', () => {
    expect(s.getCount('unknown', 'auth', 60_000)).toBe(0);
  });

  it('auth / read / mutation counters are independent', () => {
    s.increment('t1', 'auth', 60_000);
    s.increment('t1', 'read', 60_000);
    s.increment('t1', 'read', 60_000);

    expect(s.getCount('t1', 'auth', 60_000)).toBe(1);
    expect(s.getCount('t1', 'read', 60_000)).toBe(2);
    expect(s.getCount('t1', 'mutation', 60_000)).toBe(0);
  });

  it('getReset returns a future Unix epoch', () => {
    const reset = s.getReset('t1', 60_000);
    const nowSec = Math.ceil(Date.now() / 1000);
    expect(reset).toBeGreaterThanOrEqual(nowSec);
    expect(reset).toBeLessThanOrEqual(nowSec + 61);
  });
});
