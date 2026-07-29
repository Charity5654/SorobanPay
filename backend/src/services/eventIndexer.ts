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

  constructor(rpcUrl: string, contractId: string) {
    this.rpcUrl = rpcUrl;
    this.contractId = contractId;
    this.server = new rpc.Server(rpcUrl);
  }

  /** Inject a RetryScheduler after construction (avoids circular imports). */
  setRetryScheduler(scheduler: RetryScheduler): void {
    this.retryScheduler = scheduler;
  }

  /**
   * Fetch events from Soroban RPC and store them.
   * Wrapped in a root OTel span 'rpc.poll_cycle'.
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

      // --- span: db.write_event ---
      await withSpan(INDEXER_TRACER, 'db.write_event', async (dbSpan) => {
        dbSpan.setAttributes({
          'db.operation': 'upsert',
          'db.table': 'Event',
          'event.type': eventType!,
        });

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

        await prisma.event.create({
          data: {
            type: eventType!,
            subscriber: subscriber!,
            merchant: merchant!,
            token: token ?? '',
            amount: amount ?? '',
            ledgerTimestamp,
          },
        });

        dbSpan.setAttributes({ 'db.rows_written': 1 });
      });

      // Post-store: update state machine
      await applyEvent(subscriber, merchant, eventType as any, { amount: amount ?? '0' });

      // Post-store: bust Redis cache keys for the affected merchant/subscriber
      await Promise.all([
        cacheDeletePattern(CacheKey.merchantPattern(merchant)),
        cacheDeletePattern(CacheKey.analyticsPattern(merchant)),
        subscriber
          ? cacheDeletePattern(CacheKey.subscriptionPattern(subscriber, merchant))
          : Promise.resolve(),
        publishCacheInvalidation({ merchant, subscriber: subscriber ?? undefined, eventType }),
      ]);

      // Post-store: audit log for executed payments
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
      }

      // Post-store: email notifications
      if (eventType === 'payment_transfer_failure') {
        await sendPaymentFailureEmail(subscriber, merchant, amount ?? '0', token ?? '').catch(
          (err) => console.error('[email] Failed to send payment failure email:', err),
        );

        // Schedule automated payment retries (BE-retry)
        enqueueRetries(subscriber, merchant, amount ?? '0', token ?? '').catch(
          (err) => console.error('[retryQueue] Failed to enqueue retries:', err),
        );
      }

      if (eventType === 'cancel') {
        await sendCancellationEmail(subscriber, merchant).catch(
          (err) => console.error('[email] Failed to send cancellation email:', err),
        );
      }

      console.log(`Stored event: ${eventType} for merchant ${merchant}`);
    } catch (error) {
      console.error('Error processing event:', error);
    }
  }
}
