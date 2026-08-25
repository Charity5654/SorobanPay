/**
 * Webhook Delivery Queue — BE-53
 *
 * BullMQ-backed job queue that delivers webhook notifications to merchant
 * endpoints. Failed deliveries are automatically retried with exponential
 * backoff (1 minute → 5 minutes → 30 minutes, 3 total attempts).
 *
 * Architecture:
 *   enqueueWebhookDelivery(data) — add a delivery job to the BullMQ queue
 *   startWebhookWorker()         — start a BullMQ Worker to process jobs
 *   shutdownWebhookWorker()      — gracefully drain the worker
 *
 * Signature:
 *   All deliveries include X-SorobanPay-Signature (HMAC-SHA256) when the
 *   endpoint has a secret configured.
 *
 * Security:
 *   In production, only HTTPS webhook URLs are delivered to (enforced at
 *   registration time in the webhooks router).
 */

import { Queue, Worker, Job } from 'bullmq';
import IORedis from 'ioredis';
import { createHmac, randomUUID } from 'crypto';
import prisma from '../lib/prisma';
import { WebhookPayload, deriveEventId } from './webhookNotifier';

// ─── Redis connection ─────────────────────────────────────────────────────────

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379';

function createRedisConnection(): IORedis {
  return new IORedis(REDIS_URL, {
    maxRetriesPerRequest: null, // required for BullMQ
  });
}

// ─── Queue definition ─────────────────────────────────────────────────────────

const QUEUE_NAME = 'webhook-delivery';

/** Retry backoff schedule: 1 minute, 5 minutes, 30 minutes (in ms). */
const BACKOFF_DELAYS_MS = [60_000, 300_000, 1_800_000];

export interface WebhookJobData {
  endpointId: number;
  payload: WebhookPayload;
  eventId: string;
}

let _queue: Queue | null = null;

export function getWebhookQueue(): Queue | null {
  return _queue;
}

/**
 * Enqueue a webhook delivery job.
 * If Redis is unavailable (queue not initialised), falls back to no-op
 * and logs a warning — the synchronous notifier in webhookNotifier.ts
 * handles the delivery directly in that case.
 */
export async function enqueueWebhookDelivery(data: WebhookJobData): Promise<void> {
  if (!_queue) {
    console.warn('[webhookQueue] Queue not initialised — skipping enqueue');
    return;
  }
  await _queue.add('deliver', data, {
    attempts: 3,
    backoff: {
      type: 'custom',
      delay: 60_000, // initial delay; custom strategy overrides per-attempt below
    },
    removeOnComplete: 100,  // keep last 100 successful jobs for debugging
    removeOnFail: 200,      // keep last 200 failed jobs
  });
}

// ─── Worker ───────────────────────────────────────────────────────────────────

let _worker: Worker | null = null;

/**
 * Start the BullMQ worker that processes webhook delivery jobs.
 * Returns the Worker instance (useful for testing).
 */
export function startWebhookWorker(): Worker {
  if (_worker) return _worker;

  const connection = createRedisConnection();

  _queue = new Queue(QUEUE_NAME, { connection: createRedisConnection() });

  _worker = new Worker<WebhookJobData>(
    QUEUE_NAME,
    async (job: Job<WebhookJobData>) => {
      await processWebhookJob(job);
    },
    {
      connection,
      concurrency: 5,
      // Custom backoff: index 0 → 1m, 1 → 5m, 2 → 30m
      settings: {
        backoffStrategy: (attemptsMade: number) => {
          return BACKOFF_DELAYS_MS[Math.min(attemptsMade - 1, BACKOFF_DELAYS_MS.length - 1)];
        },
      },
    },
  );

  _worker.on('completed', (job) => {
    console.log(`[webhookQueue] Job ${job.id} completed (endpoint ${job.data.endpointId})`);
  });

  _worker.on('failed', (job, err) => {
    console.error(`[webhookQueue] Job ${job?.id} failed: ${err.message}`);
  });

  console.log('[webhookQueue] Worker started');
  return _worker;
}

/** Gracefully drain and close the webhook worker. */
export async function shutdownWebhookWorker(): Promise<void> {
  if (_worker) {
    await _worker.close();
    _worker = null;
  }
  if (_queue) {
    await _queue.close();
    _queue = null;
  }
  console.log('[webhookQueue] Worker shut down');
}

// ─── Job processor ────────────────────────────────────────────────────────────

async function processWebhookJob(job: Job<WebhookJobData>): Promise<void> {
  const { endpointId, payload, eventId } = job.data;
  const attemptNumber = (job.attemptsMade ?? 0) + 1;

  // Load endpoint from DB (may have been deleted since enqueue)
  const endpoint = await prisma.webhookEndpoint.findUnique({
    where: { id: endpointId },
  });

  if (!endpoint || !endpoint.active) {
    console.log(`[webhookQueue] Endpoint ${endpointId} not found or inactive — skipping`);
    return;
  }

  const deliveryId = randomUUID();
  const body = JSON.stringify({ ...payload, eventId });

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-SorobanPay-Event-ID': eventId,
    'X-SorobanPay-Delivery-ID': deliveryId,
    'X-SorobanPay-Timestamp': String(Math.floor(Date.now() / 1000)),
  };

  // Add HMAC signature if endpoint has a secret
  if (endpoint.secret) {
    const hmac = createHmac('sha256', endpoint.secret).update(body).digest('hex');
    headers['X-SorobanPay-Signature'] = `sha256=${hmac}`;
  }

  try {
    const res = await fetch(endpoint.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10_000),
    });

    await prisma.webhookDelivery.create({
      data: {
        eventId,
        deliveryId,
        url: endpoint.url,
        merchant: endpoint.merchant,
        event: payload.event,
        payload: body,
        statusCode: res.status,
        attempt: attemptNumber,
        success: res.ok,
        endpointId,
      },
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${endpoint.url}`);
    }

    console.log(
      `[webhookQueue] Delivered ${payload.event} to ${endpoint.url} ` +
      `(attempt ${attemptNumber}, status ${res.status})`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Record failed attempt
    await prisma.webhookDelivery.create({
      data: {
        eventId,
        deliveryId,
        url: endpoint.url,
        merchant: endpoint.merchant,
        event: payload.event,
        payload: body,
        statusCode: 0,
        attempt: attemptNumber,
        success: false,
        error: msg,
        endpointId,
      },
    });

    // Re-throw so BullMQ can schedule the next retry
    throw err;
  }
}
