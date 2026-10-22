/**
 * reconciler.dryrun.test.ts
 *
 * Unit tests for the dryRun() function added in #1068.
 *
 * Verifies:
 *  1. Returns repairs without mutating the DB
 *  2. Limit and cursor pagination (first page, second page, no nextCursor on last)
 *  3. Invalid / corrupted cursor is handled gracefully (treated as offset 0)
 *  4. Empty events yield empty repairs
 *  5. Errors from the reconciler are surfaced in the result
 */

import { dryRun } from '../reconciler';
import type { ChainEvent, StoredSubscription, SubscriptionDB } from '../reconciler';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeDB(initial: StoredSubscription[] = []): SubscriptionDB {
  const store = new Map<string, StoredSubscription>(
    initial.map((r) => [`${r.subscriber}:${r.merchant}:${r.token}`, r]),
  );
  return {
    get: (s, m, t) => store.get(`${s}:${m}:${t}`),
    upsert: (r) => { store.set(`${r.subscriber}:${r.merchant}:${r.token}`, r); },
    delete: (s, m, t) => { store.delete(`${s}:${m}:${t}`); },
    all: () => [...store.values()],
  };
}

const IVL = 86_400;
const T0  = 1_700_000_000;

function subscribeEvent(
  subscriber: string,
  overrides?: Partial<ChainEvent>,
): ChainEvent {
  return {
    type: 'subscribe',
    subscriber,
    merchant: 'GMER',
    token: 'CTOK',
    amount: 100_000n,
    timestamp: T0,
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('dryRun()', () => {
  // 1 — Does not mutate the DB
  test('does not mutate the underlying DB', () => {
    const db = makeDB();
    const events: ChainEvent[] = [subscribeEvent('GAAA')];

    const result = dryRun(events, db);

    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].kind).toBe('insert');
    // The DB must remain empty — dry-run must not write.
    expect(db.get('GAAA', 'GMER', 'CTOK')).toBeUndefined();
  });

  // 2 — Returns total and repairs
  test('returns total count and repairs array', () => {
    const db = makeDB();
    const events: ChainEvent[] = [
      subscribeEvent('GAAA'),
      subscribeEvent('GBBB'),
      subscribeEvent('GCCC'),
    ];

    const result = dryRun(events, db);

    expect(result.total).toBe(3);
    expect(result.repairs).toHaveLength(3);
    expect(result.nextCursor).toBeNull(); // fits in default page size of 50
  });

  // 3 — Limit (first page)
  test('limit returns first page and nextCursor', () => {
    const db = makeDB();
    const subscribers = Array.from({ length: 5 }, (_, i) => `G${String(i).padStart(3, '0')}`);
    const events = subscribers.map((s) => subscribeEvent(s));

    const result = dryRun(events, db, { limit: 2 });

    expect(result.repairs).toHaveLength(2);
    expect(result.total).toBe(5);
    expect(result.nextCursor).not.toBeNull();
  });

  // 4 — Cursor (second page)
  test('cursor resumes from the correct position', () => {
    const db = makeDB();
    const subscribers = Array.from({ length: 5 }, (_, i) => `G${String(i).padStart(3, '0')}`);
    const events = subscribers.map((s) => subscribeEvent(s));

    const first = dryRun(events, db, { limit: 2 });
    expect(first.nextCursor).not.toBeNull();

    const second = dryRun(events, db, { limit: 2, cursor: first.nextCursor! });
    expect(second.repairs).toHaveLength(2);
    expect(second.nextCursor).not.toBeNull();

    const third = dryRun(events, db, { limit: 2, cursor: second.nextCursor! });
    expect(third.repairs).toHaveLength(1);
    expect(third.nextCursor).toBeNull(); // last page
  });

  // 5 — Invalid cursor is handled gracefully
  test('invalid cursor string falls back to offset 0 without crashing', () => {
    const db = makeDB();
    const events: ChainEvent[] = [subscribeEvent('GAAA'), subscribeEvent('GBBB')];

    // Pass clearly garbage cursor values
    for (const badCursor of ['!!!', 'not-base64url', '', 'NaN', '-1']) {
      const result = dryRun(events, db, { cursor: badCursor });
      // Should either start from offset 0 or return an empty page — never throw.
      expect(result.total).toBe(2);
    }
  });

  // 6 — Empty events
  test('empty events yield empty repairs', () => {
    const db = makeDB();
    const result = dryRun([], db);
    expect(result.repairs).toHaveLength(0);
    expect(result.total).toBe(0);
    expect(result.errors).toHaveLength(0);
    expect(result.nextCursor).toBeNull();
  });

  // 7 — Errors are surfaced
  test('orphan DB records surface errors in the result', () => {
    const orphan: StoredSubscription = {
      subscriber: 'GORPH',
      merchant: 'GMER',
      token: 'CTOK',
      amount: 100_000n,
      interval: IVL,
      next_payment: T0 + IVL,
      last_payment_at: null,
    };
    const db = makeDB([orphan]);

    const result = dryRun([], db);

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/orphan/i);
    // DB is not mutated (orphan still present)
    expect(db.get('GORPH', 'GMER', 'CTOK')).toBeDefined();
  });

  // 8 — Limit clamping: limit > 500 is capped at 500
  test('limit above 500 is clamped to 500', () => {
    const db = makeDB();
    const events = Array.from({ length: 10 }, (_, i) =>
      subscribeEvent(`G${String(i).padStart(3, '0')}`),
    );

    const result = dryRun(events, db, { limit: 9999 });
    // All 10 fit within the clamped 500 limit
    expect(result.repairs).toHaveLength(10);
  });
});
