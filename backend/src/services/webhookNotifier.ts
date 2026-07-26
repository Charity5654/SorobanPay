import prisma from '../lib/prisma';
import { getTracer, withSpan, SpanKind } from '../lib/tracing';

export type WebhookEventType = 'payment.executed' | 'payment.failed';

export interface WebhookPayload {
  event: WebhookEventType;
  subscriber: string;
  merchant: string;
  amount: string;
  txHash?: string;
  timestamp: number;
  /** Optional: trace context to link webhook span to originating event span */
  traceContext?: string;
}

const MAX_ATTEMPTS = 5;
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 60_000, 300_000]; // exponential back-off

const WEBHOOK_TRACER = 'sorobanpay.webhook-notifier';

/**
 * Deliver a webhook notification to all registered endpoints for the merchant.
 * Failed deliveries are retried up to MAX_ATTEMPTS times with back-off.
 */
export async function notifyWebhooks(payload: WebhookPayload): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { merchant: payload.merchant, active: true },
  });

  await Promise.all(endpoints.map((ep: { url: string }) => deliverWithRetry(ep.url, payload)));
}

async function deliverWithRetry(url: string, payload: WebhookPayload): Promise<void> {
  const body = JSON.stringify(payload);

  await withSpan(
    WEBHOOK_TRACER,
    'webhook.deliver',
    async (deliverySpan) => {
      deliverySpan.setAttributes({
        'webhook.url': url,
        'webhook.merchant': payload.merchant,
        'webhook.event': payload.event,
        'webhook.max_attempts': MAX_ATTEMPTS,
      });

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
        if (attempt > 0) await sleep(RETRY_DELAYS_MS[attempt - 1]);

        try {
          const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body,
            signal: AbortSignal.timeout(10_000),
          });

          await prisma.webhookDelivery.create({
            data: {
              url,
              merchant: payload.merchant,
              event: payload.event,
              payload: body,
              statusCode: res.status,
              attempt: attempt + 1,
              success: res.ok,
            },
          });

          deliverySpan.setAttributes({
            'webhook.attempt': attempt + 1,
            'webhook.status_code': res.status,
            'webhook.success': res.ok,
          });

          if (res.ok) return;

          console.warn(`[webhook] attempt ${attempt + 1} → ${url} returned ${res.status}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error(`[webhook] attempt ${attempt + 1} → ${url} error: ${msg}`);

          deliverySpan.setAttributes({
            'webhook.attempt': attempt + 1,
            'webhook.error': msg,
          });

          await prisma.webhookDelivery.create({
            data: {
              url,
              merchant: payload.merchant,
              event: payload.event,
              payload: body,
              statusCode: 0,
              attempt: attempt + 1,
              success: false,
              error: msg,
            },
          });
        }
      }

      console.error(`[webhook] all ${MAX_ATTEMPTS} attempts exhausted for ${url}`);
    },
    { kind: SpanKind.CLIENT },
  );
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}
