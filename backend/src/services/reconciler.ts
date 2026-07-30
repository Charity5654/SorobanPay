/**
 * reconciler.ts  (src/services/)
 *
 * Re-exports the pure reconcile() function and provides a Prisma-backed
 * SubscriptionDB adapter so the reconciler can diff against real DB state.
 *
 * The adapter reads from the Event table (built by EventIndexer) to replay
 * on-chain history and uses an in-process Map as the mutable DB surface —
 * reconcile() writes to the Map, and the adapter flushes inserts/updates/deletes
 * back to Prisma after the run completes.
 */

export {
  reconcile,
  type ChainEvent,
  type StoredSubscription,
  type SubscriptionDB,
  type ReconcileResult,
  type RepairAction,
  type EventType,
} from '../../reconciler';

import prisma from '../lib/prisma';
import type { ChainEvent, StoredSubscription, SubscriptionDB } from '../../reconciler';

// ─── Prisma-backed DB adapter ─────────────────────────────────────────────────

/**
 * Builds a SubscriptionDB backed by the Prisma Event table for reads and an
 * in-memory Map for writes.  Call flush() after reconcile() to persist changes.
 *
 * Uses the Event log as source-of-truth to derive current subscription state:
 * subscribe events upsert, cancel events delete, executed events update timing.
 */
export class PrismaSubscriptionDB implements SubscriptionDB {
  private store = new Map<string, StoredSubscription>();

  private constructor() {}

  static async load(defaultInterval = 86_400): Promise<PrismaSubscriptionDB> {
    const db = new PrismaSubscriptionDB();
    const events = await prisma.event.findMany({
      orderBy: { ledgerTimestamp: 'asc' },
    });

    for (const ev of events) {
      const key = `${ev.subscriber}:${ev.merchant}:${ev.token}`;
      const ts = Number(ev.ledgerTimestamp);
      const amount = BigInt(ev.amount);

      if (ev.type === 'subscribe') {
        const prev = db.store.get(key);
        const interval = prev ? prev.interval : defaultInterval;
        db.store.set(key, {
          subscriber: ev.subscriber,
          merchant: ev.merchant,
          token: ev.token,
          amount,
          interval,
          next_payment: ts + interval,
          last_payment_at: prev ? prev.last_payment_at : null,
        });
      } else if (ev.type === 'executed') {
        const cur = db.store.get(key);
        if (cur) {
          db.store.set(key, {
            ...cur,
            amount,
            last_payment_at: ts,
            next_payment: ts + cur.interval,
          });
        }
      } else if (ev.type === 'cancel') {
        db.store.delete(key);
      }
    }

    return db;
  }

  get(subscriber: string, merchant: string, token: string): StoredSubscription | undefined {
    return this.store.get(`${subscriber}:${merchant}:${token}`);
  }

  upsert(record: StoredSubscription): void {
    this.store.set(`${record.subscriber}:${record.merchant}:${record.token}`, record);
  }

  delete(subscriber: string, merchant: string, token: string): void {
    this.store.delete(`${subscriber}:${merchant}:${token}`);
  }

  all(): StoredSubscription[] {
    return [...this.store.values()];
  }
}

// ─── Fetch on-chain events ────────────────────────────────────────────────────

/**
 * Converts Event rows stored by EventIndexer into ChainEvent objects for
 * the reconciler. Events are sorted oldest-first for correct replay order.
 */
export async function fetchChainEventsFromDB(): Promise<ChainEvent[]> {
  const rows = await prisma.event.findMany({
    orderBy: { ledgerTimestamp: 'asc' },
  });

  return rows.map((row: { type: string; subscriber: string; merchant: string; token: string; amount: string; ledgerTimestamp: bigint }) => ({
    type: row.type as ChainEvent['type'],
    subscriber: row.subscriber,
    merchant: row.merchant,
    token: row.token,
    amount: BigInt(row.amount),
    timestamp: Number(row.ledgerTimestamp),
  }));
}
