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

export interface StoredWebhookEndpoint {
  id: number;
  merchant: string;
  url: string;
  active: boolean;
  createdAt: Date;
}

export interface StoredWebhookDelivery {
  id: number;
  endpointId?: number;
  eventId?: string;
  event?: string;
  merchant?: string;
  statusCode?: number;
  success?: boolean;
  createdAt: Date;
}

export interface StoredOutboxEvent {
  id: number;
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: string;
  status: string;
  deduplicationKey: string;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface StoredIndexerState {
  id: number;
  lastCursor: string | null;
  updatedAt: Date;
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
  private webhookEndpoints: StoredWebhookEndpoint[] = [];
  private webhookDeliveries: StoredWebhookDelivery[] = [];
  private indexerStates: StoredIndexerState[] = [];
  private outboxEvents: StoredOutboxEvent[] = [];
  private nextEventId = 1;
  private nextSummaryId = 1;
  private nextEndpointId = 1;
  private nextDeliveryId = 1;
  private nextOutboxId = 1;

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

  indexerState = {
    findUnique: async (args: { where: { id: number } }) => {
      return this.indexerStates.find((s) => s.id === args.where.id) ?? null;
    },
    upsert: async (args: {
      where: { id: number };
      create: { id: number; lastCursor: string | null };
      update: { lastCursor: string | null };
    }) => {
      const idx = this.indexerStates.findIndex((s) => s.id === args.where.id);
      if (idx === -1) {
        const record: StoredIndexerState = {
          ...args.create,
          updatedAt: new Date(),
        };
        this.indexerStates.push(record);
        return record;
      } else {
        this.indexerStates[idx] = { ...this.indexerStates[idx], ...args.update, updatedAt: new Date() };
        return this.indexerStates[idx];
      }
    },
  };

  webhookEndpoint = {
    findMany: async (args?: { where?: Partial<StoredWebhookEndpoint> }) => {
      if (!args?.where) return [...this.webhookEndpoints];
      return this.webhookEndpoints.filter((ep) =>
        Object.entries(args.where!).every(([k, v]) => (ep as any)[k] === v),
      );
    },
    create: async (args: { data: Omit<StoredWebhookEndpoint, 'id' | 'createdAt'> }) => {
      const record: StoredWebhookEndpoint = {
        ...args.data,
        id: this.nextEndpointId++,
        createdAt: new Date(),
      };
      this.webhookEndpoints.push(record);
      return record;
    },
  };

  webhookDelivery = {
    create: async (args: { data: Omit<StoredWebhookDelivery, 'id' | 'createdAt'> }) => {
      const record: StoredWebhookDelivery = {
        ...args.data,
        id: this.nextDeliveryId++,
        createdAt: new Date(),
      };
      this.webhookDeliveries.push(record);
      return record;
    },
    findMany: async (args?: { where?: Partial<StoredWebhookDelivery> }) => {
      if (!args?.where) return [...this.webhookDeliveries];
      return this.webhookDeliveries.filter((d) =>
        Object.entries(args.where!).every(([k, v]) => (d as any)[k] === v),
      );
    },
  };

  /**
   * Minimal $transaction implementation that runs callbacks sequentially.
   * Passes a proxy of this client as the tx argument so service code that
   * calls tx.event.create(...) etc. operates on the same in-memory store.
   */
  async $transaction<T>(fn: ((tx: InMemoryPrismaClient) => Promise<T>) | any[]): Promise<T | any[]> {
    if (Array.isArray(fn)) {
      // Handle array-style transactions (prisma.$transaction([op1, op2, ...]))
      const results: any[] = [];
      for (const op of fn) {
        results.push(await op);
      }
      return results;
    }
    return (fn as (tx: InMemoryPrismaClient) => Promise<T>)(this);
  }

  outboxEvent = {
    findMany: async (args?: { where?: Partial<StoredOutboxEvent>; orderBy?: { createdAt?: 'asc' | 'desc' } }) => {
      let result = [...this.outboxEvents];
      if (args?.where) {
        result = result.filter((e) =>
          Object.entries(args.where!).every(([k, v]) => (e as any)[k] === v),
        );
      }
      if (args?.orderBy?.createdAt === 'desc') {
        result.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      }
      return result;
    },
    create: async (args: { data: Omit<StoredOutboxEvent, 'id' | 'createdAt'> }) => {
      const record: StoredOutboxEvent = {
        ...args.data,
        id: this.nextOutboxId++,
        createdAt: new Date(),
        publishedAt: args.data.publishedAt ?? null,
      };
      this.outboxEvents.push(record);
      return record;
    },
    upsert: async (args: {
      where: { deduplicationKey: string };
      create: Omit<StoredOutboxEvent, 'id' | 'createdAt'>;
      update: Partial<StoredOutboxEvent>;
    }) => {
      const existingIdx = this.outboxEvents.findIndex(
        (e) => e.deduplicationKey === args.where.deduplicationKey,
      );
      if (existingIdx >= 0) {
        this.outboxEvents[existingIdx] = { ...this.outboxEvents[existingIdx], ...args.update };
        return this.outboxEvents[existingIdx];
      }
      const record: StoredOutboxEvent = {
        ...args.create,
        id: this.nextOutboxId++,
        createdAt: new Date(),
        publishedAt: (args.create as any).publishedAt ?? null,
      };
      this.outboxEvents.push(record);
      return record;
    },
    updateMany: async (args: { where: { id?: number; status?: string }; data: Partial<StoredOutboxEvent> }) => {
      let count = 0;
      this.outboxEvents = this.outboxEvents.map((e) => {
        if (
          (args.where.id === undefined || e.id === args.where.id) &&
          (args.where.status === undefined || e.status === args.where.status)
        ) {
          count++;
          return { ...e, ...args.data };
        }
        return e;
      });
      return { count };
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

  /** Seed webhook endpoints directly for test setup. */
  seedEndpoints(endpoints: Omit<StoredWebhookEndpoint, 'id' | 'createdAt'>[]): void {
    for (const ep of endpoints) {
      this.webhookEndpoints.push({ ...ep, id: this.nextEndpointId++, createdAt: new Date() });
    }
  }

  reconciliationAudit = {
    create: async (args: { data: any }) => {
      const record = { id: this.nextReconciliationAuditId++, ...args.data, createdAt: new Date() };
      this.reconciliationAudits.push(record);
      return record;
    },
    findMany: async (_args?: { where?: any; orderBy?: any }) => {
      return [...this.reconciliationAudits];
    },
  };

  reset(): void {
    this.events = [];
    this.summaries = [];
    this.subscriptions = [];
    this.auditLogs = [];
    this.notificationPreferences = [];
    this.webhookEndpoints = [];
    this.webhookDeliveries = [];
    this.indexerStates = [];
    this.outboxEvents = [];
    this.nextEventId = 1;
    this.nextSummaryId = 1;
    this.nextEndpointId = 1;
    this.nextDeliveryId = 1;
    this.nextOutboxId = 1;
  }
}
