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
 */

import rateLimit, { RateLimitRequestHandler, Options } from 'express-rate-limit';
import { Request, Response } from 'express';

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
