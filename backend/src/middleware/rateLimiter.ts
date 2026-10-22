/**
 * BE-59 — Rate limiting and DDoS protection.
 *
 * Features:
 *  - Per-route limits: public (60/min), auth (10/min), export (1/min)
 *  - Retry-After header on every 429 response
 *  - Body size limit enforced via express.json({ limit: '10kb' })
 *  - Configurable IP trust-proxy via RATE_LIMIT_TRUST_PROXY env var
 *  - Redis-backed store when REDIS_URL is set; falls back to memory store
 *  - Configurable IP allowlist for internal monitoring (RATE_LIMIT_ALLOWLIST)
 *
 * #1075 — Rate-limit headers and per-tenant quotas:
 *  - tenantQuotaMiddleware: separates auth / read / mutation quotas per tenant
 *  - Standard headers: X-RateLimit-Limit, X-RateLimit-Remaining,
 *    X-RateLimit-Reset, X-RateLimit-Policy
 *  - Retry-After header on 429 responses
 *  - Tenant isolation: each x-tenant-id header maintains independent counters
 */

import rateLimit, { RateLimitRequestHandler, Options } from 'express-rate-limit';
import { Request, Response, NextFunction } from 'express';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logLimitReached(req: Request): void {
  const log = (req as any).log ?? console;
  if (typeof log.warn === 'function') {
    log.warn({
      event: 'rate_limit.exceeded',
      ip: req.ip,
      path: req.path,
    });
  }
}

/**
 * Build a handler that emits a 429 with a Retry-After header.
 * windowMs is the limiter's window in milliseconds.
 */
function make429Handler(windowMs: number) {
  return (req: Request, res: Response): void => {
    logLimitReached(req);
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: retryAfterSec,
      message: `Rate limit exceeded. Please wait ${retryAfterSec} seconds before retrying.`,
    });
  };
}

// ---------------------------------------------------------------------------
// IP allowlist (comma-separated IPs in RATE_LIMIT_ALLOWLIST env var)
// ---------------------------------------------------------------------------

const rawAllowlist = process.env.RATE_LIMIT_ALLOWLIST ?? '';
const allowlistedIPs = new Set(
  rawAllowlist
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function isAllowlisted(req: Request): boolean {
  if (allowlistedIPs.size === 0) return false;
  return allowlistedIPs.has(req.ip ?? '');
}

// ---------------------------------------------------------------------------
// Optional Redis store
// ---------------------------------------------------------------------------

function buildStore(): Options['store'] | undefined {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return undefined; // memory store

  try {
    // rate-limit-redis is an optional peer dependency — only load if installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RedisStore = require('rate-limit-redis');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require('redis');
    const client = createClient({ url: redisUrl });
    client.connect().catch(() => {
      /* will be caught on first request */
    });
    return new RedisStore({ sendCommand: (...args: string[]) => client.sendCommand(args) });
  } catch {
    // rate-limit-redis not installed — silently fall back to memory
    return undefined;
  }
}

const store = buildStore();

// ---------------------------------------------------------------------------
// Rate limiter factory
// ---------------------------------------------------------------------------

function makeLimiter(windowMs: number, max: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7', // RateLimit-* headers (RFC draft 7)
    legacyHeaders: false,
    store,
    skip: (req) => isAllowlisted(req),
    handler: make429Handler(windowMs),
  });
}

// ---------------------------------------------------------------------------
// Named limiters
// ---------------------------------------------------------------------------

/** 60 requests per minute — general public endpoints */
export const publicLimiter = makeLimiter(60 * 1000, 60);

/** 10 requests per minute — auth/challenge endpoints */
export const authLimiter = makeLimiter(60 * 1000, 10);

/** 1 request per minute — export/reporting endpoints */
export const exportLimiter = makeLimiter(60 * 1000, 1);

/**
 * Legacy export — kept for backwards compat with existing index.ts usage.
 * Behaves like publicLimiter.
 */
export const apiLimiter = publicLimiter;

/** @deprecated use publicLimiter instead */
export const strictLimiter = authLimiter;

// ---------------------------------------------------------------------------
// #1075 — Per-tenant quota middleware
// ---------------------------------------------------------------------------

/** Operation categories for per-tenant quota tracking. */
export type QuotaOperationType = 'auth' | 'read' | 'mutation';

/**
 * Per-tenant quota configuration.
 * Limits are request counts per windowMs for each operation category.
 */
export interface TenantQuotaConfig {
  /** Auth endpoints (path includes '/auth'): default 10/min */
  authLimit: number;
  /** Read endpoints (GET / HEAD): default 120/min */
  readLimit: number;
  /** Mutation endpoints (POST / PUT / PATCH / DELETE): default 30/min */
  mutationLimit: number;
  /** Window size in milliseconds (default: 60 000 = 1 minute) */
  windowMs: number;
}

/** Default quota configuration suitable for most tenants. */
export const defaultTenantQuotas: TenantQuotaConfig = {
  authLimit: 10,
  readLimit: 120,
  mutationLimit: 30,
  windowMs: 60_000,
};

interface TenantBucket {
  auth: number;
  read: number;
  mutation: number;
  windowStart: number; // Unix ms when this window started
}

/**
 * In-memory per-tenant quota store.
 *
 * Maintains a counter bucket per (tenantId, windowMs) pair.
 * Automatically resets expired windows on each access.
 */
export class TenantQuotaStore {
  private buckets = new Map<string, TenantBucket>();

  private getBucket(tenantId: string, windowMs: number): TenantBucket {
    const now = Date.now();
    const existing = this.buckets.get(tenantId);

    if (!existing || now - existing.windowStart >= windowMs) {
      // New window — reset counters
      const fresh: TenantBucket = { auth: 0, read: 0, mutation: 0, windowStart: now };
      this.buckets.set(tenantId, fresh);
      return fresh;
    }
    return existing;
  }

  /**
   * Increment the counter for the given operation type and return the new count.
   */
  increment(tenantId: string, type: QuotaOperationType, windowMs: number): number {
    const bucket = this.getBucket(tenantId, windowMs);
    bucket[type] += 1;
    return bucket[type];
  }

  /** Return the current count for the given operation type (without incrementing). */
  getCount(tenantId: string, type: QuotaOperationType, windowMs: number): number {
    const bucket = this.getBucket(tenantId, windowMs);
    return bucket[type];
  }

  /**
   * Return the Unix epoch (seconds) when the current window resets.
   */
  getReset(tenantId: string, windowMs: number): number {
    const bucket = this.getBucket(tenantId, windowMs);
    return Math.ceil((bucket.windowStart + windowMs) / 1000);
  }

  /**
   * Clear quota state for a specific tenant, or all tenants if no id given.
   */
  clear(tenantId?: string): void {
    if (tenantId) {
      this.buckets.delete(tenantId);
    } else {
      this.buckets.clear();
    }
  }
}

/** Determine the quota operation type from an Express request. */
function resolveOperationType(req: Request): QuotaOperationType {
  if (req.path && req.path.includes('/auth')) return 'auth';
  const method = (req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return 'read';
  return 'mutation';
}

/** Return the limit for a given operation type from a TenantQuotaConfig. */
function getLimit(config: TenantQuotaConfig, type: QuotaOperationType): number {
  if (type === 'auth') return config.authLimit;
  if (type === 'read') return config.readLimit;
  return config.mutationLimit;
}

/**
 * Express middleware factory that enforces per-tenant request quotas with
 * standard rate-limit response headers.
 *
 * Headers set on every response:
 *   - X-RateLimit-Limit     — the quota for this operation type
 *   - X-RateLimit-Remaining — requests left in the current window
 *   - X-RateLimit-Reset     — Unix epoch (seconds) when the window resets
 *   - X-RateLimit-Policy    — human-readable policy string
 *
 * Additional header on 429:
 *   - Retry-After — seconds until the window resets
 *
 * @param config   Quota limits and window size.
 * @param store    Optional quota store (defaults to a new TenantQuotaStore).
 */
export function tenantQuotaMiddleware(
  config: TenantQuotaConfig = defaultTenantQuotas,
  store: TenantQuotaStore = new TenantQuotaStore(),
) {
  return function tenantQuotaHandler(req: Request, res: Response, next: NextFunction): void {
    // Resolve tenant id: prefer x-tenant-id header, fall back to 'anonymous'
    const tenantId =
      (Array.isArray(req.headers['x-tenant-id'])
        ? req.headers['x-tenant-id'][0]
        : req.headers['x-tenant-id']) ?? 'anonymous';

    const opType = resolveOperationType(req);
    const limit = getLimit(config, opType);
    const count = store.increment(tenantId, opType, config.windowMs);
    const remaining = Math.max(0, limit - count);
    const reset = store.getReset(tenantId, config.windowMs);
    const retryAfterSec = Math.ceil(config.windowMs / 1000);

    // Always set informational headers
    res.setHeader('X-RateLimit-Limit', String(limit));
    res.setHeader('X-RateLimit-Remaining', String(remaining));
    res.setHeader('X-RateLimit-Reset', String(reset));
    res.setHeader('X-RateLimit-Policy', `${limit};w=${Math.ceil(config.windowMs / 1000)};comment="${opType}"`);

    if (count > limit) {
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'Too Many Requests',
        retryAfter: retryAfterSec,
        message: `Tenant quota exceeded for ${opType} operations. Please wait ${retryAfterSec} seconds.`,
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function logLimitReached(req: Request): void {
  const log = (req as any).log ?? console;
  if (typeof log.warn === 'function') {
    log.warn({
      event: 'rate_limit.exceeded',
      ip: req.ip,
      path: req.path,
    });
  }
}

/**
 * Build a handler that emits a 429 with a Retry-After header.
 * windowMs is the limiter's window in milliseconds.
 */
function make429Handler(windowMs: number) {
  return (req: Request, res: Response): void => {
    logLimitReached(req);
    const retryAfterSec = Math.ceil(windowMs / 1000);
    res.setHeader('Retry-After', String(retryAfterSec));
    res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: retryAfterSec,
      message: `Rate limit exceeded. Please wait ${retryAfterSec} seconds before retrying.`,
    });
  };
}

// ---------------------------------------------------------------------------
// IP allowlist (comma-separated IPs in RATE_LIMIT_ALLOWLIST env var)
// ---------------------------------------------------------------------------

const rawAllowlist = process.env.RATE_LIMIT_ALLOWLIST ?? '';
const allowlistedIPs = new Set(
  rawAllowlist
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
);

function isAllowlisted(req: Request): boolean {
  if (allowlistedIPs.size === 0) return false;
  return allowlistedIPs.has(req.ip ?? '');
}

// ---------------------------------------------------------------------------
// Optional Redis store
// ---------------------------------------------------------------------------

function buildStore(): Options['store'] | undefined {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return undefined; // memory store

  try {
    // rate-limit-redis is an optional peer dependency — only load if installed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RedisStore = require('rate-limit-redis');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { createClient } = require('redis');
    const client = createClient({ url: redisUrl });
    client.connect().catch(() => {
      /* will be caught on first request */
    });
    return new RedisStore({ sendCommand: (...args: string[]) => client.sendCommand(args) });
  } catch {
    // rate-limit-redis not installed — silently fall back to memory
    return undefined;
  }
}

const store = buildStore();

// ---------------------------------------------------------------------------
// Rate limiter factory
// ---------------------------------------------------------------------------

function makeLimiter(windowMs: number, max: number): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: 'draft-7', // RateLimit-* headers (RFC draft 7)
    legacyHeaders: false,
    store,
    skip: (req) => isAllowlisted(req),
    handler: make429Handler(windowMs),
  });
}

// ---------------------------------------------------------------------------
// Named limiters
// ---------------------------------------------------------------------------

/** 60 requests per minute — general public endpoints */
export const publicLimiter = makeLimiter(60 * 1000, 60);

/** 10 requests per minute — auth/challenge endpoints */
export const authLimiter = makeLimiter(60 * 1000, 10);

/** 1 request per minute — export/reporting endpoints */
export const exportLimiter = makeLimiter(60 * 1000, 1);

/**
 * Legacy export — kept for backwards compat with existing index.ts usage.
 * Behaves like publicLimiter.
 */
export const apiLimiter = publicLimiter;

/** @deprecated use publicLimiter instead */
export const strictLimiter = authLimiter;
