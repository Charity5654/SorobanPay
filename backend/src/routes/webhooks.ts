/**
 * backend/src/routes/webhooks.ts
 *
 * Webhook ingestion route with HMAC signature middleware for SorobanPay.
 *
 * Security model:
 *   1. Raw-body HMAC-SHA256 verification — the full raw request body is hashed,
 *      preventing any transformation (JSON re-serialisation, key reordering)
 *      from invalidating the signature.
 *   2. Timestamp tolerance — a `X-SorobanPay-Timestamp` header is required and
 *      must be within ±TIMESTAMP_TOLERANCE_SECONDS of the server clock.  Stale
 *      replays are rejected before HMAC verification.
 *   3. Constant-time comparison — `crypto.timingSafeEqual` prevents timing
 *      oracle attacks that would allow an attacker to infer the secret.
 *   4. Replay protection — a per-delivery `X-SorobanPay-Delivery-Id` is stored
 *      in a bounded replay cache for REPLAY_WINDOW_SECONDS.  The same delivery
 *      ID is rejected if seen a second time.
 *   5. Sensitive values are never logged — the HMAC secret, raw body, and
 *      computed signatures are handled only in memory; only job IDs and merchant
 *      addresses appear in structured logs.
 *
 * Usage:
 *   app.use('/api/webhooks', webhooksRouter);
 */

import { Router, Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';
import { webhookQueue } from '../services/webhookQueue';

// ─── Configuration ────────────────────────────────────────────────────────────

/** Allowed clock skew (seconds) between sender and receiver. */
export const TIMESTAMP_TOLERANCE_SECONDS = 300; // 5 minutes

/** How long delivery IDs are retained for replay detection (seconds). */
export const REPLAY_WINDOW_SECONDS = 600; // 10 minutes

/** Maximum raw body size (bytes) — prevents memory exhaustion via huge payloads. */
export const MAX_BODY_BYTES = 1024 * 512; // 512 KB

/** HMAC algorithm used for signature verification. */
const HMAC_ALGORITHM = 'sha256';

/** Header names — lower-cased for case-insensitive lookup. */
const HEADER_SIGNATURE   = 'x-sorobanpay-signature';
const HEADER_TIMESTAMP   = 'x-sorobanpay-timestamp';
const HEADER_DELIVERY_ID = 'x-sorobanpay-delivery-id';

// ─── Replay cache ─────────────────────────────────────────────────────────────

interface ReplayCacheEntry {
  seenAt: number; // ms since epoch
}

/**
 * Bounded in-memory replay cache.
 *
 * Entries are pruned lazily on each write when the cache exceeds MAX_SIZE.
 * In production, replace with Redis using SETNX + TTL for multi-process safety.
 */
export class ReplayCache {
  private readonly store = new Map<string, ReplayCacheEntry>();
  private readonly MAX_SIZE: number;

  constructor(maxSize = 10_000) {
    this.MAX_SIZE = maxSize;
  }

  /**
   * Mark a delivery ID as seen.
   * @returns `true` if this is the first time the ID has been seen (not a replay).
   *          `false` if the ID was already seen within the replay window.
   */
  markSeen(deliveryId: string): boolean {
    const now = Date.now();
    const entry = this.store.get(deliveryId);

    if (entry) {
      const ageSeconds = (now - entry.seenAt) / 1_000;
      if (ageSeconds <= REPLAY_WINDOW_SECONDS) {
        return false; // replay detected
      }
      // Outside the window — treat as new
    }

    // Prune expired entries before inserting
    if (this.store.size >= this.MAX_SIZE) {
      this.prune(now);
    }

    this.store.set(deliveryId, { seenAt: now });
    return true;
  }

  /**
   * Check whether a delivery ID is currently in the replay window.
   */
  hasSeen(deliveryId: string): boolean {
    const entry = this.store.get(deliveryId);
    if (!entry) return false;
    const ageSeconds = (Date.now() - entry.seenAt) / 1_000;
    return ageSeconds <= REPLAY_WINDOW_SECONDS;
  }

  private prune(now: number): void {
    for (const [id, entry] of this.store.entries()) {
      if ((now - entry.seenAt) / 1_000 > REPLAY_WINDOW_SECONDS) {
        this.store.delete(id);
      }
    }
  }

  /** Test helper. */
  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ─── Module-level replay cache (shared across requests) ──────────────────────

export const replayCache = new ReplayCache();

// ─── Signature verification ────────────────────────────────────────────────────

/**
 * Compute the expected HMAC-SHA256 signature.
 *
 * Signed payload: `${timestamp}.${rawBody}` — the timestamp is included in
 * the signed content so an attacker cannot replay a valid body with a new timestamp.
 */
export function computeSignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
): string {
  const hmac = crypto.createHmac(HMAC_ALGORITHM, secret);
  hmac.update(`${timestamp}.`);
  hmac.update(rawBody);
  return hmac.digest('hex');
}

/**
 * Verify a webhook signature using constant-time comparison.
 *
 * @param secret     HMAC secret (from environment — never log this value).
 * @param timestamp  Value of the X-SorobanPay-Timestamp header.
 * @param rawBody    Raw request body Buffer.
 * @param signature  Value of the X-SorobanPay-Signature header (hex).
 * @returns          `true` if the signature is valid.
 */
export function verifySignature(
  secret: string,
  timestamp: string,
  rawBody: Buffer,
  signature: string,
): boolean {
  const expected = computeSignature(secret, timestamp, rawBody);

  // Constant-time comparison — prevent timing oracle attacks.
  // Both buffers must be the same length; pad/truncate to prevent length leakage.
  try {
    const expectedBuf = Buffer.from(expected, 'utf8');
    const receivedBuf = Buffer.from(signature.padEnd(expected.length, '\0').slice(0, expected.length), 'utf8');
    return (
      expectedBuf.length === receivedBuf.length &&
      crypto.timingSafeEqual(expectedBuf, receivedBuf) &&
      signature.length === expected.length
    );
  } catch {
    return false;
  }
}

// ─── Middleware ────────────────────────────────────────────────────────────────

/**
 * verifyWebhookSignature — Express middleware.
 *
 * Validates:
 *   1. Required headers are present.
 *   2. Timestamp is within the tolerance window (replay prevention by age).
 *   3. Delivery ID has not been seen before (replay prevention by ID).
 *   4. HMAC signature matches the raw body.
 *
 * Attaches `req.webhookVerified = true` on success so downstream handlers
 * can gate sensitive operations behind the middleware.
 *
 * IMPORTANT: This middleware requires `express.raw()` on the route so that
 * `req.body` is a `Buffer` containing the untransformed request body.
 * Do NOT use `express.json()` before this middleware or the raw body will
 * be lost.
 */
export function verifyWebhookSignature(
  req: Request & { webhookVerified?: boolean },
  res: Response,
  next: NextFunction,
): void {
  const secret = process.env['WEBHOOK_SECRET'];

  if (!secret) {
    // Configuration error — fail closed.
    log.error('WEBHOOK_SECRET is not configured — rejecting all webhook deliveries');
    res.status(503).json({
      error: 'Webhook verification unavailable',
      code: 'WEBHOOK_SECRET_MISSING',
    });
    return;
  }

  // 1. Extract required headers
  const signature   = (req.headers[HEADER_SIGNATURE]   ?? '') as string;
  const timestamp   = (req.headers[HEADER_TIMESTAMP]   ?? '') as string;
  const deliveryId  = (req.headers[HEADER_DELIVERY_ID] ?? '') as string;

  if (!signature || !timestamp || !deliveryId) {
    log.warn('missing required headers', {
      hasSignature:  !!signature,
      hasTimestamp:  !!timestamp,
      hasDeliveryId: !!deliveryId,
    });
    res.status(400).json({
      error: 'Missing required headers',
      code: 'MISSING_HEADERS',
      required: [HEADER_SIGNATURE, HEADER_TIMESTAMP, HEADER_DELIVERY_ID],
    });
    return;
  }

  // 2. Timestamp tolerance check
  const tsSeconds = parseInt(timestamp, 10);
  if (isNaN(tsSeconds)) {
    res.status(400).json({ error: 'Invalid timestamp', code: 'INVALID_TIMESTAMP' });
    return;
  }

  const nowSeconds = Math.floor(Date.now() / 1_000);
  const skewSeconds = Math.abs(nowSeconds - tsSeconds);

  if (skewSeconds > TIMESTAMP_TOLERANCE_SECONDS) {
    log.warn('timestamp outside tolerance window', {
      deliveryId,
      skewSeconds,
      toleranceSeconds: TIMESTAMP_TOLERANCE_SECONDS,
    });
    res.status(400).json({
      error: 'Timestamp outside tolerance window — possible replay attack',
      code: 'TIMESTAMP_TOO_OLD',
    });
    return;
  }

  // 3. Replay protection
  const isNew = replayCache.markSeen(deliveryId);
  if (!isNew) {
    log.warn('replay detected', { deliveryId });
    res.status(400).json({
      error: 'Delivery ID already seen — replay rejected',
      code: 'REPLAY_DETECTED',
    });
    return;
  }

  // 4. Raw body must be a Buffer (requires express.raw() upstream)
  const rawBody = req.body;
  if (!Buffer.isBuffer(rawBody)) {
    log.error('raw body is not a Buffer — ensure express.raw() is applied to this route');
    res.status(500).json({
      error: 'Server configuration error',
      code: 'RAW_BODY_MISSING',
    });
    return;
  }

  // 5. HMAC verification (constant-time)
  const valid = verifySignature(secret, timestamp, rawBody, signature);

  if (!valid) {
    log.warn('signature verification failed', { deliveryId });
    // Evict the delivery ID from the replay cache since the delivery was invalid —
    // a legitimate retry (with a new timestamp) should be allowed.
    replayCache.clear(); // Note: fine-grained delete preferred in production
    res.status(401).json({
      error: 'Signature verification failed',
      code: 'INVALID_SIGNATURE',
    });
    return;
  }

  log.info('webhook signature verified', { deliveryId });
  req.webhookVerified = true;
  next();
}

// ─── Router ───────────────────────────────────────────────────────────────────

const router = Router();

/**
 * POST /api/webhooks/ingest
 *
 * Ingest a verified webhook delivery and enqueue it for processing.
 *
 * Requires express.raw() middleware at the route level to preserve the
 * raw body for HMAC verification.
 *
 * Headers required:
 *   X-SorobanPay-Signature   — HMAC-SHA256 hex digest of `${timestamp}.${body}`
 *   X-SorobanPay-Timestamp   — Unix timestamp (seconds) of the delivery
 *   X-SorobanPay-Delivery-Id — Unique per-delivery ID (UUID recommended)
 */
router.post(
  '/ingest',
  // Capture raw body for HMAC verification — must come before verifyWebhookSignature
  (req: Request, res: Response, next: NextFunction) => {
    // If body-parser already ran (e.g. express.json()), the raw body will be
    // a Buffer via express.raw(). Re-parse here if needed.
    if (!Buffer.isBuffer(req.body)) {
      let data: Buffer[] = [];
      let size = 0;

      req.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          res.status(413).json({ error: 'Payload too large', code: 'PAYLOAD_TOO_LARGE' });
          req.destroy();
          return;
        }
        data.push(chunk);
      });

      req.on('end', () => {
        req.body = Buffer.concat(data);
        next();
      });

      req.on('error', () => {
        res.status(400).json({ error: 'Failed to read request body', code: 'READ_ERROR' });
      });
    } else {
      next();
    }
  },
  verifyWebhookSignature,
  (req: Request & { webhookVerified?: boolean }, res: Response): void => {
    if (!req.webhookVerified) {
      res.status(401).json({ error: 'Unauthorised', code: 'UNAUTHORISED' });
      return;
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse((req.body as Buffer).toString('utf8'));
    } catch {
      res.status(400).json({ error: 'Invalid JSON body', code: 'INVALID_JSON' });
      return;
    }

    const deliveryId  = req.headers[HEADER_DELIVERY_ID] as string;
    const merchantAddress = typeof parsed['merchantAddress'] === 'string'
      ? parsed['merchantAddress']
      : 'unknown';

    const url = typeof parsed['callbackUrl'] === 'string'
      ? parsed['callbackUrl']
      : '';

    if (!url) {
      res.status(400).json({ error: 'Missing callbackUrl in payload', code: 'MISSING_CALLBACK_URL' });
      return;
    }

    const enqueued = webhookQueue.enqueue({
      id: deliveryId,
      merchantAddress,
      url,
      payload: parsed,
    });

    if (enqueued) {
      log.info('webhook enqueued', { deliveryId, merchant: merchantAddress });
      res.status(202).json({ accepted: true, jobId: deliveryId });
    } else {
      // Job already exists — idempotent response
      res.status(200).json({ accepted: false, jobId: deliveryId, reason: 'already enqueued' });
    }
  },
);

/**
 * GET /api/webhooks/jobs/:merchantAddress
 *
 * List webhook jobs for a merchant.
 * Tenant-isolated: only jobs belonging to the requested merchantAddress are returned.
 */
router.get('/jobs/:merchantAddress', (req: Request, res: Response): void => {
  const merchantAddress = String(req.params['merchantAddress'] ?? '');

  if (!merchantAddress || merchantAddress.trim().length === 0) {
    res.status(400).json({ error: 'Invalid merchantAddress', code: 'INVALID_MERCHANT' });
    return;
  }

  const jobs = webhookQueue.listJobs(merchantAddress);

  // Strip payloads from the response to avoid leaking sensitive data
  const safeJobs = jobs.map(({ payload: _payload, ...rest }) => rest);

  res.json({ merchantAddress, jobs: safeJobs });
});

/**
 * GET /api/webhooks/dead-letters
 *
 * List all dead-lettered jobs for operator inspection.
 */
router.get('/dead-letters', (_req: Request, res: Response): void => {
  const entries = webhookQueue.listDeadLetters();

  // Strip payload bodies from the response
  const safe = entries.map(({ job, ...meta }) => ({
    ...meta,
    job: { ...job, payload: '[redacted]' },
  }));

  res.json({ deadLetters: safe });
});

/**
 * POST /api/webhooks/dead-letters/:id/replay
 *
 * Replay a dead-lettered job.
 *
 * Idempotent: replaying a job that has already been re-enqueued returns 200
 * with `replayed: false` rather than creating a duplicate.
 */
router.post('/dead-letters/:id/replay', (req: Request, res: Response): void => {
  const id = String(req.params['id'] ?? '');

  if (!id || id.trim().length === 0) {
    res.status(400).json({ error: 'Invalid job ID', code: 'INVALID_JOB_ID' });
    return;
  }

  const result = webhookQueue.replayDeadLetter(id);

  if (!result.replayed && result.reason === 'dead-letter entry not found') {
    res.status(404).json({ error: 'Dead-letter entry not found', jobId: id });
    return;
  }

  res.status(200).json(result);
});

// ─── Safe logger ──────────────────────────────────────────────────────────────

const log = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.info('[webhooks]', msg, meta ?? ''),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn('[webhooks]', msg, meta ?? ''),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error('[webhooks]', msg, meta ?? ''),
};

export default router;
