/**
 * Unit tests for GET /subscriptions/:merchant (#1373)
 *
 * Uses a mocked pg Pool — no real database connection required.
 */

import request from 'supertest';
import express from 'express';
import { createSubscriptionsRouter } from '../../src/routes/subscriptions';

// We need supertest; add it as a dev dep in package.json or mock the app
// For this test we import the router directly and mount it on a test app.

function buildApp(mockPool: object) {
  const app = express();
  app.use(express.json());
  app.use('/', createSubscriptionsRouter(mockPool as never));
  // error handler
  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      res.status(500).json({ error: err.message });
    },
  );
  return app;
}

const MERCHANT = 'GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

function makeMockPool(rows: object[], count = rows.length) {
  const query = jest.fn().mockImplementation((sql: string) => {
    if (typeof sql === 'string' && sql.trim().toUpperCase().startsWith('SELECT COUNT')) {
      return Promise.resolve({ rows: [{ count: String(count) }] });
    }
    return Promise.resolve({ rows });
  });
  return { query };
}

describe('GET /subscriptions/:merchant', () => {
  const sampleRow = {
    id: 1,
    subscriber: 'GSUB111111111111111111111111111111111111111111111111111',
    merchant: MERCHANT,
    token: 'CTOKEN00000000000000000000000000000000000000000000000000',
    amount: '1000',
    interval_sec: 2592000,
    next_payment: new Date('2025-02-01').toISOString(),
    status: 'active',
    overdue_since: null,
    created_at: new Date('2025-01-01').toISOString(),
    updated_at: new Date('2025-01-01').toISOString(),
  };

  it('returns 200 with paginated subscriptions', async () => {
    const pool = makeMockPool([sampleRow]);
    const app = buildApp(pool);

    const res = await request(app).get(`/subscriptions/${MERCHANT}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].merchant).toBe(MERCHANT);
    expect(res.body.pagination.total).toBe(1);
    expect(res.body.pagination.page).toBe(1);
    expect(res.body.pagination.pageSize).toBe(20);
  });

  it('returns empty list when no subscriptions exist', async () => {
    const pool = makeMockPool([], 0);
    const app = buildApp(pool);

    const res = await request(app).get(`/subscriptions/${MERCHANT}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.total).toBe(0);
    expect(res.body.pagination.totalPages).toBe(0);
  });

  it('filters by status=active', async () => {
    const pool = makeMockPool([sampleRow]);
    const app = buildApp(pool);

    const res = await request(app).get(`/subscriptions/${MERCHANT}?status=active`);

    expect(res.status).toBe(200);
    // Verify the DB was queried with the status filter
    const dataCallArgs = pool.query.mock.calls[1];
    expect(dataCallArgs[1]).toContain('active');
  });

  it('filters by status=cancelled', async () => {
    const cancelled = { ...sampleRow, status: 'cancelled' };
    const pool = makeMockPool([cancelled]);
    const app = buildApp(pool);

    const res = await request(app).get(`/subscriptions/${MERCHANT}?status=cancelled`);

    expect(res.status).toBe(200);
    expect(res.body.data[0].status).toBe('cancelled');
  });

  it('returns 400 for invalid status value', async () => {
    const pool = makeMockPool([]);
    const app = buildApp(pool);

    const res = await request(app).get(`/subscriptions/${MERCHANT}?status=bad_value`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid status/);
  });

  it('paginates correctly — page 2', async () => {
    const pool = makeMockPool([sampleRow], 25);
    const app = buildApp(pool);

    const res = await request(app).get(
      `/subscriptions/${MERCHANT}?page=2&pageSize=10`,
    );

    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(2);
    expect(res.body.pagination.pageSize).toBe(10);
    expect(res.body.pagination.total).toBe(25);
    expect(res.body.pagination.totalPages).toBe(3);
  });

  it('caps pageSize at 100', async () => {
    const pool = makeMockPool([]);
    const app = buildApp(pool);

    const res = await request(app).get(
      `/subscriptions/${MERCHANT}?pageSize=999`,
    );

    expect(res.status).toBe(200);
    expect(res.body.pagination.pageSize).toBe(100);
  });

  it('returns 500 when DB throws', async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(new Error('DB connection failed')),
    };
    const app = buildApp(pool);

    const res = await request(app).get(`/subscriptions/${MERCHANT}`);

    expect(res.status).toBe(500);
  });
});
