import { rpc, xdr } from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';
import { AuditLogger } from './auditLogger';
import { getTracer, withSpan, SpanKind } from '../lib/tracing';
import { applyEvent } from './subscriptionStateService';
import { sendPaymentFailureEmail, sendCancellationEmail } from './emailService';
import { enqueueRetries } from './retryQueue';
import {
  publishCacheInvalidation,
  cacheDeletePattern,
  CacheKey,
} from '../lib/redis';
import { withBackoff, isRpcRetryable } from '../lib/backoff';
import { indexerStateService } from './indexerStateService';

// ─── Outbox types ──────────────────────────────────────────────────────────────

export interface OutboxEventRecord {
  id?: number;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string; // JSON
  status: 'pending' | 'published' | 'failed';
  deduplicationKey: string;
  createdAt?: Date;
  publishedAt?: Date | null;
}

/** Minimal subset of the Prisma client needed by OutboxRelay, for testability. */
export interface OutboxPrismaClient {
  outboxEvent: {
    findMany(args: { where: { status: string }; orderBy: { createdAt: 'asc' } }): Promise<OutboxEventRecord[]>;
    updateMany(args: { where: { id: number }; data: { status: string; publishedAt?: Date } }): Promise<unknown>;
  };
}

const auditLogger = new AuditLogger();
const SUPPORTED_EVENT_TYPES = new Set(['subscribe', 'executed', 'payment_transfer_failure', 'cancel']);
const STORED_EVENT_TYPES = new Set(['subscribe', 'executed']);

const INDEXER_TRACER = 'sorobanpay.event-indexer';

/** Extract symbol string from a decoded ScVal. */
function scValToSymbol(val: xdr.ScVal): string | null {
  try {
    return val.sym().toString();
  } catch {
    return null;
  }
}

/** Extract address string from a decoded ScVal. */
function scValToAddress(val: xdr.ScVal): string | null {
  try {
    return val.address().toString();
  } catch {
    return null;
  }
}

/** Extract amount string from a decoded ScVal. */
function scValToAmount(val: xdr.ScVal): string | null {
  try {
    try {
      return val.i128().toString();
    } catch {
      return val.u64().toString();
    }
  } catch {
    return null;
  }
}

export class EventIndexer {
  private rpcUrl: string;
  private contractId: string;
  private server: rpc.Server;
  private retryScheduler: RetryScheduler | null = null;
  private _pollingTimer: ReturnType<typeof setTimeout> | null = null;
  private _stopped = false;

  constructor(rpcUrl: string, contractId: string) {
    this.rpcUrl = rpcUrl;
    this.contractId = contractId;
    this.server = new rpc.Server(rpcUrl);
  }

  /** Inject a RetryScheduler after construction (avoids circular imports). */
  setRetryScheduler(scheduler: RetryScheduler): void {
    this.retryScheduler = scheduler;
  }

  // ─── BE-51: Continuous polling with cursor-based pagination ────────────────

  /**
   * Start a polling loop that calls fetchAndStoreEventsWithCursor() every
   * `intervalMs` milliseconds (default: 10 seconds).
   *
   * The cursor is loaded from the IndexerState table on startup and persisted
   * after each successful batch so restarts resume exactly where they left off.
   */
  startPolling(intervalMs = 10_000): void {
    this._stopped = false;
    console.log(`[indexer] Starting cursor-based polling (interval: ${intervalMs}ms)`);

    const tick = async () => {
      if (this._stopped) return;
      try {
        await this.fetchAndStoreEventsWithCursor();
      } catch (err) {
        console.error('[indexer] Poll cycle error:', err);
      }
      if (!this._stopped) {
        this._pollingTimer = setTimeout(tick, intervalMs);
      }
    };

    // Run immediately on start, then schedule subsequent ticks
    tick();
  }

  /** Stop the polling loop gracefully. Waits for the in-flight tick to finish. */
  stopPolling(): void {
    this._stopped = true;
    if (this._pollingTimer) {
      clearTimeout(this._pollingTimer);
      this._pollingTimer = null;
    }
    console.log('[indexer] Polling stopped.');
  }

  /**
   * Fetch one batch of events using cursor-based pagination.
   *
   * - Loads the last saved cursor from IndexerState on the first call.
   * - Uses the cursor to request only events after the last processed position.
   * - Saves the new cursor after each successful batch.
   * - Retries on transient RPC errors with exponential backoff.
   */
  async fetchAndStoreEventsWithCursor(): Promise<void> {
    const cursor = await indexerStateService.getLastCursor();
    const lastLedger = await indexerStateService.getLastProcessedLedger();

    await withBackoff(
      () => this._fetchBatch(cursor, lastLedger),
      {
        maxRetries: 5,
        baseDelayMs: 1_000,
        maxDelayMs: 60_000,
        isRetryable: isRpcRetryable,
        onRetry: (attempt, err) => {
          console.warn(
            `[indexer] RPC error, retry ${attempt}/5: ${(err as Error)?.message ?? err}`,
          );
        },
      },
    );
  }

  private async _fetchBatch(cursor: string | null, lastLedger: number): Promise<void> {
    const filters: rpc.Api.EventFilter[] = [
      { type: 'contract', contractIds: [this.contractId] },
    ];

    const eventsRequest: rpc.Api.GetEventsRequest = cursor
      ? { filters, cursor, limit: 100 }
      : { filters, startLedger: Math.max(lastLedger, 1), limit: 100 };

    const eventsResponse = await this.server.getEvents(eventsRequest);
    const events = eventsResponse.events ?? [];

    if (events.length === 0) {
      console.log('[indexer] No new events.');
      return;
    }

    console.log(`[indexer] Processing batch of ${events.length} events`);

    let newCursor: string | null = cursor;
    let newLedger = lastLedger;

    for (const event of events) {
      await this.processEvent(event);
      // Each event's id is "ledger:txIndex:eventIndex" — use as cursor
      if (event.id) newCursor = event.id;
      const eventLedger = Number(event.ledger);
      if (eventLedger > newLedger) newLedger = eventLedger;
    }

    // Persist cursor so restarts resume from here
    await indexerStateService.saveState(newCursor, newLedger);
    console.log(`[indexer] Cursor saved: ${newCursor}, ledger: ${newLedger}`);
  }

  /**
   * Fetch events from Soroban RPC and store them.
   * Wrapped in a root OTel span 'rpc.poll_cycle'.
   * @deprecated Use fetchAndStoreEventsWithCursor() for cursor-based resumability.
   */
  async fetchAndStoreEvents(startLedger?: number): Promise<void> {
    await withSpan(
      INDEXER_TRACER,
      'rpc.poll_cycle',
      async (pollSpan) => {
        pollSpan.setAttributes({
          'rpc.url': this.rpcUrl,
          'contract.id': this.contractId,
          'rpc.start_ledger': startLedger ?? 0,
        });

        try {
          const filters: rpc.Api.EventFilter[] = [
            { type: 'contract', contractIds: [this.contractId] },
          ];

          // startLedger is required when not using cursor pagination
          const eventsRequest: rpc.Api.GetEventsRequest = {
            filters,
            startLedger: startLedger ?? 1,
            limit: 100,
          };

          const eventsResponse = await this.server.getEvents(eventsRequest);
          const events = eventsResponse.events ?? [];

          pollSpan.setAttributes({ 'rpc.events_found': events.length });

          if (events.length === 0) {
            console.log('No new events found');
            return;
          }

          console.log(`Found ${events.length} contract events`);

          for (const event of events) {
            await this.processEvent(event);
          }

          console.log('Events processed successfully');
        } catch (error) {
          console.error('Error fetching events:', error);
          throw error;
        }
      },
      { kind: SpanKind.CLIENT },
    );
  }

  private async processEvent(event: rpc.Api.EventResponse): Promise<void> {
    try {
      const topics = event.topic; // already decoded xdr.ScVal[]
      if (!topics || topics.length < 2) {
        return;
      }

      // --- span: event.decode ---
      let eventType: string | null = null;
      let subscriber: string | null = null;
      let merchant: string | null = null;
      let token: string | null = null;
      let amount: string | null = null;

      await withSpan(INDEXER_TRACER, 'event.decode', async (decodeSpan) => {
        eventType = scValToSymbol(topics[0]);

        if (!eventType || !SUPPORTED_EVENT_TYPES.has(eventType)) {
          decodeSpan.setAttributes({ 'event.skipped': true, 'event.type': eventType ?? 'unknown' });
          return;
        }

        subscriber = topics[1] ? scValToAddress(topics[1]) : null;
        merchant   = topics[2] ? scValToAddress(topics[2]) : null;
        token      = topics[3] ? scValToAddress(topics[3]) : null;
        // event.value is already a decoded xdr.ScVal
        amount     = scValToAmount(event.value);

        decodeSpan.setAttributes({
          'event.type': eventType,
          'event.subscriber': subscriber ?? '',
          'event.merchant': merchant ?? '',
          'event.token': token ?? '',
        });
      });

      if (!eventType || !SUPPORTED_EVENT_TYPES.has(eventType)) {
        return;
      }

      if (!subscriber || !merchant) {
        return;
      }

      if (!STORED_EVENT_TYPES.has(eventType)) {
        return;
      }

      const ledgerTimestamp = BigInt(event.ledger);

      // --- span: db.write_event (transactional outbox) ---
      await withSpan(INDEXER_TRACER, 'db.write_event', async (dbSpan) => {
        dbSpan.setAttributes({
          'db.operation': 'transaction',
          'db.table': 'Event+OutboxEvent',
          'event.type': eventType!,
        });

        // Check for duplicate event before opening transaction
        const existingEvent = await prisma.event.findFirst({
          where: {
            type: eventType!,
            subscriber: subscriber!,
            merchant: merchant!,
            token: token ?? '',
            amount: amount ?? '',
            ledgerTimestamp,
          },
        });

        if (existingEvent) {
          dbSpan.setAttributes({ 'db.duplicate': true });
          return;
        }

        // Transactional outbox: write the domain event AND the outbox record atomically.
        // The OutboxRelay (running separately) will dispatch side-effects from the outbox.
        const outboxPayload = JSON.stringify({
          eventType: eventType!,
          subscriber: subscriber!,
          merchant: merchant!,
          token: token ?? '',
          amount: amount ?? '',
          ledger: event.ledger,
          txHash: event.id,
        });

        await prisma.$transaction([
          prisma.event.create({
            data: {
              type: eventType!,
              subscriber: subscriber!,
              merchant: merchant!,
              token: token ?? '',
              amount: amount ?? '',
              ledgerTimestamp,
            },
          }),
          (prisma as any).outboxEvent.upsert({
            where: { deduplicationKey: event.id },
            update: {},
            create: {
              aggregateType: 'subscription',
              aggregateId: `${subscriber}:${merchant}`,
              eventType: eventType!,
              payload: outboxPayload,
              status: 'pending',
              deduplicationKey: event.id,
            },
          }),
        ]);

        dbSpan.setAttributes({ 'db.rows_written': 2, 'db.outbox': true });
      });

      // Post-store: update state machine (non-transactional, idempotent)
      await applyEvent(subscriber, merchant, eventType as any, { amount: amount ?? '0', token: token ?? '' });

      // Post-store: audit log for executed payments (non-transactional)
      if (eventType === 'executed') {
        await auditLogger.logPayment({
          eventType,
          subscriber,
          merchant,
          token: token ?? '',
          amount: amount ?? '',
          transactionHash: event.id,
          ledger: ledgerTimestamp,
        });

        // BE-51: Persist normalised Payment record with txHash for deduplication
        await prisma.payment.upsert({
          where: { txHash: event.id },
          update: {},  // Already stored — no-op (idempotent)
          create: {
            subscriber,
            merchant,
            token: token ?? '',
            amount: amount ?? '',
            txHash: event.id,
            ledger: ledgerTimestamp,
            timestamp: new Date(Number(ledgerTimestamp) * 1000),
            status: 'executed',
          },
        });
      }

      console.log(`Stored event: ${eventType} for merchant ${merchant}`);
    } catch (error) {
      console.error('Error parsing event:', error);
      return null;
    }
  }
}

// ─── OutboxRelay ───────────────────────────────────────────────────────────────

/**
 * OutboxRelay — asynchronous domain-event publisher.
 *
 * Reads pending outbox events from the OutboxEvent table and dispatches
 * the corresponding side-effects (cache invalidation, email notifications,
 * retry scheduling). Marks each event published on success or failed on error.
 *
 * Designed to run on a separate timer (e.g. every 5 seconds) so the main
 * indexer loop is not blocked by side-effect latency.
 */
export class OutboxRelay {
  private _stopped = false;
  private _timer: ReturnType<typeof setTimeout> | null = null;

  /**
   * Start the relay loop that processes pending outbox events every `intervalMs`
   * milliseconds (default: 5 seconds).
   */
  startRelay(intervalMs = 5_000): void {
    this._stopped = false;
    console.log(`[outbox-relay] Starting relay loop (interval: ${intervalMs}ms)`);

    const tick = async () => {
      if (this._stopped) return;
      try {
        await this.processPendingEvents();
      } catch (err) {
        console.error('[outbox-relay] Relay cycle error:', err);
      }
      if (!this._stopped) {
        this._timer = setTimeout(tick, intervalMs);
      }
    };

    tick();
  }

  /** Stop the relay loop gracefully. */
  stopRelay(): void {
    this._stopped = true;
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
    console.log('[outbox-relay] Relay stopped.');
  }

  /**
   * Process all pending outbox events in insertion order.
   * Each event is dispatched and marked published or failed atomically.
   */
  async processPendingEvents(): Promise<void> {
    const pending: OutboxEventRecord[] = await (prisma as any).outboxEvent.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    if (pending.length === 0) return;

    console.log(`[outbox-relay] Processing ${pending.length} pending outbox event(s)`);

    for (const outboxEvent of pending) {
      await this._dispatchOutboxEvent(outboxEvent);
    }
  }

  private async _dispatchOutboxEvent(outboxEvent: OutboxEventRecord): Promise<void> {
    let payload: {
      eventType: string;
      subscriber: string;
      merchant: string;
      token: string;
      amount: string;
      ledger: string;
      txHash: string;
    };

    try {
      payload = JSON.parse(outboxEvent.payload);
    } catch {
      console.error(`[outbox-relay] Failed to parse payload for outbox event ${outboxEvent.id}`);
      await (prisma as any).outboxEvent.updateMany({
        where: { id: outboxEvent.id },
        data: { status: 'failed' },
      });
      return;
    }

    try {
      const { eventType, subscriber, merchant, token, amount } = payload;

      // Cache invalidation
      await Promise.all([
        cacheDeletePattern(CacheKey.merchantPattern(merchant)),
        cacheDeletePattern(CacheKey.analyticsPattern(merchant)),
        cacheDeletePattern(CacheKey.subscriptionPattern(subscriber, merchant)),
        publishCacheInvalidation({ merchant, subscriber, eventType }),
      ]);

      // Email notifications
      if (eventType === 'payment_transfer_failure') {
        await sendPaymentFailureEmail(subscriber, merchant, amount, token).catch(
          (err) => console.error('[outbox-relay] Failed to send payment failure email:', err),
        );
        await enqueueRetries(subscriber, merchant, amount, token).catch(
          (err) => console.error('[outbox-relay] Failed to schedule payment retries:', err),
        );
      }

      if (eventType === 'cancel') {
        await sendCancellationEmail(subscriber, merchant).catch(
          (err) => console.error('[outbox-relay] Failed to send cancellation email:', err),
        );
      }

      // Mark published
      await (prisma as any).outboxEvent.updateMany({
        where: { id: outboxEvent.id },
        data: { status: 'published', publishedAt: new Date() },
      });

      console.log(`[outbox-relay] Published outbox event ${outboxEvent.id} (${eventType})`);
    } catch (err) {
      console.error(`[outbox-relay] Failed to dispatch outbox event ${outboxEvent.id}:`, err);
      await (prisma as any).outboxEvent.updateMany({
        where: { id: outboxEvent.id },
        data: { status: 'failed' },
      });
    }
  }
}
