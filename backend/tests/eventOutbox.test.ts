/**
 * eventOutbox.test.ts — #1072
 *
 * Tests for the transactional domain-event outbox pattern in EventIndexer.
 *
 * Verifies:
 *   1. Outbox event is written transactionally with the main Event record.
 *   2. Duplicate deduplicationKey is idempotent (upsert — no second row).
 *   3. OutboxRelay publishes pending events and marks them 'published'.
 *   4. OutboxRelay marks events 'failed' when dispatch throws.
 *   5. Tenant/aggregate isolation: outbox rows are scoped to aggregateId.
 */

// ── Mock stellar-sdk ──────────────────────────────────────────────────────────
jest.mock('@stellar/stellar-sdk', () => {
  class MockScVal {
    constructor(private value: unknown) {}
    sym() { return { toString: () => this.value }; }
    address() { return { toString: () => this.value }; }
    i128() { return { toString: () => this.value }; }
    u64() { return { toString: () => this.value }; }
    toXDR() { return 'mock-xdr'; }
  }
  const mockServer = { getEvents: jest.fn() };
  return {
    rpc: { Server: jest.fn(() => mockServer) },
    xdr: { ScVal: { fromXDR: jest.fn() } },
    __mockServer: mockServer,
  };
});

// ── Mock prisma ───────────────────────────────────────────────────────────────
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('./helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

// ── Mock side-effect modules to prevent real network calls ────────────────────
jest.mock('../src/services/retryQueue', () => ({
  enqueueRetries: jest.fn().mockResolvedValue([]),
}));

jest.mock('../src/services/emailService', () => ({
  sendPaymentFailureEmail: jest.fn().mockResolvedValue(undefined),
  sendCancellationEmail: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('../src/lib/redis', () => ({
  publishCacheInvalidation: jest.fn().mockResolvedValue(undefined),
  cacheDeletePattern: jest.fn().mockResolvedValue(undefined),
  CacheKey: {
    merchantPattern: (m: string) => `merchant:${m}:*`,
    analyticsPattern: (m: string) => `analytics:${m}:*`,
    subscriptionPattern: (s: string, m: string) => `sub:${s}:${m}`,
  },
}));

jest.mock('../src/lib/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
  logger:  { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

jest.mock('../src/services/auditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({
    logPayment: jest.fn().mockResolvedValue(undefined),
  })),
}));

jest.mock('../src/services/subscriptionStateService', () => ({
  applyEvent: jest.fn().mockResolvedValue(undefined),
}));

import prisma from '../src/lib/prisma';
import { EventIndexer, OutboxRelay } from '../src/services/eventIndexer';
import { InMemoryPrismaClient } from './helpers/inMemoryDb';
import { sendPaymentFailureEmail, sendCancellationEmail } from '../src/services/emailService';
import { enqueueRetries } from '../src/services/retryQueue';
import { publishCacheInvalidation, cacheDeletePattern } from '../src/lib/redis';

const db = prisma as unknown as InMemoryPrismaClient;

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeTopicVal(type: 'symbol' | 'address', value: string) {
  class MockScVal {
    constructor(private _value: string, private _type: string) {}
    sym() { if (this._type !== 'symbol') throw new Error(); return { toString: () => this._value }; }
    address() { if (this._type !== 'address') throw new Error(); return { toString: () => this._value }; }
    i128() { return { toString: () => this._value }; }
    u64() { return { toString: () => this._value }; }
  }
  return new MockScVal(value, type);
}

function makeEvent(overrides: {
  id?: string;
  type?: string;
  subscriber?: string;
  merchant?: string;
  token?: string;
  amount?: string;
  ledger?: number;
}) {
  const {
    id = 'rpc-event-001',
    type = 'executed',
    subscriber = 'GSUB001',
    merchant = 'GMER001',
    token = 'CTOKEN001',
    amount = '1000',
    ledger = 100,
  } = overrides;

  return {
    id,
    ledger,
    ledgerClosedAt: new Date().toISOString(),
    topic: [
      makeTopicVal('symbol', type),
      makeTopicVal('address', subscriber),
      makeTopicVal('address', merchant),
      makeTopicVal('address', token),
    ],
    value: makeTopicVal('symbol', amount),
  } as any;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  db.reset();
  jest.clearAllMocks();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('#1072 — Transactional domain-event outbox', () => {
  describe('EventIndexer outbox write', () => {
    it('writes the Event and OutboxEvent atomically for an executed event', async () => {
      const indexer = new EventIndexer('http://rpc.test', 'CTEST');
      const event = makeEvent({ id: 'evt-txn-001', type: 'executed' });

      await (indexer as any).processEvent(event);

      // Main event stored
      const events = await db.event.findMany();
      expect(events).toHaveLength(1);
      expect(events[0].type).toBe('executed');

      // Outbox row stored with correct fields
      const outboxRows = await db.outboxEvent.findMany();
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0].status).toBe('pending');
      expect(outboxRows[0].deduplicationKey).toBe('evt-txn-001');
      expect(outboxRows[0].aggregateType).toBe('subscription');
      expect(outboxRows[0].aggregateId).toBe('GSUB001:GMER001');
      expect(outboxRows[0].eventType).toBe('executed');

      const payload = JSON.parse(outboxRows[0].payload);
      expect(payload.subscriber).toBe('GSUB001');
      expect(payload.merchant).toBe('GMER001');
      expect(payload.amount).toBe('1000');
    });

    it('is idempotent — duplicate event id creates only one outbox row', async () => {
      const indexer = new EventIndexer('http://rpc.test', 'CTEST');
      const event = makeEvent({ id: 'evt-dup-001', type: 'executed' });

      // Process the same event twice (simulates restart / replay)
      await (indexer as any).processEvent(event);
      await (indexer as any).processEvent(event);

      const outboxRows = await db.outboxEvent.findMany();
      expect(outboxRows).toHaveLength(1);
    });

    it('scopes outbox rows to aggregateId (tenant isolation)', async () => {
      const indexer = new EventIndexer('http://rpc.test', 'CTEST');

      await (indexer as any).processEvent(makeEvent({ id: 'evt-agg-001', subscriber: 'GSUB001', merchant: 'GMER001' }));
      await (indexer as any).processEvent(makeEvent({ id: 'evt-agg-002', subscriber: 'GSUB002', merchant: 'GMER002' }));

      const outboxRows = await db.outboxEvent.findMany();
      const aggregateIds = outboxRows.map((r: any) => r.aggregateId).sort();
      expect(aggregateIds).toEqual(['GSUB001:GMER001', 'GSUB002:GMER002']);
    });
  });

  describe('OutboxRelay', () => {
    it('publishes pending outbox events and marks them published', async () => {
      // Seed a pending outbox event
      await db.outboxEvent.upsert({
        where: { deduplicationKey: 'relay-test-001' },
        create: {
          aggregateType: 'subscription',
          aggregateId: 'GSUB001:GMER001',
          eventType: 'executed',
          payload: JSON.stringify({
            eventType: 'executed',
            subscriber: 'GSUB001',
            merchant: 'GMER001',
            token: 'CTOKEN001',
            amount: '500',
            ledger: '50',
            txHash: 'relay-test-001',
          }),
          status: 'pending',
          deduplicationKey: 'relay-test-001',
          publishedAt: null,
        },
        update: {},
      });

      const relay = new OutboxRelay();
      await relay.processPendingEvents();

      const outboxRows = await db.outboxEvent.findMany();
      expect(outboxRows[0].status).toBe('published');
      expect(outboxRows[0].publishedAt).toBeInstanceOf(Date);
    });

    it('calls cache invalidation and email side-effects for payment_transfer_failure', async () => {
      await db.outboxEvent.upsert({
        where: { deduplicationKey: 'relay-fail-001' },
        create: {
          aggregateType: 'subscription',
          aggregateId: 'GSUB001:GMER001',
          eventType: 'payment_transfer_failure',
          payload: JSON.stringify({
            eventType: 'payment_transfer_failure',
            subscriber: 'GSUB001',
            merchant: 'GMER001',
            token: 'CTOKEN001',
            amount: '250',
            ledger: '60',
            txHash: 'relay-fail-001',
          }),
          status: 'pending',
          deduplicationKey: 'relay-fail-001',
          publishedAt: null,
        },
        update: {},
      });

      const relay = new OutboxRelay();
      await relay.processPendingEvents();

      expect(sendPaymentFailureEmail).toHaveBeenCalledWith('GSUB001', 'GMER001', '250', 'CTOKEN001');
      expect(enqueueRetries).toHaveBeenCalledWith('GSUB001', 'GMER001', '250', 'CTOKEN001');
      expect(cacheDeletePattern).toHaveBeenCalled();
      expect(publishCacheInvalidation).toHaveBeenCalled();
    });

    it('calls sendCancellationEmail for cancel events', async () => {
      await db.outboxEvent.upsert({
        where: { deduplicationKey: 'relay-cancel-001' },
        create: {
          aggregateType: 'subscription',
          aggregateId: 'GSUB001:GMER001',
          eventType: 'cancel',
          payload: JSON.stringify({
            eventType: 'cancel',
            subscriber: 'GSUB001',
            merchant: 'GMER001',
            token: 'CTOKEN001',
            amount: '0',
            ledger: '70',
            txHash: 'relay-cancel-001',
          }),
          status: 'pending',
          deduplicationKey: 'relay-cancel-001',
          publishedAt: null,
        },
        update: {},
      });

      const relay = new OutboxRelay();
      await relay.processPendingEvents();

      expect(sendCancellationEmail).toHaveBeenCalledWith('GSUB001', 'GMER001');
    });

    it('marks outbox event failed when dispatch throws', async () => {
      // Force cacheDeletePattern to throw on this call
      (cacheDeletePattern as jest.Mock).mockRejectedValueOnce(new Error('Redis down'));

      await db.outboxEvent.upsert({
        where: { deduplicationKey: 'relay-err-001' },
        create: {
          aggregateType: 'subscription',
          aggregateId: 'GSUB001:GMER001',
          eventType: 'executed',
          payload: JSON.stringify({
            eventType: 'executed',
            subscriber: 'GSUB001',
            merchant: 'GMER001',
            token: 'CTOKEN001',
            amount: '100',
            ledger: '80',
            txHash: 'relay-err-001',
          }),
          status: 'pending',
          deduplicationKey: 'relay-err-001',
          publishedAt: null,
        },
        update: {},
      });

      const relay = new OutboxRelay();
      await relay.processPendingEvents();

      const outboxRows = await db.outboxEvent.findMany();
      expect(outboxRows[0].status).toBe('failed');
    });

    it('does nothing when there are no pending events', async () => {
      const relay = new OutboxRelay();
      await relay.processPendingEvents();
      expect(cacheDeletePattern).not.toHaveBeenCalled();
    });

    it('skips already-published events', async () => {
      await db.outboxEvent.upsert({
        where: { deduplicationKey: 'relay-pub-001' },
        create: {
          aggregateType: 'subscription',
          aggregateId: 'GSUB001:GMER001',
          eventType: 'executed',
          payload: JSON.stringify({
            eventType: 'executed', subscriber: 'GSUB001', merchant: 'GMER001',
            token: 'CTOKEN001', amount: '100', ledger: '90', txHash: 'relay-pub-001',
          }),
          status: 'published',
          deduplicationKey: 'relay-pub-001',
          publishedAt: new Date(),
        },
        update: {},
      });

      const relay = new OutboxRelay();
      await relay.processPendingEvents();

      // No side-effects should be called for an already-published event
      expect(cacheDeletePattern).not.toHaveBeenCalled();
    });
  });
});
