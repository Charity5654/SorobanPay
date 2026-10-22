/**
 * indexerCheckpointRecovery.test.ts — #1073
 *
 * Tests for the indexer checkpoint recovery feature added in #1073.
 *
 * Verifies:
 *   1.  saveCheckpoint persists with correct fields.
 *   2.  getLatestCheckpoint returns the highest-sequence checkpoint.
 *   3.  recoverFromCheckpoint returns cursor + ledger when checksum valid.
 *   4.  recoverFromCheckpoint returns null when checksum is tampered.
 *   5.  Old checkpoints are pruned when maxCheckpoints is exceeded.
 *   6.  isDuplicateEvent returns false for new event, true after markEventProcessed.
 *   7.  markEventProcessed is idempotent (safe to call twice).
 *   8.  listCheckpoints returns checkpoints ordered by sequence descending.
 *   9.  recoverFromCheckpoint with no checkpoints returns null.
 *  10.  Checkpoint save/recover round-trip after simulated interruption.
 *  11.  getCheckpoint(sequence) returns the correct row.
 */

// ── Mock prisma with in-memory client ─────────────────────────────────────────
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('./helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

import { IndexerStateService } from '../src/services/indexerStateService';
import { InMemoryPrismaClient } from './helpers/inMemoryDb';
import prisma from '../src/lib/prisma';

const db = prisma as unknown as InMemoryPrismaClient;

// ── Setup / teardown ──────────────────────────────────────────────────────────

let svc: IndexerStateService;

beforeEach(() => {
  db.reset();
  svc = new IndexerStateService();
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('#1073 — IndexerStateService checkpoint recovery', () => {
  // ── 1. saveCheckpoint persists correct fields ─────────────────────────────

  it('saveCheckpoint persists a row with the expected fields', async () => {
    const entry = await svc.saveCheckpoint(1, 'cursor-001', 100, 42);

    expect(entry.sequence).toBe(1);
    expect(entry.cursor).toBe('cursor-001');
    expect(entry.ledger).toBe(100);
    expect(entry.eventCount).toBe(42);
    expect(typeof entry.checksum).toBe('string');
    expect(entry.checksum.length).toBeGreaterThan(0);
  });

  // ── 2. getLatestCheckpoint returns highest-sequence ───────────────────────

  it('getLatestCheckpoint returns the checkpoint with the highest sequence', async () => {
    await svc.saveCheckpoint(1, 'cursor-a', 100, 10);
    await svc.saveCheckpoint(3, 'cursor-c', 300, 30);
    await svc.saveCheckpoint(2, 'cursor-b', 200, 20);

    const latest = await svc.getLatestCheckpoint();

    expect(latest).not.toBeNull();
    expect(latest!.sequence).toBe(3);
    expect(latest!.cursor).toBe('cursor-c');
  });

  // ── 3. recoverFromCheckpoint returns data when checksum valid ─────────────

  it('recoverFromCheckpoint returns cursor and ledger for a valid checkpoint', async () => {
    await svc.saveCheckpoint(5, 'cursor-valid', 500, 55);

    const recovered = await svc.recoverFromCheckpoint(5);

    expect(recovered).not.toBeNull();
    expect(recovered!.cursor).toBe('cursor-valid');
    expect(recovered!.ledger).toBe(500);
    expect(recovered!.eventCount).toBe(55);
  });

  // ── 4. recoverFromCheckpoint returns null when checksum is tampered ───────

  it('recoverFromCheckpoint returns null when checksum does not match', async () => {
    await svc.saveCheckpoint(7, 'cursor-tamper', 700, 77);

    // Provide a checksumFn that always returns a wrong value → simulates corruption
    const recovered = await svc.recoverFromCheckpoint(7, () => 'tampered-checksum');

    expect(recovered).toBeNull();
  });

  // ── 5. Old checkpoints are pruned when maxCheckpoints exceeded ────────────

  it('prunes oldest checkpoints when total exceeds maxCheckpoints', async () => {
    const MAX = 3;

    // Save MAX + 2 checkpoints
    for (let i = 1; i <= MAX + 2; i++) {
      await svc.saveCheckpoint(i, `cursor-${i}`, i * 100, i * 10, { maxCheckpoints: MAX });
    }

    const all = await svc.listCheckpoints();

    expect(all.length).toBeLessThanOrEqual(MAX);
    // Should retain the most recent ones (highest sequence)
    const sequences = all.map((c) => c.sequence).sort((a, b) => a - b);
    expect(sequences[0]).toBeGreaterThan(0);
    expect(Math.max(...sequences)).toBe(MAX + 2);
  });

  // ── 6. isDuplicateEvent / markEventProcessed ──────────────────────────────

  it('isDuplicateEvent returns false for an unseen event', async () => {
    const result = await svc.isDuplicateEvent('evt-new-001');
    expect(result).toBe(false);
  });

  it('isDuplicateEvent returns true after markEventProcessed', async () => {
    await svc.markEventProcessed('evt-proc-001', 50);
    const result = await svc.isDuplicateEvent('evt-proc-001');
    expect(result).toBe(true);
  });

  // ── 7. markEventProcessed is idempotent ───────────────────────────────────

  it('markEventProcessed is safe to call twice for the same event', async () => {
    await expect(svc.markEventProcessed('evt-idem-001', 60)).resolves.not.toThrow();
    await expect(svc.markEventProcessed('evt-idem-001', 60)).resolves.not.toThrow();

    const result = await svc.isDuplicateEvent('evt-idem-001');
    expect(result).toBe(true);
  });

  // ── 8. listCheckpoints returns by sequence desc ───────────────────────────

  it('listCheckpoints returns checkpoints ordered by sequence descending', async () => {
    await svc.saveCheckpoint(2, 'c2', 200, 20);
    await svc.saveCheckpoint(1, 'c1', 100, 10);
    await svc.saveCheckpoint(3, 'c3', 300, 30);

    const list = await svc.listCheckpoints();

    const sequences = list.map((c) => c.sequence);
    expect(sequences).toEqual([3, 2, 1]);
  });

  // ── 9. recoverFromCheckpoint with no checkpoints returns null ─────────────

  it('recoverFromCheckpoint with no checkpoints returns null', async () => {
    const result = await svc.recoverFromCheckpoint();
    expect(result).toBeNull();
  });

  // ── 10. Round-trip: save then recover after simulated interruption ─────────

  it('save at sequence 5, interrupt, recover returns sequence 5 state', async () => {
    // First service instance — saves state
    const svc1 = new IndexerStateService();
    await svc1.saveCheckpoint(5, 'cursor-seq5', 550, 75);

    // Second service instance — simulates restart
    const svc2 = new IndexerStateService();
    const recovered = await svc2.recoverFromCheckpoint(5);

    expect(recovered).not.toBeNull();
    expect(recovered!.cursor).toBe('cursor-seq5');
    expect(recovered!.ledger).toBe(550);
    expect(recovered!.eventCount).toBe(75);
  });

  // ── 11. getCheckpoint retrieves a specific sequence ───────────────────────

  it('getCheckpoint(sequence) returns the correct row', async () => {
    await svc.saveCheckpoint(10, 'cursor-ten', 1000, 100);
    await svc.saveCheckpoint(20, 'cursor-twenty', 2000, 200);

    const row = await svc.getCheckpoint(10);

    expect(row).not.toBeNull();
    expect(row!.cursor).toBe('cursor-ten');
    expect(row!.ledger).toBe(1000);
  });

  it('getCheckpoint returns null for a non-existent sequence', async () => {
    const row = await svc.getCheckpoint(999);
    expect(row).toBeNull();
  });

  // ── 12. saveCheckpoint upsert is idempotent ───────────────────────────────

  it('saving the same sequence twice updates the row rather than creating a duplicate', async () => {
    await svc.saveCheckpoint(1, 'cursor-v1', 100, 10);
    await svc.saveCheckpoint(1, 'cursor-v2', 200, 20); // same sequence, updated values

    const all = await svc.listCheckpoints();
    expect(all).toHaveLength(1);
    expect(all[0].cursor).toBe('cursor-v2');
    expect(all[0].ledger).toBe(200);
  });

  // ── 13. Existing API surface is preserved ────────────────────────────────

  it('getLastCursor returns null on fresh start', async () => {
    const cursor = await svc.getLastCursor();
    expect(cursor).toBeNull();
  });

  it('saveState / getLastCursor / getLastProcessedLedger round-trip', async () => {
    await svc.saveState('my-cursor', 42);
    expect(await svc.getLastCursor()).toBe('my-cursor');
    expect(await svc.getLastProcessedLedger()).toBe(42);
  });

  it('clearState removes the singleton state row', async () => {
    await svc.saveState('cursor-x', 10);
    await svc.clearState();
    expect(await svc.getLastCursor()).toBeNull();
  });
});
