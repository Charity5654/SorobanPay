/**
 * eventIndexer.cursor.test.ts  — BE-51
 *
 * Verifies:
 *   1. Indexer resumes from the saved cursor on restart (no startLedger used
 *      when a cursor is already stored in IndexerState).
 *   2. No duplicate Event records are created on restart.
 *   3. Cursor is saved atomically together with the processed events
 *      (the $transaction call wraps both writes).
 *
 * The stellar-sdk and prisma are fully mocked so these unit tests run
 * without any network or database access.
 */

// ── Mock stellar-sdk before any imports touch it ──────────────────────────────
// EventIndexer imports `rpc` and `xdr` from stellar-sdk; we replace them with
// lightweight stubs so Jest never tries to parse the ESM-only transitive
// dependencies (@noble/hashes etc.).
jest.mock('@stellar/stellar-sdk', () => {
  const mockServer = {
    getEvents: jest.fn(),
  };

  return {
    rpc: {
      Server: jest.fn(() => mockServer),
    },
    xdr: {
      ScVal: {
        fromXDR: jest.fn(),
      },
    },
    __mockServer: mockServer,
  };
});

// ── Mock prisma with in-memory client ─────────────────────────────────────────
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('./helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

// ── Mock AuditLogger to avoid side-effects ────────────────────────────────────
jest.mock('../src/services/auditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({
    logPayment: jest.fn().mockResolvedValue(undefined),
  })),
}));

import { EventIndexer } from '../src/services/eventIndexer';
import { InMemoryPrismaClient } from './helpers/inMemoryDb';
import prisma from '../src/lib/prisma';

const db = prisma as unknown as InMemoryPrismaClient;

// Grab the mock server instance created by the jest.mock factory above
const { __mockServer: mockServer } = require('@stellar/stellar-sdk') as any;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a fake raw event object.  The cursor test only exercises the DB /
 * cursor logic; xdr decoding is mocked separately so these values need not
 * be real XDR.
 */
function makeFakeEvent(overrides: {
  id?: string;
  pagingToken?: string;
  ledger?: number;
} = {}) {
  return {
    id: overrides.id ?? 'event-001',
    pagingToken: overrides.pagingToken ?? 'cursor-001',
    ledger: overrides.ledger ?? 100,
    ledgerClosedAt: new Date().toISOString(),
    inSuccessfulContractCall: true,
    contractId: 'CTEST',
    type: 'contract',
    // topic / value are not used because parseEvent is spied on below
    topic: [],
    value: '',
  };
}

/**
 * Spy on the private `parseEvent` method so we can return canned parsed data
 * without needing real XDR decoding.
 */
function spyParseEvent(indexer: EventIndexer, result: {
  eventType: string;
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
} | null = {
  eventType: 'executed',
  subscriber: 'GSUB001',
  merchant: 'GMERCHANT0001',
  token: 'CTOKEN00000001',
  amount: '1000',
}) {
  return jest
    .spyOn(indexer as any, 'parseEvent')
    .mockResolvedValue(result);
}

// ── Setup / teardown ──────────────────────────────────────────────────────────

beforeEach(() => {
  db.reset();
  mockServer.getEvents.mockReset();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('BE-51: EventIndexer cursor resumability', () => {
  it('passes startLedger when no cursor is saved', async () => {
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEvents(42);

    expect(mockServer.getEvents).toHaveBeenCalledTimes(1);
    const callArg = mockServer.getEvents.mock.calls[0][0];
    expect(callArg.startLedger).toBe(42);
    expect(callArg.cursor).toBeUndefined();
  });

  it('uses saved cursor instead of startLedger on restart', async () => {
    // Seed an existing cursor in IndexerState (simulates a previous run)
    await db.indexerState.upsert({
      where: { id: 1 },
      create: { id: 1, lastCursor: 'cursor-from-last-run' },
      update: { lastCursor: 'cursor-from-last-run' },
    });

    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEvents(42); // startLedger should be ignored

    expect(mockServer.getEvents).toHaveBeenCalledTimes(1);
    const callArg = mockServer.getEvents.mock.calls[0][0];
    // Cursor from IndexerState MUST be used
    expect(callArg.cursor).toBe('cursor-from-last-run');
    // startLedger must NOT be present when using cursor pagination
    expect(callArg.startLedger).toBeUndefined();
  });

  it('stores events and saves cursor atomically after successful processing', async () => {
    const event = makeFakeEvent({ pagingToken: 'cursor-after-001', ledger: 101 });
    mockServer.getEvents.mockResolvedValue({ events: [event] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    spyParseEvent(indexer);

    // Track $transaction calls to confirm atomicity
    const txSpy = jest.spyOn(db as any, '$transaction');

    await indexer.fetchAndStoreEvents(100);

    // One event should be stored
    const storedEvents = await db.event.findMany();
    expect(storedEvents).toHaveLength(1);

    // Cursor should be updated to the pagingToken of the last event
    const state = await db.indexerState.findUnique({ where: { id: 1 } });
    expect(state?.lastCursor).toBe('cursor-after-001');

    // Both writes should be inside a single $transaction call
    expect(txSpy).toHaveBeenCalledTimes(1);

    txSpy.mockRestore();
  });

  it('does NOT create duplicate Event records when the same event is seen again', async () => {
    const event = makeFakeEvent({ pagingToken: 'cursor-001', ledger: 101 });
    mockServer.getEvents.mockResolvedValue({ events: [event] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    spyParseEvent(indexer);

    // First run — stores 1 event
    await indexer.fetchAndStoreEvents(100);
    expect((await db.event.findMany()).length).toBe(1);

    // Second run with identical events (simulates restart without saved cursor)
    // The deduplication check must prevent a second insert
    spyParseEvent(indexer);
    await indexer.fetchAndStoreEvents(100);
    expect((await db.event.findMany()).length).toBe(1);
  });

  it('does not update cursor or write events when response is empty', async () => {
    mockServer.getEvents.mockResolvedValue({ events: [] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    await indexer.fetchAndStoreEvents(1);

    expect((await db.event.findMany()).length).toBe(0);
    expect(await db.indexerState.findUnique({ where: { id: 1 } })).toBeNull();
  });

  it('saves cursor as event id when pagingToken is absent', async () => {
    const event = { ...makeFakeEvent({ id: 'evt-fallback-id', ledger: 55 }) };
    // Remove pagingToken to test fallback
    delete (event as any).pagingToken;
    mockServer.getEvents.mockResolvedValue({ events: [event] });

    const indexer = new EventIndexer('http://rpc.test', 'CTEST');
    spyParseEvent(indexer);

    await indexer.fetchAndStoreEvents(50);

    const state = await db.indexerState.findUnique({ where: { id: 1 } });
    // Should fall back to event.id when pagingToken is absent
    expect(state?.lastCursor).toBe('evt-fallback-id');
  });
});
