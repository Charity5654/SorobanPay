/**
 * inMemoryDb.ts
 *
 * Lightweight in-process stand-in for Prisma + PostgreSQL.
 * Implements only the methods exercised in integration tests.
 * Satisfies the SubscriptionDB interface from reconciler.ts.
 */

import type { SubscriptionDB, StoredSubscription as ReconcilerStoredSubscription } from '../../reconciler';

// ── In-memory subscription store ──────────────────────────────────────────────

export class InMemorySubscriptionDB implements SubscriptionDB {
  private store = new Map<string, ReconcilerStoredSubscription>();

  private key(subscriber: string, merchant: string, token: string) {
    return `${subscriber}:${merchant}:${token}`;
  }

  get(subscriber: string, merchant: string, token: string): ReconcilerStoredSubscription | undefined {
    return this.store.get(this.key(subscriber, merchant, token));
  }

  upsert(record: ReconcilerStoredSubscription): void {
    this.store.set(this.key(record.subscriber, record.merchant, record.token), record);
  }

  delete(subscriber: string, merchant: string, token: string): void {
    this.store.delete(this.key(subscriber, merchant, token));
  }

  all(): ReconcilerStoredSubscription[] {
    return Array.from(this.store.values());
  }

  clear(): void {
    this.store.clear();
  }

  size(): number {
    return this.store.size;
  }
}

// ── In-memory event/summary store (Prisma-compatible shapes) ─────────────────

export interface StoredEvent {
  id: number;
  type: string;
  subscriber: string;
  merchant: string;
  token: string | null;
  amount: string;
  ledgerTimestamp: bigint;
  createdAt: Date;
}

export interface StoredSummary {
  id: number;
  merchant: string;
  startDate: Date;
  endDate: Date;
  totalAmount: string;
  paymentCount: number;
  currency: string;
  type: string;
  createdAt: Date;
}

interface StoredAuditLog {
  transactionHash: string;
  eventType: string;
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  ledger: bigint;
}

interface StoredNotificationPreference {
  subscriber: string;
  email?: string;
}

type InMemoryStoredSubscription = {
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  status: string;
}

/** Minimal Prisma-compatible client for use in integration tests. */
export class InMemoryPrismaClient {
  private events: StoredEvent[] = [];
  private summaries: StoredSummary[] = [];
  private subscriptions: InMemoryStoredSubscription[] = [];
  private auditLogs: StoredAuditLog[] = [];
  private notificationPreferences: StoredNotificationPreference[] = [];
  private nextEventId = 1;
  private nextSummaryId = 1;

  event = {
    findFirst: async (args: { where: Partial<StoredEvent> }) => {
      return this.events.find((e) => this.matchesEvent(e, args.where as any)) ?? null;
    },
    findMany: async (args?: { where?: Partial<StoredEvent & { createdAt?: { gte?: Date; lte?: Date } }> }) => {
      if (!args?.where) return [...this.events];
      return this.events.filter((e) => {
        const { createdAt, ...rest } = args.where as any;
        if (!this.matchesEvent(e, rest)) return false;
        if (createdAt?.gte && e.createdAt < createdAt.gte) return false;
        if (createdAt?.lte && e.createdAt > createdAt.lte) return false;
        return true;
      });
    },
    create: async (args: { data: Omit<StoredEvent, 'id' | 'createdAt'> }) => {
      const record: StoredEvent = {
        ...args.data,
        id: this.nextEventId++,
        createdAt: new Date(),
      };
      this.events.push(record);
      return record;
    },
  };

  subscription = {
    findUnique: async (args: { where: { subscriber_merchant: { subscriber: string; merchant: string } } }) => {
      return this.subscriptions.find((s) => s.subscriber === args.where.subscriber_merchant.subscriber && s.merchant === args.where.subscriber_merchant.merchant) ?? null;
    },
    upsert: async (args: { where: { subscriber_merchant: { subscriber: string; merchant: string } }; create: InMemoryStoredSubscription; update: Partial<InMemoryStoredSubscription> }) => {
      const existingIndex = this.subscriptions.findIndex((s) => s.subscriber === args.where.subscriber_merchant.subscriber && s.merchant === args.where.subscriber_merchant.merchant);
      if (existingIndex >= 0) {
        this.subscriptions[existingIndex] = { ...this.subscriptions[existingIndex], ...args.update } as InMemoryStoredSubscription;
        return this.subscriptions[existingIndex];
      }
      const created = { ...args.create };
      this.subscriptions.push(created);
      return created;
    },
  };

  auditLog = {
    upsert: async (args: { where: { transactionHash: string }; create: StoredAuditLog; update: Partial<StoredAuditLog> }) => {
      const existingIndex = this.auditLogs.findIndex((entry) => entry.transactionHash === args.where.transactionHash);
      if (existingIndex >= 0) {
        this.auditLogs[existingIndex] = { ...this.auditLogs[existingIndex], ...args.update } as StoredAuditLog;
        return this.auditLogs[existingIndex];
      }
      const created = { ...args.create };
      this.auditLogs.push(created);
      return created;
    },
  };

  notificationPreference = {
    findFirst: async (args: { where: { subscriber: string } }) => {
      return this.notificationPreferences.find((pref) => pref.subscriber === args.where.subscriber) ?? null;
    },
  };

  payoutSummary = {
    findUnique: async (args: { where: { id: number } }) => {
      return this.summaries.find((s) => s.id === args.where.id) ?? null;
    },
    findFirst: async (args: { where: Partial<StoredSummary> }) => {
      return this.summaries.find((s) => this.matchesSummary(s, args.where as any)) ?? null;
    },
    findMany: async (args?: { where?: Partial<StoredSummary>; orderBy?: object }) => {
      if (!args?.where) return [...this.summaries];
      return this.summaries.filter((s) => this.matchesSummary(s, args.where!));
    },
    create: async (args: { data: Omit<StoredSummary, 'id' | 'createdAt'> }) => {
      const record: StoredSummary = {
        ...args.data,
        id: this.nextSummaryId++,
        createdAt: new Date(),
      };
      this.summaries.push(record);
      return record;
    },
    update: async (args: { where: { id: number }; data: Partial<StoredSummary> }) => {
      const idx = this.summaries.findIndex((s) => s.id === args.where.id);
      if (idx === -1) throw new Error(`Summary ${args.where.id} not found`);
      this.summaries[idx] = { ...this.summaries[idx], ...args.data };
      return this.summaries[idx];
    },
  };

  private matchesEvent(record: StoredEvent, where: Record<string, any>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      return String((record as any)[k]) === String(v);
    });
  }

  private matchesSummary(record: StoredSummary, where: Record<string, any>): boolean {
    return Object.entries(where).every(([k, v]) => {
      if (v === undefined) return true;
      return String((record as any)[k]) === String(v);
    });
  }

  /** Seed events directly for test setup. */
  seedEvents(events: Omit<StoredEvent, 'id' | 'createdAt'>[]): void {
    for (const e of events) {
      this.events.push({ ...e, id: this.nextEventId++, createdAt: new Date() });
    }
  }

  reset(): void {
    this.events = [];
    this.summaries = [];
    this.subscriptions = [];
    this.auditLogs = [];
    this.notificationPreferences = [];
    this.nextEventId = 1;
    this.nextSummaryId = 1;
  }
}
