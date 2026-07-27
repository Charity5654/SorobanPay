import { createHash, createHmac, randomUUID } from 'crypto';
import prisma from '../lib/prisma';
import { getTracer, withSpan, SpanKind } from '../lib/tracing';

export type WebhookEventType = 'payment.executed' | 'payment.failed' | 'subscription.cancelled';

export interface WebhookPayload {
  event: WebhookEventType;
  subscriber: string;
  merchant: string;
  amount: string;
  txHash?: string;
  /** Zero-based index of this event within its transaction. Used to build the stable Event ID. */
  eventIndex?: number;
  timestamp: number;
  /** Optional: trace context to link webhook span to originating event span */
  traceContext?: string;
}

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 300_000];

const WEBHOOK_TRACER = 'sorobanpay.webhook-notifier';

/**
 * Derive a stable Event ID from a transaction hash and event index.
 *
 * The Event ID is constant across all retry attempts for the same on-chain
 * event. Merchant endpoints use this as their idempotency key to safely
 * deduplicate retries.
 *
 * Format: sha256("<txHash>:<eventIndex>"), hex-encoded.
 */
export function deriveEventId(txHash: string, eventIndex: number): string {
  return createHash('sha256')
    .update(`${txHash}:${eventIndex}`)
    .digest('hex');
}

/**
 * Generate the HMAC-SHA256 signature for a webhook payload body.
 * Merchants can verify this signature using their endpoint secret.
 *
 * Signature format: "sha256=<hex_digest>"
 */
export function signPayload(body: string, secret: string): string {
  const hmac = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

/**
 * Deliver a webhook notification to all registered endpoints for the merchant.
 * Failed deliveries are retried up to MAX_ATTEMPTS times with exponential back-off.
 *
 * Each delivery includes:
 *   X-SorobanPay-Event-ID    — stable across retries (idempotency key for merchants)
 *   X-SorobanPay-Delivery-ID — unique per attempt (changes on every retry)
 *   X-SorobanPay-Signature   — HMAC-SHA256 if endpoint has a secret configured
 */
export async function notifyWebhooks(payload: WebhookPayload): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { merchant: payload.merchant, active: true },
  });

  // Derive the stable Event ID once — shared across all endpoint deliveries
  // for this same event occurrence.
  const eventId = payload.txHash
    ? deriveEventId(payload.txHash, payload.eventIndex ?? 0)
    : randomUUID(); // fallback for events without a tx hash

  await Promise.all(
    endpoints.map((ep: { id: number; url: string; secret: string | null }) =>
      deliverWithRetry(ep, payload, eventId),
    ),
  );
}

async function deliverWithRetry(
  endpoint: { id: number; url: string; secret: string | null },
  payload: WebhookPayload,
  eventId: string,
): Promise<void> {
  const body = JSON.stringify({
    ...payload,
    // Embed the stable event ID in the payload body as well so merchants
    // can read it without inspecting headers.
    eventId,
  });

  await withSpan(
    WEBHOOK_TRACER,
    'webhook.deliver',
    async (deliverySpan) => {
      deliverySpan.setAttributes({
        'webhook.url': endpoint.url,
        'webhook.merchant': payload.merchant,
        'webhook.event': payload.event,
        'webhook.event_id': eventId,
        'webhook.max_attempts': MAX_ATTEMPTS,
      });

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

        // A fresh Delivery ID is generated for every attempt.
        const deliveryId = randomUUID();

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          // Stable across retries — merchant's idempotency key
          'X-SorobanPay-Event-ID': eventId,
          // Unique per attempt — for request tracing / deduplication on our side
          'X-SorobanPay-Delivery-ID': deliveryId,
          'X-SorobanPay-Timestamp': String(Math.floor(Date.now() / 1000)),
        };

        // Add HMAC signature if the endpoint has a secret configured.
        if (endpoint.secret) {
          headers['X-SorobanPay-Signature'] = signPayload(body, endpoint.secret);
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
              merchant: payload.merchant,
              event: payload.event,
              payload: body,
              statusCode: res.status,
              attempt: attempt + 1,
              success: res.ok,
              endpointId: endpoint.id,
            },
          });

          deliverySpan.setAttributes({
            'webhook.attempt': attempt + 1,
            'webhook.delivery_id': deliveryId,
            'webhook.status_code': res.status,
            'webhook.success': res.ok,
          });

          if (res.ok) return;

          console.warn(
            `[webhook] attempt ${attempt + 1}/${MAX_ATTEMPTS} → ${endpoint.url} returned ${res.status} ` +
            `(event_id=${eventId}, delivery_id=${deliveryId})`,
          );
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(
            `[webhook] attempt ${attempt + 1}/${MAX_ATTEMPTS} → ${endpoint.url} error: ${msg} ` +
            `(event_id=${eventId}, delivery_id=${deliveryId})`,
          );

          deliverySpan.setAttributes({
            'webhook.attempt': attempt + 1,
            'webhook.delivery_id': deliveryId,
            'webhook.error': msg,
          });

          await prisma.webhookDelivery.create({
            data: {
              eventId,
              deliveryId,
              url: endpoint.url,
              merchant: payload.merchant,
              event: payload.event,
              payload: body,
              statusCode: 0,
              attempt: attempt + 1,
              success: false,
              error: msg,
              endpointId: endpoint.id,
            },
          });
        }
      }

      console.error(
        `[webhook] all ${MAX_ATTEMPTS} attempts exhausted for ${endpoint.url} (event_id=${eventId})`,
      );
    },
    { kind: SpanKind.CLIENT },
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
