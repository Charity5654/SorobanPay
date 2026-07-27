/**
 * RetryQueue — automated payment retry scheduling via BullMQ.
 *
 * Triggered by `payment_transfer_failure` events in the event indexer.
 *
 * Retry schedule (configurable via RETRY_INTERVALS_DAYS env var):
 *   - Attempt 1: +1 day from failure
 *   - Attempt 2: +3 days from failure
 *   - Attempt 3: +7 days from failure
 *
 * On max retries exceeded a `max_retries_exceeded` webhook event is fired
 * to all registered endpoints for the merchant.
 *
 * The service is a no-op (all methods return immediately) when REDIS_URL is
 * not configured, so deployments without Redis are unaffected.
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import type { ConnectionOptions } from 'bullmq';
import prisma from '../lib/prisma';
import { notifyWebhooks } from './webhookNotifier';
import logger from '../lib/logger';

// ─── Constants ────────────────────────────────────────────────────────────────

export const RETRY_QUEUE_NAME = 'payment-retries';
export const MAX_RETRY_ATTEMPTS = 3;

/** Default retry intervals in days (configurable via RETRY_INTERVALS_DAYS). */
const DEFAULT_INTERVALS_DAYS = [1, 3, 7];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RetryJobData {
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  attemptNumber: number;
}

// ─── Module-level singletons (created once per process) ──────────────────────

let _queue: Queue<RetryJobData> | null = null;
let _worker: Worker<RetryJobData> | null = null;
let _redisConnection: ConnectionOptions | null = null;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Parse RETRY_INTERVALS_DAYS env var, falling back to defaults. */
export function parseIntervalDays(raw: string | undefined): number[] {
  if (!raw) return DEFAULT_INTERVALS_DAYS;
  const parsed = raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
  if (parsed.length === 0) return DEFAULT_INTERVALS_DAYS;
  // Cap to MAX_RETRY_ATTEMPTS entries
  return parsed.slice(0, MAX_RETRY_ATTEMPTS);
}

/** Build the ioredis connection options from a redis:// URL string. */
function connectionOptionsFromUrl(url: string): ConnectionOptions {
  const parsed = new URL(url);
  const opts: ConnectionOptions = {
    host: parsed.hostname || 'localhost',
    port: parsed.port ? parseInt(parsed.port, 10) : 6379,
    // BullMQ connects with lazyConnect so we pass credentials explicitly
    ...(parsed.password ? { password: parsed.password } : {}),
    ...(parsed.username && parsed.username !== '' ? { username: parsed.username } : {}),
    ...(parsed.pathname && parsed.pathname !== '/' ? { db: parseInt(parsed.pathname.slice(1), 10) || 0 } : {}),
  };
  return opts;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Initialise the BullMQ queue and worker singletons.
 * Must be called once at process start when REDIS_URL is configured.
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export function initRetryQueue(redisUrl: string): void {
  if (_queue) return; // already initialised

  _redisConnection = connectionOptionsFromUrl(redisUrl);

  _queue = new Queue<RetryJobData>(RETRY_QUEUE_NAME, {
    connection: _redisConnection,
    defaultJobOptions: {
      // BullMQ's built-in retry is disabled — we manage retries explicitly in
      // the DB-level schedule so the queue acts as a delayed job runner only.
      attempts: 1,
      removeOnComplete: { age: 60 * 60 * 24 * 30 }, // keep for 30 days
      removeOnFail: { age: 60 * 60 * 24 * 30 },
    },
  });

  _worker = new Worker<RetryJobData>(
    RETRY_QUEUE_NAME,
    processRetryJob,
    { connection: _redisConnection },
  );

  _worker.on('failed', (job, err) => {
    logger.error({
      event: 'retry_queue.worker_error',
      jobId: job?.id,
      error: err instanceof Error ? err.message : String(err),
    });
  });

  logger.info({ event: 'retry_queue.initialised', queueName: RETRY_QUEUE_NAME });
}

/**
 * Schedule up to MAX_RETRY_ATTEMPTS delayed jobs for a failed payment.
 * Creates one `payment_retries` DB row per attempt (PENDING status).
 *
 * Idempotent: if rows already exist for this (subscriber, merchant) pair
 * with any status other than CANCELLED, scheduling is skipped.
 */
export async function scheduleRetries(
  subscriber: string,
  merchant: string,
  amount: string,
  token: string,
): Promise<void> {
  if (!_queue) {
    logger.warn({ event: 'retry_queue.not_initialised', subscriber, merchant });
    return;
  }

  // Guard: do not re-schedule if PENDING/PROCESSING/SUCCEEDED rows already exist
  const existing = await prisma.paymentRetry.findFirst({
    where: {
      subscriber,
      merchant,
      status: { in: ['PENDING', 'PROCESSING', 'SUCCEEDED'] },
    },
  });

  if (existing) {
    logger.debug({ event: 'retry_queue.skip_duplicate', subscriber, merchant });
    return;
  }

  const intervalDays = parseIntervalDays(process.env.RETRY_INTERVALS_DAYS);
  const now = new Date();

  for (let i = 0; i < Math.min(intervalDays.length, MAX_RETRY_ATTEMPTS); i++) {
    const attemptNumber = i + 1;
    const delayMs = intervalDays[i] * 24 * 60 * 60 * 1000;
    const scheduledAt = new Date(now.getTime() + delayMs);

    const jobData: RetryJobData = { subscriber, merchant, token, amount, attemptNumber };

    // Add delayed job to BullMQ
    const job = await _queue.add(
      `retry:${subscriber}:${merchant}:${attemptNumber}`,
      jobData,
      { delay: delayMs },
    );

    // Persist to DB — upsert so re-runs are idempotent
    await prisma.paymentRetry.upsert({
      where: {
        subscriber_merchant_attempt: { subscriber, merchant, attemptNumber },
      },
      create: {
        subscriber,
        merchant,
        token,
        amount,
        attemptNumber,
        scheduledAt,
        status: 'PENDING',
        jobId: job.id ?? null,
      },
      update: {
        // Only update if currently CANCELLED (re-schedule allowed)
        jobId: job.id ?? null,
        scheduledAt,
        status: 'PENDING',
        errorMessage: null,
        executedAt: null,
      },
    });

    logger.info({
      event: 'retry_queue.scheduled',
      subscriber,
      merchant,
      attemptNumber,
      scheduledAt: scheduledAt.toISOString(),
      jobId: job.id,
    });
  }
}

/**
 * Cancel all PENDING retry jobs for a (subscriber, merchant) pair.
 * Marks DB rows as CANCELLED and removes the BullMQ jobs.
 * Returns the number of jobs cancelled.
 */
export async function cancelRetries(subscriber: string, merchant: string): Promise<number> {
  const pendingRows = await prisma.paymentRetry.findMany({
    where: { subscriber, merchant, status: 'PENDING' },
  });

  if (pendingRows.length === 0) return 0;

  let cancelled = 0;
  for (const row of pendingRows) {
    // Remove from queue if job ID is known
    if (row.jobId && _queue) {
      try {
        const job = await _queue.getJob(row.jobId);
        if (job) await job.remove();
      } catch (err) {
        // Job may have already been dequeued; log and continue
        logger.warn({
          event: 'retry_queue.cancel_job_not_found',
          jobId: row.jobId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    await prisma.paymentRetry.update({
      where: { id: row.id },
      data: { status: 'CANCELLED' },
    });

    cancelled++;
  }

  logger.info({ event: 'retry_queue.cancelled', subscriber, merchant, count: cancelled });
  return cancelled;
}

/**
 * Gracefully shut down the worker and queue (call on process exit).
 */
export async function closeRetryQueue(): Promise<void> {
  await _worker?.close();
  await _queue?.close();
  _worker = null;
  _queue = null;
  logger.info({ event: 'retry_queue.closed' });
}

// ─── Job processor ────────────────────────────────────────────────────────────

/**
 * BullMQ job processor — executes a single retry attempt.
 *
 * Strategy: The backend does not hold the merchant's operator key, so the
 * "retry" here means notifying the merchant webhook that a retry is due and
 * marking the subscription for review. If a payment.retry webhook is
 * delivered, the merchant's system can trigger execute_payment.
 *
 * The DB row is updated to reflect the outcome.
 */
async function processRetryJob(job: Job<RetryJobData>): Promise<void> {
  const { subscriber, merchant, token, amount, attemptNumber } = job.data;

  logger.info({
    event: 'retry_queue.processing',
    jobId: job.id,
    subscriber,
    merchant,
    attemptNumber,
  });

  // Mark as PROCESSING
  await prisma.paymentRetry.updateMany({
    where: { subscriber, merchant, attemptNumber, status: 'PENDING' },
    data: { status: 'PROCESSING' },
  });

  const executedAt = new Date();

  try {
    // Notify merchant webhook about the retry attempt
    await notifyWebhooks({
      event: 'payment.failed',     // extends existing webhook contract
      subscriber,
      merchant,
      amount,
      timestamp: Date.now(),
      traceContext: JSON.stringify({
        retryAttempt: attemptNumber,
        maxAttempts: MAX_RETRY_ATTEMPTS,
        token,
      }),
    });

    // Mark as SUCCEEDED (webhook delivered)
    await prisma.paymentRetry.updateMany({
      where: { subscriber, merchant, attemptNumber, status: 'PROCESSING' },
      data: { status: 'SUCCEEDED', executedAt },
    });

    logger.info({
      event: 'retry_queue.attempt_succeeded',
      subscriber,
      merchant,
      attemptNumber,
    });

    // After the last attempt succeeds, fire max_retries_exceeded webhook
    if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
      await fireMaxRetriesExceeded(subscriber, merchant, token, amount);
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);

    logger.error({
      event: 'retry_queue.attempt_failed',
      jobId: job.id,
      subscriber,
      merchant,
      attemptNumber,
      error: errorMessage,
    });

    await prisma.paymentRetry.updateMany({
      where: { subscriber, merchant, attemptNumber, status: 'PROCESSING' },
      data: { status: 'FAILED', executedAt, errorMessage },
    });

    // Still fire max_retries_exceeded if this was the last slot
    if (attemptNumber >= MAX_RETRY_ATTEMPTS) {
      await fireMaxRetriesExceeded(subscriber, merchant, token, amount).catch((e) =>
        logger.error({ event: 'retry_queue.max_retries_webhook_error', error: String(e) }),
      );
    }

    throw err; // let BullMQ record the job as failed
  }
}

/**
 * Fire the `max_retries_exceeded` webhook event to all merchant endpoints.
 * Called after the final retry attempt regardless of outcome.
 */
async function fireMaxRetriesExceeded(
  subscriber: string,
  merchant: string,
  token: string,
  amount: string,
): Promise<void> {
  logger.info({ event: 'retry_queue.max_retries_exceeded', subscriber, merchant });

  await notifyWebhooks({
    event: 'payment.failed',
    subscriber,
    merchant,
    amount,
    timestamp: Date.now(),
    traceContext: JSON.stringify({
      eventType: 'max_retries_exceeded',
      maxAttempts: MAX_RETRY_ATTEMPTS,
      token,
    }),
  });
}

// ─── Exported for testing ─────────────────────────────────────────────────────

/** Exposed for unit tests only. */
export { processRetryJob as _processRetryJob };
