/**
 * reconciler.test.ts
 *
 * Tests for backend reconciliation logic.
 * Scenarios covered:
 *  1. No events, empty DB → nothing to do
 *  2. Missing record — subscribe event with no DB row → insert
 *  3. Inconsistent record — stored amount differs from chain → update
 *  4. Stale next_payment — executed event not reflected → update
 *  5. Cancel on existing record → delete
 *  6. DB row with no chain history (orphan) → error surfaced
 *  7. executed event before any subscribe → error surfaced, no crash
 *  8. Full lifecycle: subscribe → execute → cancel
 *  9. Re-subscribe after cancel → inserts fresh record
 * 10. Already in sync → zero repairs
 */

import { reconcile } from './reconciler';
import type {
  ChainEvent,
  StoredSubscription,
  SubscriptionDB,
} from './reconciler';

// ─── In-memory DB fixture ─────────────────────────────────────────────────────

function makeDB(initial: StoredSubscription[] = []): SubscriptionDB {
  const store = new Map<string, StoredSubscription>(
    initial.map((r) => [`${r.subscriber}:${r.merchant}:${r.token}`, r]),
  );
  return {
    get:    (s, m, t) => store.get(`${s}:${m}:${t}`),
    upsert: (r) => { store.set(`${r.subscriber}:${r.merchant}:${r.token}`, r); },
    delete: (s, m, t) => { store.delete(`${s}:${m}:${t}`); },
    all:    () => [...store.values()],
  };
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SUB  = 'GAAA';
const MER  = 'GBBB';
const TOK  = 'CTOK';
const AMT  = 100_000n;
const IVL  = 86_400;
const T0   = 1_700_000_000;

const subscribeEvent = (overrides?: Partial<ChainEvent>): ChainEvent => ({
  type:       'subscribe',
  subscriber: SUB,
  merchant:   MER,
  token:      TOK,
  amount:     AMT,
  timestamp:  T0,
  ...overrides,
});

const executedEvent = (overrides?: Partial<ChainEvent>): ChainEvent => ({
  type:       'executed',
  subscriber: SUB,
  merchant:   MER,
  token:      TOK,
  amount:     AMT,
  timestamp:  T0 + IVL + 1,
  ...overrides,
});

const cancelEvent = (overrides?: Partial<ChainEvent>): ChainEvent => ({
  type:       'cancel',
  subscriber: SUB,
  merchant:   MER,
  token:      TOK,
  amount:     0n,
  timestamp:  T0 + IVL * 2,
  ...overrides,
});

const storedRecord = (overrides?: Partial<StoredSubscription>): StoredSubscription => ({
  subscriber:      SUB,
  merchant:        MER,
  token:           TOK,
  amount:          AMT,
  interval:        IVL,
  next_payment:    T0 + IVL,
  last_payment_at: null,
  ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('reconcile()', () => {
  // 1
  test('empty events + empty DB → no repairs, no errors', () => {
    const result = reconcile([], makeDB());
    expect(result.repairs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  // 2
  test('missing record: subscribe event but no DB row → inserts', () => {
    const db = makeDB();
    const result = reconcile([subscribeEvent()], db, IVL);

    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].kind).toBe('insert');
    expect(result.errors).toHaveLength(0);

    // DB must now contain the correct record.
    const stored = db.get(SUB, MER, TOK);
    expect(stored).toBeDefined();
    expect(stored!.amount).toBe(AMT);
    expect(stored!.next_payment).toBe(T0 + IVL);
    expect(stored!.last_payment_at).toBeNull();
  });

  // 3
  test('inconsistent record: stored amount differs → updates', () => {
    const wrong = storedRecord({ amount: 999n });
    const db = makeDB([wrong]);

    const result = reconcile([subscribeEvent()], db, IVL);

    expect(result.repairs).toHaveLength(1);
    const repair = result.repairs[0];
    expect(repair.kind).toBe('update');
    if (repair.kind === 'update') {
      expect(repair.previous.amount).toBe(999n);
      expect(repair.next.amount).toBe(AMT);
    }
    expect(db.get(SUB, MER, TOK)!.amount).toBe(AMT);
  });

  // 4
  test('stale next_payment: executed event not reflected in DB → updates', () => {
    // DB has the post-subscribe state, but the executed event has since occurred.
    const stale = storedRecord({
      next_payment:    T0 + IVL,
      last_payment_at: null,
    });
    const db = makeDB([stale]);

    const result = reconcile([subscribeEvent(), executedEvent()], db, IVL);

    expect(result.repairs).toHaveLength(1);
    const repair = result.repairs[0];
    expect(repair.kind).toBe('update');
    if (repair.kind === 'update') {
      expect(repair.next.last_payment_at).toBe(T0 + IVL + 1);
      expect(repair.next.next_payment).toBe(T0 + IVL + 1 + IVL);
    }
  });

  // 5
  test('cancel event with existing DB record → deletes record', () => {
    const db = makeDB([storedRecord()]);

    const result = reconcile(
      [subscribeEvent(), cancelEvent()],
      db, IVL,
    );

    const deleteRepair = result.repairs.find((r) => r.kind === 'delete');
    expect(deleteRepair).toBeDefined();
    expect(db.get(SUB, MER, TOK)).toBeUndefined();
    expect(result.errors).toHaveLength(0);
  });

  // 6
  test('orphan DB record with no chain events → surfaces error', () => {
    const db = makeDB([storedRecord()]);
    const result = reconcile([], db);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/orphan/i);
    expect(result.errors[0]).toContain(`${SUB}:${MER}`);
    // Orphan detection does NOT auto-delete; only errors are reported.
    expect(db.get(SUB, MER, TOK)).toBeDefined();
  });

  // 7
  test('executed event before any subscribe → surfaces error, no crash', () => {
    const db = makeDB();
    const result = reconcile([executedEvent()], db, IVL);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/no preceding subscribe/i);
    expect(result.repairs).toHaveLength(0);
  });

  // 8
  test('full lifecycle: subscribe → execute → cancel', () => {
    const db = makeDB();

    const result = reconcile(
      [subscribeEvent(), executedEvent(), cancelEvent()],
      db, IVL,
    );

    // Final state = cancelled, so the record should have been inserted then deleted.
    const insertRepair = result.repairs.find((r) => r.kind === 'insert');
    const deleteRepair = result.repairs.find((r) => r.kind === 'delete');
    // The reconciler derives FINAL expected state: cancelled.
    // So only a delete repair should exist if there was no initial DB row.
    // (insert path skipped because expected final state is null)
    expect(deleteRepair).toBeUndefined(); // DB was empty; nothing to delete
    expect(insertRepair).toBeUndefined(); // Expected state is null (cancelled), so no insert
    expect(db.get(SUB, MER, TOK)).toBeUndefined();
    expect(result.errors).toHaveLength(0);
  });

  // 9
  test('cancel then re-subscribe → inserts fresh record', () => {
    const db = makeDB();
    const t2  = T0 + IVL * 3;

    const result = reconcile(
      [subscribeEvent(), cancelEvent(), subscribeEvent({ timestamp: t2, amount: 200_000n })],
      db, IVL,
    );

    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].kind).toBe('insert');
    const stored = db.get(SUB, MER, TOK);
    expect(stored).toBeDefined();
    expect(stored!.amount).toBe(200_000n);
    expect(stored!.next_payment).toBe(t2 + IVL);
  });

  // 10
  test('already in sync → zero repairs', () => {
    // DB already reflects what the subscribe event says.
    const db = makeDB([storedRecord()]);
    const result = reconcile([subscribeEvent()], db, IVL);

    expect(result.repairs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  // Edge: multiple independent subscriptions reconciled together
  test('multiple subscriber/merchant pairs reconciled independently', () => {
    const OTHER_SUB = 'GCCC';
    const db = makeDB();

    const result = reconcile(
      [
        subscribeEvent(),                                              // SUB→MER missing
        subscribeEvent({ subscriber: OTHER_SUB, timestamp: T0 + 1 }), // OTHER_SUB→MER missing
      ],
      db, IVL,
    );

    expect(result.repairs).toHaveLength(2);
    expect(result.repairs.every((r) => r.kind === 'insert')).toBe(true);
    expect(db.get(SUB, MER, TOK)).toBeDefined();
    expect(db.get(OTHER_SUB, MER, TOK)).toBeDefined();
  });

  // Multi-token: same subscriber/merchant with two different tokens → treated as independent subscriptions
  test('same subscriber+merchant with two tokens → independent subscriptions', () => {
    const TOK2 = 'CTOK2';
    const db = makeDB();

    const result = reconcile(
      [
        subscribeEvent(),                              // SUB→MER with TOK
        subscribeEvent({ token: TOK2, amount: 200_000n }), // SUB→MER with TOK2
      ],
      db, IVL,
    );

    expect(result.repairs).toHaveLength(2);
    expect(result.repairs.every((r) => r.kind === 'insert')).toBe(true);
    const recTok1 = db.get(SUB, MER, TOK);
    const recTok2 = db.get(SUB, MER, TOK2);
    expect(recTok1).toBeDefined();
    expect(recTok2).toBeDefined();
    expect(recTok1!.amount).toBe(100_000n);
    expect(recTok2!.amount).toBe(200_000n);
  });

  // Multi-token: cancel only removes the matching token subscription
  test('cancel on one token does not affect subscription for another token', () => {
    const TOK2 = 'CTOK2';
    const db = makeDB();

    const result = reconcile(
      [
        subscribeEvent(),
        subscribeEvent({ token: TOK2 }),
        cancelEvent(), // cancels TOK only
      ],
      db, IVL,
    );

    expect(db.get(SUB, MER, TOK)).toBeUndefined();
    expect(db.get(SUB, MER, TOK2)).toBeDefined();
    expect(result.errors).toHaveLength(0);
  });

  // BigInt comparison: stored amount as string (from DB) vs chain amount as bigint
  test('BigInt comparison: string amount from DB matches bigint from chain', () => {
    // Simulate a DB record where amount is stored as a string (Prisma stores as string)
    const dbRecord: StoredSubscription = {
      subscriber: SUB,
      merchant: MER,
      token: TOK,
      amount: '100000', // String, as it comes from Prisma DB
      interval: IVL,
      next_payment: T0 + IVL,
      last_payment_at: null,
    };
    const db = makeDB([dbRecord]);

    // Chain event has amount as bigint
    const chainEvent: ChainEvent = {
      type: 'subscribe',
      subscriber: SUB,
      merchant: MER,
      token: TOK,
      amount: 100000n, // BigInt
      timestamp: T0,
    };

    const result = reconcile([chainEvent], db, IVL);

    // Should detect no mismatch — strings and bigints should compare equal
    expect(result.repairs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });

  // BigInt comparison: mismatched amounts (one as string, one as bigint)
  test('BigInt comparison: detects actual amount mismatch despite string/bigint types', () => {
    const dbRecord: StoredSubscription = {
      subscriber: SUB,
      merchant: MER,
      token: TOK,
      amount: '999999', // Wrong amount, as string
      interval: IVL,
      next_payment: T0 + IVL,
      last_payment_at: null,
    };
    const db = makeDB([dbRecord]);

    const chainEvent: ChainEvent = {
      type: 'subscribe',
      subscriber: SUB,
      merchant: MER,
      token: TOK,
      amount: 100000n, // Different amount, as bigint
      timestamp: T0,
    };

    const result = reconcile([chainEvent], db, IVL);

    // Should detect the amount mismatch and generate an update repair
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].kind).toBe('update');
    if (result.repairs[0].kind === 'update') {
      expect(result.repairs[0].previous.amount).toBe('999999');
      expect(result.repairs[0].next.amount).toBe(100000n);
    }
    expect(result.errors).toHaveLength(0);
  });

  // BigInt comparison: large stroops amounts with potential floating point rounding
  test('BigInt comparison: handles large stroops amounts that would lose precision in float', () => {
    const largeAmount = '92233720368547758070'; // Large number beyond safe integer range
    const dbRecord: StoredSubscription = {
      subscriber: SUB,
      merchant: MER,
      token: TOK,
      amount: largeAmount,
      interval: IVL,
      next_payment: T0 + IVL,
      last_payment_at: null,
    };
    const db = makeDB([dbRecord]);

    const chainEvent: ChainEvent = {
      type: 'subscribe',
      subscriber: SUB,
      merchant: MER,
      token: TOK,
      amount: BigInt(largeAmount),
      timestamp: T0,
    };

    const result = reconcile([chainEvent], db, IVL);

    // Should match exactly without precision loss
    expect(result.repairs).toHaveLength(0);
    expect(result.errors).toHaveLength(0);
  });
});

// ─── Property-Based Tests (PBT) ───────────────────────────────────────────────

describe('reconcile() property tests (#1125)', () => {
  // Property 1: Idempotence
  test('property: idempotence — reconciling twice with same event stream produces zero repairs on 2nd run', () => {
    // Generate various test cases
    const testCases: ChainEvent[][] = [
      [],
      [subscribeEvent()],
      [subscribeEvent(), executedEvent()],
      [subscribeEvent(), executedEvent(), executedEvent({ timestamp: T0 + IVL * 2 + 1 })],
      [subscribeEvent(), executedEvent(), cancelEvent()],
      [
        subscribeEvent({ subscriber: 'G1', merchant: 'M1', token: 'T1' }),
        subscribeEvent({ subscriber: 'G2', merchant: 'M2', token: 'T2' }),
        executedEvent({ subscriber: 'G1', merchant: 'M1', token: 'T1' }),
        cancelEvent({ subscriber: 'G2', merchant: 'M2', token: 'T2' }),
      ],
    ];

    for (const events of testCases) {
      const db = makeDB();
      // First pass: apply repairs
      reconcile(events, db, IVL);

      // Second pass: must be completely in sync
      const secondRun = reconcile(events, db, IVL);
      expect(secondRun.repairs).toHaveLength(0);
      expect(secondRun.errors).toHaveLength(0);
    }
  });

  // Property 2: Commutativity / Isolation across disjoint keys
  test('property: commutativity across disjoint keys — event ordering of independent keys does not affect final state', () => {
    const key1Events: ChainEvent[] = [
      subscribeEvent({ subscriber: 'GA1', merchant: 'MA1', token: 'TA1', amount: 500n, timestamp: 100 }),
      executedEvent({ subscriber: 'GA1', merchant: 'MA1', token: 'TA1', amount: 500n, timestamp: 200 }),
    ];

    const key2Events: ChainEvent[] = [
      subscribeEvent({ subscriber: 'GB2', merchant: 'MB2', token: 'TB2', amount: 900n, timestamp: 150 }),
      cancelEvent({ subscriber: 'GB2', merchant: 'MB2', token: 'TB2', timestamp: 300 }),
    ];

    // Order A: key1 then key2
    const dbA = makeDB();
    reconcile([...key1Events, ...key2Events], dbA, IVL);

    // Order B: interleaved strictly by timestamp
    const interleaved = [...key1Events, ...key2Events].sort((a, b) => a.timestamp - b.timestamp);
    const dbB = makeDB();
    reconcile(interleaved, dbB, IVL);

    expect(dbA.all()).toEqual(dbB.all());
    expect(dbA.get('GA1', 'MA1', 'TA1')).toEqual(dbB.get('GA1', 'MA1', 'TA1'));
    expect(dbA.get('GB2', 'MB2', 'TB2')).toBeUndefined();
    expect(dbB.get('GB2', 'MB2', 'TB2')).toBeUndefined();
  });

  // Property 3: Payment timestamp monotonicity
  test('property: monotonicity — last_payment_at increases monotonically and next_payment = last_payment_at + interval', () => {
    const intervals = [3600, 86400, 604800];
    for (const interval of intervals) {
      const db = makeDB();
      const events: ChainEvent[] = [
        subscribeEvent({ timestamp: 1_000_000 }),
      ];

      let lastTime = 1_000_000;
      for (let i = 1; i <= 5; i++) {
        lastTime += interval + i * 10;
        events.push(executedEvent({ timestamp: lastTime }));
      }

      const res = reconcile(events, db, interval);
      expect(res.errors).toHaveLength(0);

      const record = db.get(SUB, MER, TOK);
      expect(record).toBeDefined();
      expect(record!.last_payment_at).toBe(lastTime);
      expect(record!.next_payment).toBe(lastTime + interval);
    }
  });

  // Property 4: Cancellation terminality
  test('property: cancellation absorption — a final cancel always deletes the record regardless of prior event depth', () => {
    for (let execCount = 0; execCount < 10; execCount++) {
      const db = makeDB();
      const events: ChainEvent[] = [subscribeEvent({ timestamp: T0 })];
      let t = T0;
      for (let i = 0; i < execCount; i++) {
        t += IVL + 1;
        events.push(executedEvent({ timestamp: t }));
      }
      events.push(cancelEvent({ timestamp: t + IVL }));

      reconcile(events, db, IVL);
      expect(db.get(SUB, MER, TOK)).toBeUndefined();
      expect(db.all().find((r) => r.subscriber === SUB && r.merchant === MER)).toBeUndefined();
    }
  });

  // Property 5: Randomized fuzz property testing (50 randomized valid event streams)
  test('property: randomized fuzz sequences — invariants hold across generated event sequences', () => {
    const subscribers = ['GSUB1', 'GSUB2', 'GSUB3'];
    const merchants = ['GMER1', 'GMER2'];
    const tokens = ['CTOK1', 'CTOK2'];

    for (let seed = 0; seed < 50; seed++) {
      const db = makeDB();
      const events: ChainEvent[] = [];
      let clock = 1_000_000 + seed * 1000;

      // Track active subscriptions generated in this run
      const activeKeys = new Set<string>();

      const numEvents = 10 + (seed % 15);
      for (let e = 0; e < numEvents; e++) {
        const sub = subscribers[e % subscribers.length];
        const mer = merchants[(e + seed) % merchants.length];
        const tok = tokens[(e * 2) % tokens.length];
        const key = `${sub}:${mer}:${tok}`;
        clock += 1000;

        if (!activeKeys.has(key)) {
          // Can subscribe
          events.push({
            type: 'subscribe',
            subscriber: sub,
            merchant: mer,
            token: tok,
            amount: BigInt(100 + (seed * 10) + e),
            timestamp: clock,
          });
          activeKeys.add(key);
        } else {
          // Randomly choose execute or cancel
          if (e % 3 === 0) {
            events.push({
              type: 'cancel',
              subscriber: sub,
              merchant: mer,
              token: tok,
              amount: 0n,
              timestamp: clock,
            });
            activeKeys.delete(key);
          } else {
            events.push({
              type: 'executed',
              subscriber: sub,
              merchant: mer,
              token: tok,
              amount: BigInt(100 + (seed * 10) + e),
              timestamp: clock,
            });
          }
        }
      }

      // 1. Reconciler should complete without errors
      const result = reconcile(events, db, IVL);
      expect(result.errors).toHaveLength(0);

      // 2. Re-reconciliation must be idempotent
      const result2 = reconcile(events, db, IVL);
      expect(result2.repairs).toHaveLength(0);
      expect(result2.errors).toHaveLength(0);

      // 3. Stored records must strictly match activeKeys
      const storedKeys = new Set(db.all().map((r) => `${r.subscriber}:${r.merchant}:${r.token}`));
      expect(storedKeys).toEqual(activeKeys);
    }
  });
});

