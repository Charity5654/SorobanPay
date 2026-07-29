/**
 * retryScheduler — orchestrates the payment retry lifecycle.
 *
 * Responsibilities:
 *   1. On payment_transfer_failure: schedule retry jobs into retryQueue
 *      following the configured +1 / +3 / +7 day intervals.
 *   2. Execute each retry attempt by calling execute_payment on-chain
 *      (delegated to PaymentScheduler.executePaymentForRetry).
 *   3. Fire the `max_retries_exceeded` webhook once all attempts are exhausted.
 *
 * Retry interval resolution (highest priority first):
 *   a. Per-merchant RetryConfig.intervalsDays row in DB
 *   b. RETRY_INTERVALS_DAYS env var  (e.g. "1,3,7")
 *   c. Hard-coded default: [1, 3, 7]
 */

import prisma from '../lib/prisma';
import logger from '../lib/logger';
import { retryQueue, RetryJob } from './retryQueue';

export interface RetrySchedulerOptions {
  rpcUrl: string;
  contractId: string;
  operatorSecret: string;
  networkPassphrase?: string;
}

/** Shape of the max_retries_exceeded webhook payload. */
export interface MaxRetriesWebhookPayload {
  event: 'max_retries_exceeded';
  subscriber: string;
  merchant: string;
  amount: string;
  token: string;
  totalAttempts: number;
  timestamp: number;
}

const DEFAULT_INTERVALS_DAYS = [1, 3, 7];

/** Parse a comma-separated days string like "1,3,7" into a number array. */
function parseIntervals(raw: string): number[] {
  return raw
    .split(',')
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n > 0);
}

/** Resolve retry intervals for a merchant: DB → env → default. */
async function resolveIntervals(merchant: string): Promise<number[]> {
  try {
    const config = await prisma.retryConfig.findUnique({ where: { merchant } });
    if (config?.intervalsDays) {
      const parsed = parseIntervals(config.intervalsDays);
      if (parsed.length > 0) return parsed;
    }
  } catch {
    // DB not available; fall through to env
  }

  const envIntervals = process.env.RETRY_INTERVALS_DAYS;
  if (envIntervals) {
    const parsed = parseIntervals(envIntervals);
    if (parsed.length > 0) return parsed;
  }

  return DEFAULT_INTERVALS_DAYS;
}

/** Resolve the webhook URL for max_retries_exceeded for a merchant: DB → env. */
async function resolveWebhookUrl(merchant: string): Promise<string | null> {
  try {
    const config = await prisma.retryConfig.findUnique({ where: { merchant } });
    if (config?.webhookUrl) return config.webhookUrl;
  } catch {
    // fall through
  }

  // Check merchant's registered webhook endpoints as fallback
  try {
    const endpoint = await prisma.webhookEndpoint.findFirst({
      where: { merchant, active: true },
    });
    if (endpoint?.url) return endpoint.url;
  } catch {
    // fall through
  }

  return process.env.RETRY_WEBHOOK_URL_FALLBACK ?? null;
}

export class RetryScheduler {
  private executePaymentFn: (subscriber: string, merchant: string) => Promise<string>;

  constructor(
    executePaymentFn: (subscriber: string, merchant: string) => Promise<string>,
  ) {
    this.executePaymentFn = executePaymentFn;
    // Wire our job handler into the shared queue
    retryQueue.registerHandler(this.handleJob.bind(this));
  }

  /**
   * Called by eventIndexer when a payment_transfer_failure event is received.
   * Schedules retry attempts 1..N based on configured intervals.
   * Already-existing pending/processing jobs for this pair are skipped (idempotent).
   */
  async scheduleRetries(
    subscriber: string,
    merchant: string,
    amount: string,
    token: string,
  ): Promise<void> {
    const intervals = await resolveIntervals(merchant);

    logger.info({
      event: 'retry_scheduler.scheduling',
      subscriber,
      merchant,
      intervals,
    });

    const now = new Date();

    for (let i = 0; i < intervals.length; i++) {
      const daysOffset = intervals[i];
      const scheduledAt = new Date(now.getTime() + daysOffset * 24 * 60 * 60 * 1000);
      const attemptNumber = i + 1;

      await retryQueue.enqueue(subscriber, merchant, amount, token, attemptNumber, scheduledAt);
    }
  }

  /**
   * Job handler invoked by retryQueue.processDueJobs() for each due job.
   * Attempts execute_payment on-chain.
   * After the final attempt (attemptNumber === total scheduled), fires the
   * max_retries_exceeded webhook if the payment still failed.
   */
  private async handleJob(job: RetryJob): Promise<void> {
    const { subscriber, merchant, amount, token, attemptNumber } = job;

    logger.info({
      event: 'retry_scheduler.attempt_start',
      jobId: job.id,
      attemptNumber,
      subscriber,
      merchant,
    });

    // Attempt on-chain payment
    const txHash = await this.executePaymentFn(subscriber, merchant);

    logger.info({
      event: 'retry_scheduler.attempt_succeeded',
      jobId: job.id,
      attemptNumber,
      txHash,
    });

    // Cancel any remaining pending retries for this pair — payment succeeded
    const remaining = await retryQueue.cancelAll(subscriber, merchant);
    if (remaining > 0) {
      logger.info({
        event: 'retry_scheduler.remaining_cancelled_after_success',
        subscriber,
        merchant,
        count: remaining,
      });
    }
  }

  /**
   * Called by retryQueue after a job transitions to 'failed'.
   * Checks whether all attempts for this pair are exhausted, and if so fires the
   * max_retries_exceeded webhook.
   *
   * This method is called externally (from processJobFailure) rather than inside
   * handleJob so that the queue can set the job's final status before we count.
   */
  async onJobFailed(job: RetryJob): Promise<void> {
    const { subscriber, merchant, amount, token } = job;

    const intervals = await resolveIntervals(merchant);
    const maxAttempts = intervals.length;

    // Count how many attempts are still pending/processing
    const pendingCount = await prisma.paymentRetry.count({
      where: {
        subscriber,
        merchant,
        status: { in: ['pending', 'processing'] },
      },
    });

    if (pendingCount > 0) {
      // More retries remain — let the queue handle them
      return;
    }

    // All attempts done — check if any succeeded
    const successCount = await prisma.paymentRetry.count({
      where: { subscriber, merchant, status: 'succeeded' },
    });

    if (successCount > 0) return; // At least one succeeded — no webhook needed

    logger.warn({
      event: 'retry_scheduler.max_retries_exceeded',
      subscriber,
      merchant,
      maxAttempts,
    });

    await this.fireMaxRetriesWebhook(subscriber, merchant, amount, token, maxAttempts);
  }

  /** Deliver the max_retries_exceeded webhook to the merchant's endpoint. */
  private async fireMaxRetriesWebhook(
    subscriber: string,
    merchant: string,
    amount: string,
    token: string,
    totalAttempts: number,
  ): Promise<void> {
    const webhookUrl = await resolveWebhookUrl(merchant);

    if (!webhookUrl) {
      logger.warn({
        event: 'retry_scheduler.no_webhook_url',
        merchant,
        message: 'max_retries_exceeded: no webhook URL configured; skipping delivery',
      });
      return;
    }

    const payload: MaxRetriesWebhookPayload = {
      event: 'max_retries_exceeded',
      subscriber,
      merchant,
      amount,
      token,
      totalAttempts,
      timestamp: Math.floor(Date.now() / 1000),
    };

    try {
      const res = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      logger.info({
        event: 'retry_scheduler.webhook_delivered',
        merchant,
        webhookUrl,
        status: res.status,
        ok: res.ok,
      });

      // Record delivery in the webhook_deliveries table for audit
      await prisma.webhookDelivery.create({
        data: {
          url: webhookUrl,
          merchant,
          event: 'max_retries_exceeded',
          payload: JSON.stringify(payload),
          statusCode: res.status,
          attempt: 1,
          success: res.ok,
        },
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.error({
        event: 'retry_scheduler.webhook_failed',
        merchant,
        webhookUrl,
        error: errorMsg,
      });

      await prisma.webhookDelivery.create({
        data: {
          url: webhookUrl,
          merchant,
          event: 'max_retries_exceeded',
          payload: JSON.stringify(payload),
          statusCode: 0,
          attempt: 1,
          success: false,
          error: errorMsg,
        },
      });
    }
  }
}

/**
 * Factory: creates a RetryScheduler wired to an on-chain execute_payment call.
 * Returns null when OPERATOR_SECRET is not configured (same guard as PaymentScheduler).
 */
export function createRetryScheduler(
  rpcUrl: string,
  contractId: string,
  operatorSecret: string | undefined,
  networkPassphrase: string,
): RetryScheduler | null {
  if (!operatorSecret) return null;

  const { PaymentScheduler } = require('./paymentScheduler') as typeof import('./paymentScheduler');
  const scheduler = new PaymentScheduler(rpcUrl, contractId, operatorSecret, networkPassphrase);

  return new RetryScheduler(
    (subscriber: string, merchant: string) => scheduler.executePayment(subscriber, merchant),
  );
}
