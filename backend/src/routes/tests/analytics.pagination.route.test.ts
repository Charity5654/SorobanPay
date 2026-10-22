/**
 * analytics.pagination.route.test.ts
 *
 * Route-level tests for GET /events and GET /aggregates added in #1070.
 *
 * Covers:
 *  - GET /events returns 200 with CursorPage shape
 *  - GET /events with invalid cursor → 400
 *  - GET /events missing tenant → 400
 *  - GET /events limit > 200 → 400
 *  - GET /aggregates returns 200 with aggregate shape
 *  - GET /aggregates unauthorized (no tenant) → 400
 *  - GET /revenue still works (regression)
 */

import express from 'express';
import request from 'supertest';
import analyticsRouter from '../analytics';

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../../services/analyticsService', () => ({
  getPaginatedEvents: jest.fn(),
  getTenantAggregates: jest.fn(),
  // preserve other exports so the router import doesn't fail
  trackEvent: jest.fn(),
  trackPageView: jest.fn(),
  recordConsent: jest.fn(),
  getConsent: jest.fn(),
  hasAnalyticsConsent: jest.fn(),
  getDashboardStats: jest.fn(),
  getUserEventProfile: jest.fn(),
  getRecentEventsForUser: jest.fn(),
}));

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    event: { findMany: jest.fn().mockResolvedValue([]) },
  },
}));

const { getPaginatedEvents: mockGetPaginated, getTenantAggregates: mockGetAggregates } =
  jest.requireMock('../../services/analyticsService');

// ─── App fixture ──────────────────────────────────────────────────────────────

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/analytics', analyticsRouter);
  return app;
}

const TENANT_HEADER = { 'x-tenant-id': 'tenant-test' };

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/analytics/events', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockGetPaginated as jest.Mock).mockResolvedValue({
      items: [],
      nextCursor: null,
      prevCursor: null,
      total: 0,
      pageSize: 0,
    });
  });

  test('returns 200 with CursorPage structure', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/analytics/events')
      .set(TENANT_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('items');
    expect(res.body).toHaveProperty('nextCursor');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('pageSize');
  });

  test('returns 400 when tenant context is missing', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/analytics/events');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/tenant/i);
  });

  test('returns 400 for invalid cursor', async () => {
    (mockGetPaginated as jest.Mock).mockRejectedValue(new Error('Invalid cursor'));

    const app = buildApp();
    const res = await request(app)
      .get('/api/analytics/events?cursor=!!!invalid')
      .set(TENANT_HEADER);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid cursor/i);
  });

  test('returns 400 when limit exceeds 200', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/analytics/events?limit=201')
      .set(TENANT_HEADER);
    expect(res.status).toBe(400);
  });

  test('returns 400 for non-numeric limit', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/analytics/events?limit=abc')
      .set(TENANT_HEADER);
    expect(res.status).toBe(400);
  });

  test('passes tenantId and options to service', async () => {
    const app = buildApp();
    await request(app)
      .get('/api/analytics/events?limit=10&direction=backward')
      .set(TENANT_HEADER);

    expect(mockGetPaginated).toHaveBeenCalledWith(
      'tenant-test',
      expect.objectContaining({ limit: 10, direction: 'backward' }),
    );
  });

  test('returns 500 on unexpected service error', async () => {
    (mockGetPaginated as jest.Mock).mockRejectedValue(new Error('DB error'));

    const app = buildApp();
    const res = await request(app)
      .get('/api/analytics/events')
      .set(TENANT_HEADER);

    expect(res.status).toBe(500);
  });
});

describe('GET /api/analytics/aggregates', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (mockGetAggregates as jest.Mock).mockResolvedValue({
      totalEvents: 0,
      uniqueSessions: 0,
      topEvents: [],
      dateRange: { start: null, end: null },
    });
  });

  test('returns 200 with aggregate structure', async () => {
    const app = buildApp();
    const res = await request(app)
      .get('/api/analytics/aggregates')
      .set(TENANT_HEADER);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('totalEvents');
    expect(res.body).toHaveProperty('uniqueSessions');
    expect(res.body).toHaveProperty('topEvents');
    expect(res.body).toHaveProperty('dateRange');
  });

  test('returns 400 when tenant context is missing', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/analytics/aggregates');
    expect(res.status).toBe(400);
  });

  test('passes tenantId and date range to service', async () => {
    const app = buildApp();
    await request(app)
      .get('/api/analytics/aggregates?startDate=2024-01-01&endDate=2024-01-31')
      .set(TENANT_HEADER);

    expect(mockGetAggregates).toHaveBeenCalledWith(
      'tenant-test',
      expect.any(Date),
      expect.any(Date),
    );
  });

  test('returns 500 on service error', async () => {
    (mockGetAggregates as jest.Mock).mockRejectedValue(new Error('boom'));
    const app = buildApp();
    const res = await request(app)
      .get('/api/analytics/aggregates')
      .set(TENANT_HEADER);
    expect(res.status).toBe(500);
  });
});

describe('GET /api/analytics/revenue (regression)', () => {
  test('still requires merchant param → 400', async () => {
    const app = buildApp();
    const res = await request(app).get('/api/analytics/revenue');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/merchant/i);
  });
});
