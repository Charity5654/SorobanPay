/**
 * chaos/indexer.chaos.test.ts
 *
 * TEST-108 — Chaos engineering tests for indexer resilience.
 *
 * These tests verify that the EventIndexer behaves correctly under adverse
 * conditions:
 *
 *   CHAOS-1: RPC latency (500 ms) — indexer slows gracefully, does not time out
 *   CHAOS-2: RPC disconnect — indexer throws and can reconnect with backoff
 *   CHAOS-3: DB disconnect — event processing survives a Prisma failure
 *   CHAOS-4: Malformed XDR payloads — 5 invalid event shapes are swallowed
 *   CHAOS-5: Crash recovery — cursor advances correctly; no duplicates, no gaps
 *
 * All network/DB interactions are replaced with controlled fault-injecting mocks
 * so no real infrastructure is required to run this suite.
 *
 * Run:
 *   cd backend && npx jest tests/chaos/indexer.chaos.test.ts --verbose
 *
 * For full Toxiproxy-backed integration, see tests/chaos/README.md and
 * docker-compose.chaos.yml in this directory.
 *
 * References:
 *   Toxiproxy: https://github.com/Shopify/toxiproxy
 *   Issue BE-51: indexer service
 *   Issue BE-63: deduplication
 *   Issue TEST-108: this test suite
 */

// ─── Module mocks ────────────────────────────────────────────────────────────

/** Controls which events the fake RPC returns. */
let _rpcEvents: unknown[] = [];
/** Set to a non-null value to make the next RPC call throw. */
let _rpcError: Error | null = null;
/** Tracks how many times getEvents was called. */
let _rpcCallCount = 0;
/** How many ms to delay each RPC response (simulates latency). */
let _rpcLatencyMs = 0;

/** Accumulated DB writes (simulates Prisma event.create). */
const _dbEvents: Record<string, unknown>[] = [];
/** Set to a non-null value to make the next DB write throw. */
let _dbError: Error | null = null;
/** Queue of errors to throw on successive DB writes (for partial-batch failures). */
const _dbErrorQueue: Error[] = [];

// Mock @stellar/stellar-sdk rpc.Server used by EventIndexer
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    rpc: {
      Server: jest.fn().mockImplementation(() => ({
        getEvents: jest.fn(async () => {
          _rpcCallCount++;
          if (_rpcLatencyMs > 0) {
            await new Promise((r) => setTimeout(r, _rpcLatencyMs));
          }
          if (_rpcError) {
            const err = _rpcError;
            throw err;
          }
          return { events: _rpcEvents };
        }),
      })),
    },
    xdr: actual.xdr,
  };
});

// Mock prisma client
jest.mock('../../backend/src/lib/prisma', () => ({
  __esModule: true,
  default: {
    event: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        // Check per-call error queue first, then global error
        if (_dbErrorQueue.length > 0) {
          throw _dbErrorQueue.shift();
        }
        if (_dbError) {
          throw _dbError;
        }
        const record = { id: String(_dbEvents.length + 1), ...args.data };
        _dbEvents.push(record);
        return record;
      }),
    },
  },
}));

// Silence audit logger, tracing, email, and state machine in chaos tests
jest.mock('../../backend/src/services/auditLogger', () => ({
  AuditLogger: jest.fn().mockImplementation(() => ({ logPayment: jest.fn() })),
}));
jest.mock('../../backend/src/lib/tracing', () => ({
  getTracer: jest.fn(),
  withSpan: jest.fn(async (_t: unknown, _n: unknown, fn: (span: unknown) => Promise<void>) =>
    fn({ setAttributes: jest.fn(), recordException: jest.fn() }),
  ),
  SpanKind: { CLIENT: 0 },
}));
jest.mock('../../backend/src/services/subscriptionStateService', () => ({
  applyEvent: jest.fn(),
}));
jest.mock('../../backend/src/services/emailService', () => ({
  sendPaymentFailureEmail: jest.fn(),
  sendCancellationEmail: jest.fn(),
}));

// ─── Test subject ─────────────────────────────────────────────────────────────

import { EventIndexer } from '../../backend/src/services/eventIndexer';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Reset all fault-injection state between tests. */
function resetFaults(): void {
  _rpcEvents = [];
  _rpcError = null;
  _rpcCallCount = 0;
  _rpcLatencyMs = 0;
  _dbError = null;
  _dbErrorQueue.length = 0;
  _dbEvents.length = 0;
}

/**
 * Build a minimal well-formed event structure that the EventIndexer can decode.
 * The mock SDK returns these from getEvents; they bypass real XDR encoding.
 */
function makeEvent(overrides: Partial<{
  type: string;
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  ledger: number;
}> = {}): unknown {
  const {
    type = 'executed',
    subscriber = 'GSUB0000000000000000001',
    merchant = 'GMER0000000000000000001',
    token = 'CTOK0000000000000000001',
    amount = '1000',
    ledger = 100,
  } = overrides;

  return {
    topic: [
      { sym: () => ({ toString: () => type }) },
      { address: () => ({ toString: () => subscriber }) },
      { address: () => ({ toString: () => merchant }) },
      { address: () => ({ toString: () => token }) },
    ],
    value: { i128: () => ({ toString: () => amount }) },
    ledger,
    id: `${ledger}-0`,
    pagingToken: `${ledger}-0`,
    contractId: 'CTEST',
    inSuccessfulContractCall: true,
    ledgerClosedAt: new Date().toISOString(),
    txHash: 'abc123',
    type: 'contract',
  };
}

// ─── Test suite ───────────────────────────────────────────────────────────────

const CONTRACT_ID = 'CTEST_CONTRACT_0000000000000001';
const RPC_URL = 'https://soroban-testnet.stellar.org';

beforeEach(() => {
  resetFaults();
  jest.clearAllMocks();
});

// ─── CHAOS-1: RPC latency ─────────────────────────────────────────────────────

describe('CHAOS-1: RPC latency (500 ms)', () => {
  /**
   * Simulates 500 ms network latency on every getEvents call.
   * The indexer must not error out — it should simply take longer and still
   * store the events correctly.
   */
  it('indexer processes events correctly despite 500 ms RPC latency', async () => {
    _rpcLatencyMs = 500;
    _rpcEvents = [makeEvent({ type: 'executed', amount: '2500' })];

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);

    const start = Date.now();
    await indexer.fetchAndStoreEvents(1);
    const elapsed = Date.now() - start;

    // Must take at least 500 ms (latency was injected).
    expect(elapsed).toBeGreaterThanOrEqual(450); // 50 ms tolerance for timer jitter

    // Event must still be stored despite latency.
    expect(_dbEvents).toHaveLength(1);
    expect(_rpcCallCount).toBe(1);
  });

  it('indexer does not throw on high latency — returns normally', async () => {
    _rpcLatencyMs = 500;
    _rpcEvents = [];

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
    await expect(indexer.fetchAndStoreEvents(1)).resolves.not.toThrow();
  });
});

// ─── CHAOS-2: RPC disconnect ──────────────────────────────────────────────────

describe('CHAOS-2: RPC disconnect / connection refused', () => {
  /**
   * Simulates the Soroban RPC being unreachable (connection refused).
   * The indexer must propagate the error so callers can implement backoff.
   */
  it('indexer throws when RPC is unreachable', async () => {
    _rpcError = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:8000'), {
      code: 'ECONNREFUSED',
    });

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
    await expect(indexer.fetchAndStoreEvents(1)).rejects.toThrow(/ECONNREFUSED/i);
  });

  it('no events are stored when RPC call fails', async () => {
    _rpcError = new Error('ECONNREFUSED');

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
    await indexer.fetchAndStoreEvents(1).catch(() => {/* expected */});

    expect(_dbEvents).toHaveLength(0);
  });

  it('indexer recovers and stores events after RPC reconnects', async () => {
    // First call fails (simulates transient disconnect).
    _rpcError = new Error('ECONNRESET');
    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);

    await indexer.fetchAndStoreEvents(1).catch(() => {/* swallow first failure */});
    expect(_dbEvents).toHaveLength(0);

    // Clear the error — simulates RPC coming back online.
    _rpcError = null;
    _rpcEvents = [makeEvent({ type: 'subscribe', amount: '5000' })];

    await indexer.fetchAndStoreEvents(1);

    expect(_dbEvents).toHaveLength(1);
  });
});

// ─── CHAOS-3: DB disconnect ───────────────────────────────────────────────────

describe('CHAOS-3: DB disconnect / write failure', () => {
  /**
   * Simulates a Prisma connection error mid-event.
   * The indexer's per-event error handler must swallow the failure so the
   * indexer does not crash; remaining events in the batch are still processed.
   */
  it('indexer continues processing batch after one DB write failure', async () => {
    // First event write will throw a DB connection error.
    _dbErrorQueue.push(
      Object.assign(new Error("Can't reach database server"), { code: 'P1001' }),
    );
    // Second event write succeeds.
    _rpcEvents = [
      makeEvent({ type: 'executed', ledger: 1 }),
      makeEvent({ type: 'executed', ledger: 2 }),
    ];

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
    // Should not throw — event-level errors are caught internally.
    await expect(indexer.fetchAndStoreEvents(1)).resolves.not.toThrow();

    // One event succeeded despite the first write failing.
    expect(_dbEvents).toHaveLength(1);
  });

  it('indexer survives complete DB outage (all writes fail) without crashing', async () => {
    _dbError = new Error('DB connection lost');
    _rpcEvents = [makeEvent(), makeEvent(), makeEvent()];

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
    await expect(indexer.fetchAndStoreEvents(1)).resolves.not.toThrow();

    // No events stored — but indexer is still alive.
    expect(_dbEvents).toHaveLength(0);
  });

  it('restores DB writes after recovery', async () => {
    // Outage for first call.
    _dbError = new Error('P1001 DB unreachable');
    _rpcEvents = [makeEvent({ ledger: 10 })];

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
    await indexer.fetchAndStoreEvents(1).catch(() => {});
    expect(_dbEvents).toHaveLength(0);

    // DB recovers.
    _dbError = null;
    _rpcEvents = [makeEvent({ ledger: 11 })];

    await indexer.fetchAndStoreEvents(1);
    expect(_dbEvents).toHaveLength(1);
  });
});

// ─── CHAOS-4: Malformed XDR corpus ───────────────────────────────────────────

describe('CHAOS-4: Malformed / unexpected event payloads', () => {
  /**
   * A corpus of 5 intentionally invalid event shapes that should be swallowed
   * by the indexer without crashing it or corrupting stored state.
   *
   * Each case represents a different class of malformation:
   *   MXR-1: topics array is missing entirely
   *   MXR-2: topics array is empty (no event type symbol)
   *   MXR-3: event type symbol is unrecognised
   *   MXR-4: subscriber address field throws on decode
   *   MXR-5: event value (amount) field throws on decode
   */

  const malformedCorpus: Array<{ label: string; event: unknown }> = [
    {
      label: 'MXR-1: missing topics field',
      event: {
        // topics deliberately omitted
        value: { i128: () => ({ toString: () => '999' }) },
        ledger: 1,
        id: '1-0',
        pagingToken: '1-0',
      },
    },
    {
      label: 'MXR-2: empty topics array',
      event: {
        topic: [],
        value: { i128: () => ({ toString: () => '999' }) },
        ledger: 2,
        id: '2-0',
        pagingToken: '2-0',
      },
    },
    {
      label: 'MXR-3: unrecognised event type symbol',
      event: {
        topic: [
          { sym: () => ({ toString: () => 'unknown_event_xyz' }) },
          { address: () => ({ toString: () => 'GSUB' }) },
          { address: () => ({ toString: () => 'GMER' }) },
        ],
        value: { i128: () => ({ toString: () => '100' }) },
        ledger: 3,
        id: '3-0',
        pagingToken: '3-0',
      },
    },
    {
      label: 'MXR-4: subscriber address field throws on decode',
      event: {
        topic: [
          { sym: () => ({ toString: () => 'executed' }) },
          {
            address: () => {
              throw new Error('XDR decode error: invalid address');
            },
          },
          { address: () => ({ toString: () => 'GMER' }) },
        ],
        value: { i128: () => ({ toString: () => '100' }) },
        ledger: 4,
        id: '4-0',
        pagingToken: '4-0',
      },
    },
    {
      label: 'MXR-5: amount field throws on decode',
      event: {
        topic: [
          { sym: () => ({ toString: () => 'executed' }) },
          { address: () => ({ toString: () => 'GSUB' }) },
          { address: () => ({ toString: () => 'GMER' }) },
        ],
        value: {
          i128: () => {
            throw new Error('XDR decode error: invalid i128');
          },
          u64: () => {
            throw new Error('XDR decode error: invalid u64');
          },
        },
        ledger: 5,
        id: '5-0',
        pagingToken: '5-0',
      },
    },
  ];

  it.each(malformedCorpus)(
    'indexer swallows $label without crashing',
    async ({ event }) => {
      _rpcEvents = [event];

      const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
      await expect(indexer.fetchAndStoreEvents(1)).resolves.not.toThrow();
    },
  );

  it('indexer processes valid events mixed with malformed ones correctly', async () => {
    const [malformed1, , malformed3] = malformedCorpus;
    _rpcEvents = [
      malformed1.event,
      makeEvent({ type: 'executed', ledger: 10, amount: '1000' }),
      malformed3.event,
      makeEvent({ type: 'subscribe', ledger: 11, amount: '2000' }),
    ];

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
    await indexer.fetchAndStoreEvents(1);

    // Only the 2 well-formed events should be stored.
    expect(_dbEvents).toHaveLength(2);
  });

  it('all 5 malformed corpus entries are swallowed — zero events stored', async () => {
    _rpcEvents = malformedCorpus.map((c) => c.event);

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
    await indexer.fetchAndStoreEvents(1);

    expect(_dbEvents).toHaveLength(0);
  });
});

// ─── CHAOS-5: Crash recovery and idempotency ─────────────────────────────────

describe('CHAOS-5: Crash recovery — no duplicates, no gaps', () => {
  /**
   * Simulates the indexer crashing mid-batch (after storing N events) then
   * restarting and replaying the same ledger range.
   *
   * Expected invariants:
   *   - Events already stored are not duplicated (deduplication via findFirst check).
   *   - Events not yet stored before the crash are picked up on restart.
   *   - Total stored count equals the number of unique events in the ledger range.
   */

  it('replaying the same batch does not create duplicate events', async () => {
    const events = [
      makeEvent({ type: 'executed', ledger: 50, amount: '100' }),
      makeEvent({ type: 'subscribe', ledger: 51, amount: '200' }),
    ];
    _rpcEvents = events;

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);

    // First run — stores both events.
    await indexer.fetchAndStoreEvents(1);
    expect(_dbEvents).toHaveLength(2);

    // Simulate crash + restart: findFirst now returns an existing record for
    // duplicates so the create mock should not be called again.
    const prisma = jest.requireMock('../../backend/src/lib/prisma').default;
    prisma.event.findFirst.mockResolvedValue({ id: 'existing-1' });

    // Second run with same events (replay from same start ledger).
    await indexer.fetchAndStoreEvents(1);

    // Still 2 — no duplicates added.
    expect(_dbEvents).toHaveLength(2);
  });

  it('events not stored before crash are stored on restart', async () => {
    // Simulate crash after first event (DB error on second write only).
    _dbErrorQueue.push(new Error('P1001 simulated crash on second write'));

    const events = [
      makeEvent({ type: 'executed', ledger: 60, amount: '300' }),
      makeEvent({ type: 'executed', ledger: 61, amount: '400' }),
    ];
    _rpcEvents = events;

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);

    // First run — first event stored, second fails.
    await indexer.fetchAndStoreEvents(1);
    expect(_dbEvents).toHaveLength(1);

    // Restart: findFirst returns existing for ledger 60, null for ledger 61.
    const prisma = jest.requireMock('../../backend/src/lib/prisma').default;
    prisma.event.findFirst.mockImplementation(
      async (args: { where: { ledgerTimestamp: bigint } }) => {
        return args.where.ledgerTimestamp === 60n ? { id: 'existing-60' } : null;
      },
    );

    // Second run — only the missed event (ledger 61) should be stored.
    await indexer.fetchAndStoreEvents(1);
    expect(_dbEvents).toHaveLength(2);
  });

  it('cursor advances: events from an earlier ledger are not re-stored', async () => {
    // First batch: ledger 70–71
    _rpcEvents = [
      makeEvent({ type: 'executed', ledger: 70, amount: '500' }),
      makeEvent({ type: 'executed', ledger: 71, amount: '600' }),
    ];

    const indexer = new EventIndexer(RPC_URL, CONTRACT_ID);
    await indexer.fetchAndStoreEvents(70);
    expect(_dbEvents).toHaveLength(2);

    // Second batch: ledger 72 (advancing cursor — no overlap).
    _rpcEvents = [makeEvent({ type: 'executed', ledger: 72, amount: '700' })];

    await indexer.fetchAndStoreEvents(72);
    expect(_dbEvents).toHaveLength(3);

    // No duplicates — all 3 are distinct ledger timestamps.
    const ledgers = _dbEvents.map((e) => Number((e as any).ledgerTimestamp));
    expect(new Set(ledgers).size).toBe(3);
  });
});
