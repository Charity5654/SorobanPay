/**
 * retryQueue — DB-backed in-process payment retry queue.
 *
 * Architecture:
 *   - Jobs are rows in the `payment_retries` table (status: pending|processing|succeeded|failed|cancelled).
 *   - A cron tick (driven from index.ts) calls processDueJobs() every minute.
 *   - Each tick picks up all rows where scheduledAt <= now AND status = 'pending',
 *     transitions them to 'processing', then delegates execution to the supplied handler.
 *
 * This avoids a Redis dependency while preserving idempotency and durability.
 */

import prisma from '../lib/prisma';
import logger from '../lib/logger';

export type RetryStatus = 'pending' | 'processing' | 'succeeded' | 'failed' | 'cancelled';

export interface RetryJob {
  id: number;
  subscriber: string;
  merchant: string;
  amount: string;
  token: string;
  attemptNumber: number;
  status: RetryStatus;
  scheduledAt: Date;
  executedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type JobHandler = (job: RetryJob) => Promise<void>;

export class RetryQueue {
  private handler: JobHandler | null = null;

  /** Register the function that will be called for each due job. */
  registerHandler(handler: JobHandler): void {
    this.handler = handler;
  }

  /**
   * Enqueue a new retry job.
   * Idempotent: if a pending job already exists for the same
   * (subscriber, merchant, attemptNumber) it is returned unchanged.
   */
  async enqueue(
    subscriber: string,
    merchant: string,
    amount: string,
    token: string,
    attemptNumber: number,
    scheduledAt: Date,
  ): Promise<RetryJob> {
    // Idempotency guard: don't double-schedule the same attempt
    const existing = await prisma.paymentRetry.findFirst({
      where: {
        subscriber,
        merchant,
        attemptNumber,
        status: { in: ['pending', 'processing'] },
      },
    });

    if (existing) {
      logger.info({
        event: 'retry_queue.duplicate_skipped',
        subscriber,
        merchant,
        attemptNumber,
      });
      return existing as RetryJob;
    }

    const job = await prisma.paymentRetry.create({
      data: {
        subscriber,
        merchant,
        amount,
        token,
        attemptNumber,
        status: 'pending',
        scheduledAt,
      },
    });

    logger.info({
      event: 'retry_queue.enqueued',
      jobId: job.id,
      subscriber,
      merchant,
      attemptNumber,
      scheduledAt: scheduledAt.toISOString(),
    });

    return job as RetryJob;
  }

  /**
   * Cancel all pending/processing retry jobs for a (subscriber, merchant) pair.
   * Returns the count of cancelled rows.
   */
  async cancelAll(subscriber: string, merchant: string): Promise<number> {
    const result = await prisma.paymentRetry.updateMany({
      where: {
        subscriber,
        merchant,
        status: { in: ['pending', 'processing'] },
      },
      data: { status: 'cancelled' },
    });

    logger.info({
      event: 'retry_queue.cancelled',
      subscriber,
      merchant,
      count: result.count,
    });

    return result.count;
  }

  /**
   * Process all jobs whose scheduledAt has passed and whose status is 'pending'.
   * Called by the cron job every minute.
   */
  async processDueJobs(): Promise<void> {
    if (!this.handler) {
      logger.warn({ event: 'retry_queue.no_handler' });
      return;
    }

    const now = new Date();

    // Atomically claim due jobs by setting them to 'processing'
    // We do a find-then-update (two queries) because Prisma doesn't support
    // UPDATE … RETURNING in a single step across all drivers.
    const dueJobs = await prisma.paymentRetry.findMany({
      where: {
        status: 'pending',
        scheduledAt: { lte: now },
      },
      orderBy: { scheduledAt: 'asc' },
    });

    if (dueJobs.length === 0) return;

    logger.info({ event: 'retry_queue.processing', count: dueJobs.length });

    for (const job of dueJobs) {
      // Transition to processing (acts as a lock for concurrent workers)
      const claimed = await prisma.paymentRetry.updateMany({
        where: { id: job.id, status: 'pending' },
        data: { status: 'processing', executedAt: new Date() },
      });

      // Another worker already claimed this job — skip
      if (claimed.count === 0) continue;

      const updatedJob = { ...job, status: 'processing' as RetryStatus, executedAt: new Date() };

      try {
        await this.handler(updatedJob as RetryJob);

        await prisma.paymentRetry.update({
          where: { id: job.id },
          data: { status: 'succeeded' },
        });

        logger.info({
          event: 'retry_queue.job_succeeded',
          jobId: job.id,
          attemptNumber: job.attemptNumber,
        });
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);

        await prisma.paymentRetry.update({
          where: { id: job.id },
          data: { status: 'failed', error: errorMsg },
        });

        logger.error({
          event: 'retry_queue.job_failed',
          jobId: job.id,
          attemptNumber: job.attemptNumber,
          error: errorMsg,
        });
      }
    }
  }

  /** Return all retry records for a given (subscriber, merchant) pair, newest first. */
  async getRetries(subscriber: string, merchant: string): Promise<RetryJob[]> {
    const rows = await prisma.paymentRetry.findMany({
      where: { subscriber, merchant },
      orderBy: { scheduledAt: 'asc' },
    });
    return rows as RetryJob[];
  }
}

/** Singleton instance shared across the process. */
export const retryQueue = new RetryQueue();
