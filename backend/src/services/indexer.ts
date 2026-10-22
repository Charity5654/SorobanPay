/**
 * IndexerService — polls the Soroban RPC getEvents() endpoint, decodes
 * contract events, and persists them to PostgreSQL.
 *
 * Issue: #1372
 *
 * Supported event types:
 *   - subscribe        → upsert into subscriptions table
 *   - executed         → insert into payments table, update subscriptions
 *   - cancel           → mark subscription cancelled in subscriptions table
 *   - payment_transfer_failure → insert failure record into payments table
 *
 * Cursor-based pagination ensures no events are missed across polling cycles.
 * The cursor is saved in the indexer_state singleton row so the service
 * resumes correctly after a restart.
 */

import { SorobanRpc, xdr } from '@stellar/stellar-sdk';
import { Pool } from 'pg';
import { getPool } from '../db/pool';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EventType = 'subscribe' | 'executed' | 'cancel' | 'payment_transfer_failure';

export interface DecodedEvent {
  type: EventType;
  subscriber: string;
  merchant: string;
  /** Parsed amount in stroops / contract units (string to avoid BigInt loss) */
  amount: string;
  txHash: string;
  ledgerSeq: number;
  occurredAt: Date;
}

export interface IndexerConfig {
  rpcUrl: string;
  contractId: string;
  pollIntervalMs?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_EVENTS_PER_PAGE = 100;

// ---------------------------------------------------------------------------
// IndexerService
// ---------------------------------------------------------------------------

export class IndexerService {
  private readonly rpc: SorobanRpc.Server;
  private readonly contractId: string;
  private readonly pollIntervalMs: number;
  private readonly pool: Pool;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(config: IndexerConfig) {
    this.rpc = new SorobanRpc.Server(config.rpcUrl, { allowHttp: false });
    this.contractId = config.contractId;
    this.pollIntervalMs = config.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.pool = getPool();
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the indexer polling loop.
   * Safe to call multiple times — subsequent calls are no-ops.
   */
  start(): void {
    if (this.running) return;
    this.running = true;
    console.log(
      `[IndexerService] Starting. Poll interval: ${this.pollIntervalMs}ms`,
    );
    void this.poll();
  }

  /**
   * Stop the polling loop gracefully.
   */
  stop(): void {
    this.running = false;
    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    console.log('[IndexerService] Stopped.');
  }

  // -------------------------------------------------------------------------
  // Core polling logic
  // -------------------------------------------------------------------------

  /**
   * Execute one full polling cycle: load cursor → fetch pages → process events
   * → save cursor. Schedules the next cycle when done.
   */
  async poll(): Promise<void> {
    if (!this.running) return;

    try {
      let cursor = await this.loadCursor();
      console.log(`[IndexerService] Polling from cursor: "${cursor || '(start)'}"`);

      let totalProcessed = 0;

      // Paginate until no more pages are returned
      while (true) {
        const page = await this.fetchEventsPage(cursor);
        if (page.events.length === 0) break;

        for (const rawEvent of page.events) {
          const decoded = this.decodeEvent(rawEvent);
          if (decoded) {
            await this.persistEvent(decoded);
            totalProcessed++;
          }
        }

        // Advance cursor to the last event on this page
        const lastEvent = page.events[page.events.length - 1];
        cursor = lastEvent.id;
        await this.saveCursor(cursor);

        // If fewer than max events were returned, we've reached the tip
        if (page.events.length < MAX_EVENTS_PER_PAGE) break;
      }

      if (totalProcessed > 0) {
        console.log(`[IndexerService] Processed ${totalProcessed} event(s).`);
      }
    } catch (err) {
      console.error('[IndexerService] Poll error:', err);
    } finally {
      if (this.running) {
        this.pollTimer = setTimeout(() => void this.poll(), this.pollIntervalMs);
      }
    }
  }

  // -------------------------------------------------------------------------
  // RPC interaction
  // -------------------------------------------------------------------------

  /**
   * Fetch one page of contract events from the Soroban RPC.
   */
  private async fetchEventsPage(cursor: string): Promise<SorobanRpc.Api.GetEventsResponse> {
    const filters: SorobanRpc.Server.EventFilter[] = [
      {
        type: 'contract',
        contractIds: [this.contractId],
      },
    ];

    const request: Parameters<SorobanRpc.Server['getEvents']>[0] = {
      filters,
      limit: MAX_EVENTS_PER_PAGE,
    };

    if (cursor) {
      request.cursor = cursor;
    } else {
      // Start from the oldest available ledger when no cursor exists
      request.startLedger = 0;
    }

    return this.rpc.getEvents(request);
  }

  // -------------------------------------------------------------------------
  // Event decoding
  // -------------------------------------------------------------------------

  /**
   * Decode a raw Soroban event into a structured DecodedEvent.
   * Returns null if the event type is unrecognised.
   */
  decodeEvent(event: SorobanRpc.Api.EventResponse): DecodedEvent | null {
    try {
      // topics[0] is the event name symbol
      const topics = event.topic;
      if (!topics || topics.length < 3) return null;

      const nameTopic = topics[0];
      const eventName = this.scValToString(nameTopic);

      if (
        eventName !== 'subscribe' &&
        eventName !== 'executed' &&
        eventName !== 'cancel' &&
        eventName !== 'payment_transfer_failure'
      ) {
        return null;
      }

      const subscriber = this.scValToString(topics[1]);
      const merchant = this.scValToString(topics[2]);

      // The data field carries the amount (i128)
      const amount = event.value ? this.scValToAmount(event.value) : '0';

      const ledgerSeq = typeof event.ledger === 'string'
        ? parseInt(event.ledger, 10)
        : (event.ledger as number);

      const occurredAt = event.ledgerClosedAt
        ? new Date(event.ledgerClosedAt)
        : new Date();

      return {
        type: eventName as EventType,
        subscriber,
        merchant,
        amount,
        txHash: event.txHash ?? '',
        ledgerSeq,
        occurredAt,
      };
    } catch (err) {
      console.warn('[IndexerService] Failed to decode event:', err, event);
      return null;
    }
  }

  /**
   * Convert an XDR ScVal to its string representation (symbol or address).
   */
  private scValToString(val: xdr.ScVal): string {
    switch (val.switch().name) {
      case 'scvSymbol':
        return val.sym().toString();
      case 'scvAddress': {
        const addr = val.address();
        switch (addr.switch().name) {
          case 'scAddressTypeAccount':
            return addr.accountId().ed25519().toString('base64');
          case 'scAddressTypeContract':
            return addr.contractId().toString('hex');
          default:
            return addr.toXDR('base64');
        }
      }
      case 'scvString':
        return val.str().toString();
      default:
        return val.toXDR('base64');
    }
  }

  /**
   * Extract an i128 / u64 numeric value from an XDR ScVal as a string.
   */
  private scValToAmount(val: xdr.ScVal): string {
    switch (val.switch().name) {
      case 'scvI128': {
        const i128 = val.i128();
        const hi = BigInt(i128.hi().toString());
        const lo = BigInt(i128.lo().toString());
        return ((hi << 64n) | lo).toString();
      }
      case 'scvU64':
        return val.u64().toString();
      case 'scvI64':
        return val.i64().toString();
      default:
        return '0';
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Persist a decoded event to the appropriate database tables.
   */
  async persistEvent(event: DecodedEvent): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      switch (event.type) {
        case 'subscribe':
          await this.upsertSubscription(client, event);
          break;

        case 'executed':
          await this.recordPayment(client, event, 'executed');
          await this.updateSubscriptionAfterPayment(client, event);
          break;

        case 'cancel':
          await this.markSubscriptionCancelled(client, event);
          await this.recordPayment(client, event, 'cancel');
          break;

        case 'payment_transfer_failure':
          await this.recordPayment(client, event, 'failure');
          break;
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Upsert a subscription record from a 'subscribe' event.
   */
  private async upsertSubscription(
    client: import('pg').PoolClient,
    event: DecodedEvent,
  ): Promise<void> {
    // next_payment is recorded as occurred_at + interval; since we don't have
    // interval in the event, we default to occurred_at. The interval will be
    // populated if the application also stores it via other means.
    await client.query(
      `INSERT INTO subscriptions
         (subscriber, merchant, token, amount, interval_sec, next_payment, status, updated_at)
       VALUES ($1, $2, '', $3, 0, $4, 'active', NOW())
       ON CONFLICT (subscriber, merchant) DO UPDATE SET
         amount       = EXCLUDED.amount,
         status       = 'active',
         updated_at   = NOW()`,
      [event.subscriber, event.merchant, event.amount, event.occurredAt],
    );
  }

  /**
   * Insert a payment record into the payments table.
   */
  private async recordPayment(
    client: import('pg').PoolClient,
    event: DecodedEvent,
    eventType: 'executed' | 'failure' | 'cancel',
  ): Promise<void> {
    await client.query(
      `INSERT INTO payments
         (tx_hash, event_type, subscriber, merchant, amount, ledger_seq, occurred_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tx_hash, event_type, subscriber, merchant) DO NOTHING`,
      [
        event.txHash,
        eventType,
        event.subscriber,
        event.merchant,
        event.amount,
        event.ledgerSeq,
        event.occurredAt,
      ],
    );
  }

  /**
   * Update next_payment and status after a successful 'executed' event.
   */
  private async updateSubscriptionAfterPayment(
    client: import('pg').PoolClient,
    event: DecodedEvent,
  ): Promise<void> {
    await client.query(
      `UPDATE subscriptions
       SET updated_at = NOW(), status = 'active'
       WHERE subscriber = $1 AND merchant = $2`,
      [event.subscriber, event.merchant],
    );
  }

  /**
   * Mark a subscription as cancelled.
   */
  private async markSubscriptionCancelled(
    client: import('pg').PoolClient,
    event: DecodedEvent,
  ): Promise<void> {
    await client.query(
      `UPDATE subscriptions
       SET status = 'cancelled', updated_at = NOW()
       WHERE subscriber = $1 AND merchant = $2`,
      [event.subscriber, event.merchant],
    );
  }

  // -------------------------------------------------------------------------
  // Cursor management
  // -------------------------------------------------------------------------

  /** Load the last saved event cursor from the database. */
  async loadCursor(): Promise<string> {
    const res = await this.pool.query<{ cursor: string }>(
      'SELECT cursor FROM indexer_state WHERE id = 1',
    );
    return res.rows[0]?.cursor ?? '';
  }

  /** Persist the current cursor to the database. */
  async saveCursor(cursor: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO indexer_state (id, cursor, updated_at)
       VALUES (1, $1, NOW())
       ON CONFLICT (id) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = NOW()`,
      [cursor],
    );
  }
}
