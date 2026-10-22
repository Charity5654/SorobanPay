/**
 * reconcile.dryrun.route.test.ts
 *
 * Route-level tests for GET /api/reconcile/dry-run (#1068).
 *
 * Covers:
 *  - Valid request (with tenant header) → 200 with dry_run: true
 *  - Missing tenant → 400
 *  - Invalid limit (non-numeric) → 400
 *  - Limit > 500 → 400
 *  - Cursor pagination (passes cursor, gets second page)
 *  - Service error → 500
 */

import express from 'express';
import request from 'supertest';
import reconcileRouter from '../reconcile';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../services/reconciler', () => ({
  reconcile: jest.fn(),
  dryRun: jest.fn(),
  PrismaSubscriptionDB: {
    load: jest.fn(),
  },
  fetchChainEventsFromDB: jest.fn(),
}));

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {},
}));

const {
  dryRun: mockDryRun,
  PrismaSubscriptionDB,
  fetchChainEventsFromDB: mockFetchChainEvents,
} = jest.requireMock('../../services/reconciler');

// ─── App fixture ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/reconcile', reconcileRouter);
  return app;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/reconcile/dry-run', () => {
  const TENANT_HEADER = { 'x-tenant-id': 'tenant-abc' };

  beforeEach(() => {
    jest.clearAllMocks();

    // Default happy-path mocks
    (fetchChainEventsFromDB as jest.Mock).mockResolvedValue([]);
    (PrismaSubscriptionDB.load as jest.Mock).mockResolvedValue({
      get: jest.fn(),
      upsert: jest.fn(),
      delete: jest.fn(),
      all: jest.fn().mockReturnValue([]),
    });
    (mockDryRun as jest.Mock).mockReturnValue({
      repairs: [],
      errors: [],
      total: 0,
      nextCursor: null,
    });
  });

  test('returns 200 with dry_run: true for a valid request', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/reconcile/dry-run')
      .set(TENANT_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.dry_run).toBe(true);
    expect(res.body).toHaveProperty('repairs');
    expect(res.body).toHaveProperty('errors');
    expect(res.body).toHaveProperty('total');
  });

  test('returns 400 when tenant context is missing', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/reconcile/dry-run');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tenant/i);
  });

  test('returns 400 for non-numeric limit', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/reconcile/dry-run?limit=abc')
      .set(TENANT_HEADER);
    expect(res.status).toBe(400);
  });

  test('returns 400 when limit exceeds 500', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/reconcile/dry-run?limit=501')
      .set(TENANT_HEADER);
    expect(res.status).toBe(400);
  });

  test('passes cursor to dryRun and returns nextCursor in response', async () => {
    const cursor = Buffer.from('2', 'utf8').toString('base64url');
    (mockDryRun as jest.Mock).mockReturnValue({
      repairs: [{ kind: 'insert', record: {} }],
      errors: [],
      total: 10,
      nextCursor: Buffer.from('4', 'utf8').toString('base64url'),
    });

    const app = buildApp();
    const res = await request(app)
      .get(`/api/reconcile/dry-run?cursor=${cursor}&limit=2`)
      .set(TENANT_HEADER);

    expect(res.status).toBe(200);
    expect(res.body.nextCursor).toBeTruthy();
    expect(mockDryRun).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ cursor, limit: 2 }),
    );
  });

  test('returns 500 when the service throws', async () => {
    (mockDryRun as jest.Mock).mockImplementation(() => {
      throw new Error('DB exploded');
    });

    const app = buildApp();
    const res = await request(app)
      .get('/api/reconcile/dry-run')
      .set(TENANT_HEADER);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/dry-run reconciliation failed/i);
  });

  test('returns 200 on limit=1 (boundary)', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/reconcile/dry-run?limit=1')
      .set(TENANT_HEADER);
    expect(res.status).toBe(200);
  });

  test('returns 400 on limit=0 (below minimum)', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/reconcile/dry-run?limit=0')
      .set(TENANT_HEADER);
    expect(res.status).toBe(400);
  });
});
