/**
 * WebhookWorker — delivers webhook notifications to merchants when subscription
 * events occur (payment executed, payment failed, subscription cancelled).
 *
 * Issue: #1375
 *
 * Features:
 *   - Looks up merchant webhook URL from webhook_configs table
 *   - POSTs a signed JSON payload to the merchant's endpoint
 *   - Signs payload with HMAC-SHA256 using WEBHOOK_SECRET env var
 *   - Retries with exponential backoff: 3 attempts at delays 1s / 10s / 60s
 *   - Logs each delivery attempt in webhook_deliveries table
 *   - Moves permanently failed deliveries to status='dead' (dead-letter queue)
 *   - Delivers within 30s of event indexing for first attempt
 */

import * as crypto from 'crypto';
import * as https from 'https';
import * as http from 'http';
import { URL } from 'url';
import { Pool } from 'pg';
import { getPool } from '../db/pool';
import type { DecodedEvent } from '../services/indexer';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WebhookPayload {
  event_type: string;
  subscriber: string;
  merchant: string;
  amount: string;
  tx_hash: string;
  ledger_seq: number;
  occurred_at: string;
  delivered_at: string;
}

export interface DeliveryAttempt {
  deliveryId: number;
  attempt: number;
  status: 'delivered' | 'failed' | 'dead';
  responseStatus?: number;
  responseBody?: string;
  errorMessage?: string;
}

// Retry delays in milliseconds: 1s, 10s, 60s
export const RETRY_DELAYS_MS = [1_000, 10_000, 60_000];
export const MAX_ATTEMPTS = RETRY_DELAYS_MS.length;

// ---------------------------------------------------------------------------
// WebhookWorker
// ---------------------------------------------------------------------------

export class WebhookWorker {
  private readonly pool: Pool;
  private readonly webhookSecret: string;
  private running = false;
  private processTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly processIntervalMs: number;

  constructor(pool?: Pool, processIntervalMs = 10_000) {
    this.pool = pool ?? getPool();
    this.webhookSecret = process.env.WEBHOOK_SECRET ?? '';
    this.processIntervalMs = processIntervalMs;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Start the background retry loop. */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('[WebhookWorker] Starting retry loop.');
    void this.processQueue();
  }

  /** Stop the background retry loop. */
  stop(): void {
    this.running = false;
    if (this.processTimer !== null) {
      clearTimeout(this.processTimer);
      this.processTimer = null;
    }
    console.log('[WebhookWorker] Stopped.');
  }

  // -------------------------------------------------------------------------
  // Queue processing
  // -------------------------------------------------------------------------

  /**
   * Process all pending webhook deliveries that are due for a retry attempt.
   */
  async processQueue(): Promise<void> {
    if (!this.running) return;
    try {
      await this.processDueDeliveries();
    } catch (err) {
      console.error('[WebhookWorker] Queue processing error:', err);
    } finally {
      if (this.running) {
        this.processTimer = setTimeout(
          () => void this.processQueue(),
          this.processIntervalMs,
        );
      }
    }
  }

  /**
   * Query for pending deliveries whose next_retry_at is in the past and
   * attempt delivery for each one.
   */
  private async processDueDeliveries(): Promise<void> {
    const result = await this.pool.query<{
      id: number;
      merchant: string;
      event_type: string;
      payload: WebhookPayload;
      url: string;
      attempt: number;
    }>(
      `SELECT id, merchant, event_type, payload, url, attempt
       FROM webhook_deliveries
       WHERE status = 'pending'
         AND (next_retry_at IS NULL OR next_retry_at <= NOW())
       ORDER BY created_at ASC
       LIMIT 50`,
    );

    for (const delivery of result.rows) {
      await this.attemptDelivery(
        delivery.id,
        delivery.url,
        delivery.payload,
        delivery.attempt,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Public API — called by the IndexerService after persisting an event
  // -------------------------------------------------------------------------

  /**
   * Enqueue a webhook delivery for the given event. Looks up the merchant's
   * configured URL and signs the payload.
   *
   * The first delivery attempt is made immediately (within ~1s of indexing).
   */
  async enqueue(event: DecodedEvent): Promise<void> {
    const config = await this.getMerchantWebhookConfig(event.merchant);
    if (!config) {
      // No webhook configured for this merchant — silently skip
      return;
    }

    const payload: WebhookPayload = {
      event_type: event.type,
      subscriber: event.subscriber,
      merchant: event.merchant,
      amount: event.amount,
      tx_hash: event.txHash,
      ledger_seq: event.ledgerSeq,
      occurred_at: event.occurredAt.toISOString(),
      delivered_at: new Date().toISOString(),
    };

    const deliveryId = await this.createDeliveryRecord(
      event.merchant,
      event.type,
      payload,
      config.url,
    );

    // Attempt first delivery immediately
    await this.attemptDelivery(deliveryId, config.url, payload, 1);
  }

  // -------------------------------------------------------------------------
  // Delivery logic
  // -------------------------------------------------------------------------

  /**
   * Attempt to POST a webhook payload to the target URL.
   * Updates the delivery record with the outcome and schedules a retry if needed.
   */
  async attemptDelivery(
    deliveryId: number,
    url: string,
    payload: WebhookPayload,
    attemptNumber: number,
  ): Promise<DeliveryAttempt> {
    const body = JSON.stringify(payload);
    const signature = this.sign(body);

    let responseStatus: number | undefined;
    let responseBody: string | undefined;
    let errorMessage: string | undefined;
    let success = false;

    try {
      const result = await this.httpPost(url, body, signature);
      responseStatus = result.statusCode;
      responseBody = result.body.slice(0, 4096); // truncate large responses
      success = result.statusCode >= 200 && result.statusCode < 300;
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    const isLastAttempt = attemptNumber >= MAX_ATTEMPTS;
    let status: 'pending' | 'delivered' | 'failed' | 'dead';
    let nextRetryAt: Date | null = null;

    if (success) {
      status = 'delivered';
    } else if (isLastAttempt) {
      status = 'dead';
    } else {
      status = 'pending';
      const delayMs = RETRY_DELAYS_MS[attemptNumber] ?? RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];
      nextRetryAt = new Date(Date.now() + delayMs);
    }

    await this.updateDeliveryRecord({
      deliveryId,
      attemptNumber,
      status,
      responseStatus,
      responseBody,
      errorMessage,
      nextRetryAt,
    });

    if (status === 'dead') {
      console.warn(
        `[WebhookWorker] Dead-letter: delivery ${deliveryId} failed after ${attemptNumber} attempt(s).`,
      );
    }

    return {
      deliveryId,
      attempt: attemptNumber,
      status: status === 'pending' ? 'failed' : (status as 'delivered' | 'failed' | 'dead'),
      responseStatus,
      responseBody,
      errorMessage,
    };
  }

  // -------------------------------------------------------------------------
  // HMAC signing
  // -------------------------------------------------------------------------

  /**
   * Sign the payload body with HMAC-SHA256 using WEBHOOK_SECRET.
   * Returns a hex digest suitable for the X-Webhook-Signature header.
   */
  sign(body: string): string {
    if (!this.webhookSecret) {
      console.warn('[WebhookWorker] WEBHOOK_SECRET is not set; signature will be empty.');
      return '';
    }
    return crypto
      .createHmac('sha256', this.webhookSecret)
      .update(body, 'utf8')
      .digest('hex');
  }

  /**
   * Verify an incoming webhook signature (utility for merchants and tests).
   */
  verify(body: string, signature: string): boolean {
    const expected = this.sign(body);
    if (!expected) return false;
    try {
      return crypto.timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // HTTP delivery
  // -------------------------------------------------------------------------

  /**
   * POST JSON body to url with the webhook signature header.
   * Uses the built-in Node.js http/https modules to avoid extra dependencies.
   */
  httpPost(
    url: string,
    body: string,
    signature: string,
    timeoutMs = 10_000,
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        reject(new Error(`Invalid webhook URL: ${url}`));
        return;
      }

      const transport = parsed.protocol === 'https:' ? https : http;
      const options: http.RequestOptions = {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: parsed.pathname + parsed.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'X-Webhook-Signature': signature,
          'X-Webhook-Timestamp': new Date().toISOString(),
          'User-Agent': 'SorobanPay-WebhookWorker/1.0',
        },
      };

      const req = transport.request(options, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      });

      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Webhook request timed out after ${timeoutMs}ms`));
      });

      req.on('error', (err) => reject(err));
      req.write(body);
      req.end();
    });
  }

  // -------------------------------------------------------------------------
  // Database helpers
  // -------------------------------------------------------------------------

  private async getMerchantWebhookConfig(
    merchant: string,
  ): Promise<{ url: string; secret: string } | null> {
    const result = await this.pool.query<{ url: string; secret: string }>(
      `SELECT url, secret FROM webhook_configs WHERE merchant = $1 AND enabled = TRUE`,
      [merchant],
    );
    return result.rows[0] ?? null;
  }

  private async createDeliveryRecord(
    merchant: string,
    eventType: string,
    payload: WebhookPayload,
    url: string,
  ): Promise<number> {
    const result = await this.pool.query<{ id: number }>(
      `INSERT INTO webhook_deliveries (merchant, event_type, payload, url, attempt, status)
       VALUES ($1, $2, $3, $4, 1, 'pending')
       RETURNING id`,
      [merchant, eventType, JSON.stringify(payload), url],
    );
    return result.rows[0].id;
  }

  private async updateDeliveryRecord(opts: {
    deliveryId: number;
    attemptNumber: number;
    status: 'pending' | 'delivered' | 'dead';
    responseStatus?: number;
    responseBody?: string;
    errorMessage?: string;
    nextRetryAt: Date | null;
  }): Promise<void> {
    await this.pool.query(
      `UPDATE webhook_deliveries
       SET
         attempt        = $1,
         status         = $2,
         response_status= $3,
         response_body  = $4,
         error_message  = $5,
         next_retry_at  = $6,
         delivered_at   = CASE WHEN $2 = 'delivered' THEN NOW() ELSE NULL END,
         updated_at     = NOW()
       WHERE id = $7`,
      [
        opts.attemptNumber,
        opts.status,
        opts.responseStatus ?? null,
        opts.responseBody ?? null,
        opts.errorMessage ?? null,
        opts.nextRetryAt,
        opts.deliveryId,
      ],
    );
  }
}
