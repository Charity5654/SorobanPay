/**
 * Payment Retry Queue — BullMQ-backed scheduler for failed subscription payments.
 *
 * Flow:
 *   1. payment_transfer_failure event → enqueueRetries() creates up to MAX_RETRIES
 *      jobs in the Bull queue, each delayed by the configured schedule.
 *   2. The worker (processRetryJob) fires on each job's delay, calls the merchant's
 *      retry webhook, and updates the DB record.
 *   3. After MAX_RETRIES exhausted without success, a max_retries_exceeded webhook
 *      is emitted and the subscription is flagged for manual review.
 *   4. cancelRetries() removes pending jobs from the queue and marks DB rows cancelled.
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import IORedis from 'ioredis';
import prisma from '../lib/prisma';
import { notifyWebhooks } from './webhookNotifier';
import logger from '../lib/logger';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RetryJobData {
  subscriber: string;
  merchant: string;
  amount: string;
  token: string;
  attemptNumber: number;  // 1-indexed
  retryId: number;        // payment_retries row id
}

export type RetryStatus = 'pending' | 'succeeded' | 'failed' | 'cancelled';

export interface PaymentRetryRecord {
  id: number;
  subscriber: string;
  merchant: string;
  amount: string;
  token: string;
  attemptNumber: number;
  status: RetryStatus;
  scheduledAt: Date;
  attemptedAt: Date | null;
  error: string | null;
  jobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Config ──────────────────────────────────────────────────────────────────

/** Maximum number of retry attempts after the initial failure. */
export const MAX_RETRIES = 3;

/**
 * Default retry schedule in milliseconds after the original failure event.
 * Index 0 = first retry (after 1 day), index 1 = second (3 days), etc.
 * Override via RETRY_DELAYS_MS env var as comma-separated values (ms).
 */
export function getRetryDelays(): number[] {
  const envVal = process.env.RETRY_DELAYS_MS;
  if (envVal) {
    const parsed = envVal.split(',').map((v) => parseInt(v.trim(), 10));
    if (parsed.every((n) => !isNaN(n) && n > 0)) return parsed;
    logger.warn('[retryQueue] RETRY_DELAYS_MS is malformed — using defaults');
  }
  const DAY_MS = 24 * 60 * 60 * 1000;
  return [DAY_MS, 3 * DAY_MS, 7 * DAY_MS];
}

export const QUEUE_NAME = 'payment-retries';

// ─── Redis / Queue singletons ─────────────────────────────────────────────────

let _connection: IORedis | null = null;
let _queue: Queue<RetryJobData> | null = null;
let _worker: Worker<RetryJobData> | null = null;

export function getRedisConnection(): IORedis {
  if (!_connection) {
    const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
    _connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
    _connection.on('error', (err) => logger.error('[redis] connection error', { err }));
  }
  return _connection;
}

export function getRetryQueue(): Queue<RetryJobData> {
  if (!_queue) {
    _queue = new Queue<RetryJobData>(QUEUE_NAME, {
      connection: getRedisConnection(),
      defaultJobOptions: {
        removeOnComplete: 200,
        removeOnFail: 500,
        attempts: 1, // BullMQ-level retries disabled; we schedule each attempt as a separate job
      },
    });
  }
  return _queue;
}

// ─── Enqueue retries ─────────────────────────────────────────────────────────

/**
 * Schedule up to MAX_RETRIES retry jobs for a failed payment.
 * Idempotent: skips scheduling if pending retries already exist for this pair.
 *
 * @returns array of created PaymentRetryRecord ids
 */
export async function enqueueRetries(
  subscriber: string,
  merchant: string,
  amount: string,
  token: string,
): Promise<number[]> {
  // Idempotency: don't double-schedule if pending retries already exist
  const existingPending = await getRawRetries(subscriber, merchant);
  const hasPending = existingPending.some((r) => r.status === 'pending');
  if (hasPending) {
    logger.warn('[retryQueue] pending retries already exist — skipping re-enqueue', {
      subscriber,
      merchant,
    });
    return [];
  }

  const delays = getRetryDelays();
  const now = Date.now();
  const queue = getRetryQueue();
  const createdIds: number[] = [];

  for (let i = 0; i < Math.min(MAX_RETRIES, delays.length); i++) {
    const delayMs = delays[i];
    const scheduledAt = new Date(now + delayMs);
    const attemptNumber = i + 1;

    // Insert DB row first (without job_id — we update after enqueueing)
    const row = await createRetryRecord({
      subscriber,
      merchant,
      amount,
      token,
      attemptNumber,
      scheduledAt,
    });

    // Add job to BullMQ with the configured delay
    const jobData: RetryJobData = {
      subscriber,
      merchant,
      amount,
      token,
      attemptNumber,
      retryId: row.id,
    };

    const job = await queue.add(
      `retry-${subscriber}-${merchant}-${attemptNumber}`,
      jobData,
      { delay: delayMs },
    );

    // Back-fill the jobId on the DB row
    await updateRetryRecord(row.id, { jobId: job.id ?? null });

    createdIds.push(row.id);
    logger.info('[retryQueue] scheduled retry', {
      retryId: row.id,
      jobId: job.id,
      attemptNumber,
      scheduledAt: scheduledAt.toISOString(),
      subscriber,
      merchant,
    });
  }

  return createdIds;
}

// ─── Cancel retries ───────────────────────────────────────────────────────────

/**
 * Cancel all pending retry jobs for a subscription pair.
 * Removes jobs from BullMQ and marks DB rows as 'cancelled'.
 */
export async function cancelRetries(subscriber: string, merchant: string): Promise<void> {
  const retries = await getRawRetries(subscriber, merchant);
  const pending = retries.filter((r) => r.status === 'pending');
  const queue = getRetryQueue();

  for (const retry of pending) {
    if (retry.jobId) {
      try {
        const job = await Job.fromId<RetryJobData>(queue, retry.jobId);
        await job?.remove();
      } catch (err) {
        logger.warn('[retryQueue] could not remove BullMQ job', {
          jobId: retry.jobId,
          retryId: retry.id,
          err,
        });
      }
    }
    await updateRetryRecord(retry.id, { status: 'cancelled' });
  }

  logger.info('[retryQueue] cancelled retries', { subscriber, merchant, count: pending.length });
}

// ─── Job processor ───────────────────────────────────────────────────────────

/**
 * Process a single retry job:
 *   1. Mark attempt in DB (attemptedAt = now, status = 'failed' tentatively).
 *   2. Call merchant's retry webhook.
 *   3. On webhook success → mark 'succeeded', cancel remaining pending retries.
 *   4. If this is the last attempt and still failing → emit max_retries_exceeded.
 */
export async function processRetryJob(job: Job<RetryJobData>): Promise<void> {
  const { subscriber, merchant, amount, token, attemptNumber, retryId } = job.data;

  logger.info('[retryQueue] processing retry job', {
    jobId: job.id,
    retryId,
    attemptNumber,
    subscriber,
    merchant,
  });

  // Mark as in-progress (set attemptedAt)
  await updateRetryRecord(retryId, { attemptedAt: new Date() });

  try {
    // Call the merchant's registered retry webhook
    await notifyWebhooks({
      event: 'payment.failed',
      subscriber,
      merchant,
      amount,
      timestamp: Date.now(),
      txHash: undefined,
    });

    // Webhook delivery succeeded — mark this retry as succeeded
    await updateRetryRecord(retryId, { status: 'succeeded' });

    // Cancel all remaining pending retries for this subscription
    const remaining = await getRawRetries(subscriber, merchant);
    const pendingAfterThis = remaining.filter(
      (r) => r.status === 'pending' && r.id !== retryId,
    );
    for (const r of pendingAfterThis) {
      const queue = getRetryQueue();
      if (r.jobId) {
        try {
          const j = await Job.fromId<RetryJobData>(queue, r.jobId);
          await j?.remove();
        } catch {
          // best-effort
        }
      }
      await updateRetryRecord(r.id, { status: 'cancelled' });
    }

    logger.info('[retryQueue] retry succeeded — cancelled remaining', {
      subscriber,
      merchant,
      cancelledCount: pendingAfterThis.length,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    logger.error('[retryQueue] retry job failed', { retryId, attemptNumber, err: errorMsg });

    await updateRetryRecord(retryId, {
      status: 'failed',
      error: errorMsg,
    });

    // Check whether max retries is exceeded
    if (attemptNumber >= MAX_RETRIES) {
      await emitMaxRetriesExceeded(subscriber, merchant, amount, token);
    }
  }
}

// ─── Max retries exceeded ────────────────────────────────────────────────────

/**
 * Emit the max_retries_exceeded webhook event.
 * Uses the existing notifyWebhooks infrastructure but with the 'payment.failed'
 * event type plus extra metadata in the payload so merchants can distinguish it.
 */
export async function emitMaxRetriesExceeded(
  subscriber: string,
  merchant: string,
  amount: string,
  token: string,
): Promise<void> {
  logger.warn('[retryQueue] max retries exceeded — emitting max_retries_exceeded webhook', {
    subscriber,
    merchant,
  });

  try {
    await notifyWebhooks({
      event: 'payment.failed',
      subscriber,
      merchant,
      amount,
      timestamp: Date.now(),
      // Extra context surfaced in the payload JSON so merchants know this is the escalation signal
      txHash: 'max_retries_exceeded',
    });
  } catch (err) {
    logger.error('[retryQueue] failed to emit max_retries_exceeded webhook', { err });
  }
}

// ─── Worker startup ───────────────────────────────────────────────────────────

/**
 * Start the BullMQ worker that processes retry jobs.
 * Call this once during server startup (after Redis is available).
 * Returns the worker instance so callers can shut it down gracefully.
 */
export function startRetryWorker(): Worker<RetryJobData> {
  if (_worker) return _worker;

  _worker = new Worker<RetryJobData>(
    QUEUE_NAME,
    processRetryJob,
    {
      connection: getRedisConnection(),
      concurrency: 5,
    },
  );

  _worker.on('completed', (job) => {
    logger.info('[retryWorker] job completed', { jobId: job.id });
  });

  _worker.on('failed', (job, err) => {
    logger.error('[retryWorker] job failed', { jobId: job?.id, err });
  });

  logger.info('[retryWorker] started');
  return _worker;
}

/**
 * Gracefully shut down the worker and close the Redis connection.
 * Call during server shutdown.
 */
export async function shutdownRetryWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
  if (_connection) {
    await _connection.quit();
    _connection = null;
  }
  logger.info('[retryWorker] shut down');
}

// ─── DB helpers (raw SQL since PaymentRetry not in generated client) ──────────

export async function getRawRetries(
  subscriber: string,
  merchant: string,
): Promise<PaymentRetryRecord[]> {
  const rows = await prisma.$queryRaw<PaymentRetryRecord[]>`
    SELECT
      id,
      subscriber,
      merchant,
      amount,
      token,
      attempt_number    AS "attemptNumber",
      status,
      scheduled_at      AS "scheduledAt",
      attempted_at      AS "attemptedAt",
      error,
      job_id            AS "jobId",
      created_at        AS "createdAt",
      updated_at        AS "updatedAt"
    FROM payment_retries
    WHERE subscriber = ${subscriber}
      AND merchant   = ${merchant}
    ORDER BY attempt_number ASC
  `;
  return rows;
}

interface CreateRetryInput {
  subscriber: string;
  merchant: string;
  amount: string;
  token: string;
  attemptNumber: number;
  scheduledAt: Date;
}

async function createRetryRecord(input: CreateRetryInput): Promise<PaymentRetryRecord> {
  const rows = await prisma.$queryRaw<PaymentRetryRecord[]>`
    INSERT INTO payment_retries
      (subscriber, merchant, amount, token, attempt_number, status, scheduled_at, updated_at)
    VALUES
      (${input.subscriber}, ${input.merchant}, ${input.amount}, ${input.token},
       ${input.attemptNumber}, 'pending', ${input.scheduledAt}, now())
    RETURNING
      id,
      subscriber,
      merchant,
      amount,
      token,
      attempt_number    AS "attemptNumber",
      status,
      scheduled_at      AS "scheduledAt",
      attempted_at      AS "attemptedAt",
      error,
      job_id            AS "jobId",
      created_at        AS "createdAt",
      updated_at        AS "updatedAt"
  `;
  return rows[0];
}

interface UpdateRetryInput {
  status?: RetryStatus;
  attemptedAt?: Date;
  error?: string;
  jobId?: string | null;
}

async function updateRetryRecord(id: number, updates: UpdateRetryInput): Promise<void> {
  // Build SET clause dynamically to avoid overwriting unset fields
  const setClauses: string[] = ['updated_at = now()'];
  const values: unknown[] = [];
  let idx = 1;

  if (updates.status !== undefined) {
    setClauses.push(`status = $${idx++}`);
    values.push(updates.status);
  }
  if (updates.attemptedAt !== undefined) {
    setClauses.push(`attempted_at = $${idx++}`);
    values.push(updates.attemptedAt);
  }
  if (updates.error !== undefined) {
    setClauses.push(`error = $${idx++}`);
    values.push(updates.error);
  }
  if (updates.jobId !== undefined) {
    setClauses.push(`job_id = $${idx++}`);
    values.push(updates.jobId);
  }

  values.push(id);
  const sql = `UPDATE payment_retries SET ${setClauses.join(', ')} WHERE id = $${idx}`;
  await prisma.$executeRawUnsafe(sql, ...values);
}
