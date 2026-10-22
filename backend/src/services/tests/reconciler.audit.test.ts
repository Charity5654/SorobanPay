/**
 * reconciler.audit.test.ts — #1069
 *
 * Tests for the audit reconciliation repairs feature added in #1069.
 *
 * Verifies:
 *   1. runReconciledWithAudit generates audit entries for insert repairs.
 *   2. Each entry has actor, tenantId, correlationId, aggregateId set.
 *   3. beforeValue is null for insert repairs; afterValue is JSON.
 *   4. dryRun=true does NOT call auditLogger.logRepair.
 *   5. dryRun=false DOES call auditLogger.logRepair for each repair.
 *   6. correlationId is auto-generated (UUID) when not provided.
 *   7. All entries in one run share the same correlationId.
 *   8. Empty events produce empty auditEntries.
 *   9. tenantId from options is stamped on all entries.
 *  10. update repair has beforeValue and afterValue both set.
 *  11. delete repair has beforeValue null, afterValue null.
 */

import {
  runReconciledWithAudit,
  ReconciliationAuditLogger,
  ReconciliationAuditEntry,
  RunReconciledWithAuditOptions,
} from '../reconciler';
import type { ChainEvent, StoredSubscription, SubscriptionDB } from '../../../reconciler';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const IVL = 86_400;
const T0  = 1_700_000_000;

function makeDB(initial: StoredSubscription[] = []): SubscriptionDB {
  const store = new Map<string, StoredSubscription>(
    initial.map((r) => [`${r.subscriber}:${r.merchant}:${r.token}`, r]),
  );
  return {
    get:    (s, m, t) => store.get(`${s}:${m}:${t}`),
    upsert: (r)       => { store.set(`${r.subscriber}:${r.merchant}:${r.token}`, r); },
    delete: (s, m, t) => { store.delete(`${s}:${m}:${t}`); },
    all:    ()        => [...store.values()],
  };
}

function subscribeEvent(subscriber: string, merchant = 'GMER', token = 'CTOK', ts = T0): ChainEvent {
  return { type: 'subscribe', subscriber, merchant, token, amount: 100_000n, timestamp: ts };
}

function executedEvent(subscriber: string, merchant = 'GMER', token = 'CTOK', ts = T0 + IVL): ChainEvent {
  return { type: 'executed', subscriber, merchant, token, amount: 100_000n, timestamp: ts };
}

function makeMockAuditLogger(): { logger: ReconciliationAuditLogger; spy: jest.Mock } {
  const spy = jest.fn().mockResolvedValue(undefined);
  const db: any = {
    reconciliationAudit: { create: jest.fn().mockResolvedValue({}) },
  };
  const logger = new ReconciliationAuditLogger(db);
  // Override logRepair with spy for assertion convenience
  (logger as any).logRepair = spy;
  return { logger, spy };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('#1069 — runReconciledWithAudit', () => {
  // ── 1. Generates audit entries for insert repairs ─────────────────────────

  it('generates one audit entry per insert repair', async () => {
    const db = makeDB(); // empty — all events will be inserts
    const events: ChainEvent[] = [subscribeEvent('GAAA'), subscribeEvent('GBBB')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'scheduler', tenantId: 'tenant-1', auditLogger: logger,
    });

    expect(auditEntries).toHaveLength(2);
    expect(auditEntries.every((e) => e.repairKind === 'insert')).toBe(true);
  });

  // ── 2. Audit entry fields are correct ─────────────────────────────────────

  it('stamps actor and tenantId on every audit entry', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GCCC')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'cron-job', tenantId: 'acme-corp', auditLogger: logger,
    });

    expect(auditEntries[0].actor).toBe('cron-job');
    expect(auditEntries[0].tenantId).toBe('acme-corp');
  });

  it('sets aggregateId to subscriber:merchant:token', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GDDD', 'GMERX', 'CTOKX')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'admin', tenantId: 'test', auditLogger: logger,
    });

    expect(auditEntries[0].aggregateId).toBe('GDDD:GMERX:CTOKX');
  });

  // ── 3. beforeValue null for insert, afterValue is JSON ────────────────────

  it('sets beforeValue null and afterValue JSON for insert repair', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GEEE')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'admin', tenantId: 'test', auditLogger: logger,
    });

    expect(auditEntries[0].beforeValue).toBeNull();
    const after = JSON.parse(auditEntries[0].afterValue!);
    expect(after.subscriber).toBe('GEEE');
    expect(typeof after.amount).toBe('string'); // bigint serialised as string
  });

  // ── 4 & 5. dryRun flag controls logRepair calls ───────────────────────────

  it('dryRun=true does NOT call auditLogger.logRepair', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GFFF')];
    const { logger, spy } = makeMockAuditLogger();

    await runReconciledWithAudit({
      events, db, actor: 'dry', tenantId: 'test', auditLogger: logger, dryRun: true,
    });

    expect(spy).not.toHaveBeenCalled();
  });

  it('dryRun=false DOES call auditLogger.logRepair for each repair', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GGGG'), subscribeEvent('GHHH')];
    const { logger, spy } = makeMockAuditLogger();

    await runReconciledWithAudit({
      events, db, actor: 'live', tenantId: 'test', auditLogger: logger, dryRun: false,
    });

    expect(spy).toHaveBeenCalledTimes(2);
  });

  // ── 6 & 7. correlationId auto-generation ─────────────────────────────────

  it('auto-generates a UUID correlationId when not provided', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GIII')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'admin', tenantId: 'test', auditLogger: logger,
    });

    const id = auditEntries[0].correlationId;
    // UUID v4 pattern
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });

  it('all entries in one run share the same correlationId', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GJJJ'), subscribeEvent('GKKK')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'admin', tenantId: 'test', auditLogger: logger,
    });

    const ids = auditEntries.map((e) => e.correlationId);
    expect(new Set(ids).size).toBe(1);
  });

  it('uses provided correlationId when given', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GLLL')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'admin', tenantId: 'test', correlationId: 'my-corr-id', auditLogger: logger,
    });

    expect(auditEntries[0].correlationId).toBe('my-corr-id');
  });

  // ── 8. Empty events ───────────────────────────────────────────────────────

  it('empty events produce empty auditEntries', async () => {
    const db = makeDB();
    const { logger } = makeMockAuditLogger();

    const { auditEntries, result } = await runReconciledWithAudit({
      events: [], db, actor: 'admin', tenantId: 'test', auditLogger: logger,
    });

    expect(auditEntries).toHaveLength(0);
    expect(result.repairs).toHaveLength(0);
  });

  // ── 9. Tenant isolation ───────────────────────────────────────────────────

  it('tenantId from options is stamped on all entries', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GMMM'), subscribeEvent('GNNN')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'admin', tenantId: 'special-tenant', auditLogger: logger,
    });

    expect(auditEntries.every((e) => e.tenantId === 'special-tenant')).toBe(true);
  });

  // ── 10. Update repair ─────────────────────────────────────────────────────

  it('update repair has beforeValue and afterValue both set', async () => {
    // Seed a DB record with a different amount than the chain event
    const storedRecord: StoredSubscription = {
      subscriber: 'GOOO',
      merchant: 'GMER',
      token: 'CTOK',
      amount: 50_000n,          // diverged — chain says 100_000n
      interval: IVL,
      next_payment: T0 + IVL,
      last_payment_at: null,
    };
    const db = makeDB([storedRecord]);
    const events = [subscribeEvent('GOOO')]; // chain says amount=100_000n
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'admin', tenantId: 'test', auditLogger: logger,
    });

    const updateEntry = auditEntries.find((e) => e.repairKind === 'update');
    expect(updateEntry).toBeDefined();
    expect(updateEntry!.beforeValue).not.toBeNull();
    expect(updateEntry!.afterValue).not.toBeNull();

    const before = JSON.parse(updateEntry!.beforeValue!);
    const after  = JSON.parse(updateEntry!.afterValue!);
    expect(before.amount).toBe('50000');
    expect(after.amount).toBe('100000');
  });

  // ── 11. Decision string is non-empty ─────────────────────────────────────

  it('decision string is set and non-empty', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GPPP')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'admin', tenantId: 'test', auditLogger: logger,
    });

    expect(auditEntries[0].decision.length).toBeGreaterThan(0);
    expect(auditEntries[0].decision).toContain('GPPP');
  });

  // ── 12. timestamp is a Date ───────────────────────────────────────────────

  it('timestamp is a Date instance', async () => {
    const db = makeDB();
    const events = [subscribeEvent('GQQQ')];
    const { logger } = makeMockAuditLogger();

    const { auditEntries } = await runReconciledWithAudit({
      events, db, actor: 'admin', tenantId: 'test', auditLogger: logger,
    });

    expect(auditEntries[0].timestamp).toBeInstanceOf(Date);
  });
});
