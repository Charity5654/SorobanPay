/**
 * Unit tests for GET /payments/:merchant (#1374)
 *
 * Uses a mocked pg Pool — no real database connection required.
 */

import request from 'supertest';
import express from 'express';
import { createPaymentsRouter } from '../../src/routes/payments';

function buildApp(mockPool: object) {
  const app = express();
  app.use(express.json());
  app.use('/', createPaymentsRouter(mockPool as never));
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

describe('GET /payments/:merchant', () => {
  const sampleRow = {
    id: 1,
    tx_hash: 'abc123def456',
    event_type: 'executed',
    subscriber: 'GSUB111111111111111111111111111111111111111111111111111',
    merchant: MERCHANT,
    amount: '500',
    payment_nonce: null,
    ledger_seq: 1234,
    occurred_at: new Date('2025-01-15').toISOString(),
  };

  it('returns 200 with paginated payments', async () => {
    const pool = makeMockPool([sampleRow]);
    const app = buildApp(pool);

    const res = await request(app).get(`/payments/${MERCHANT}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].tx_hash).toBe('abc123def456');
    expect(res.body.pagination.total).toBe(1);
  });

  it('returns empty list when no payments exist', async () => {
    const pool = makeMockPool([], 0);
    const app = buildApp(pool);

    const res = await request(app).get(`/payments/${MERCHANT}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
    expect(res.body.pagination.totalPages).toBe(0);
  });

  it('filters by event_type=executed', async () => {
    const pool = makeMockPool([sampleRow]);
    const app = buildApp(pool);

    const res = await request(app).get(`/payments/${MERCHANT}?event_type=executed`);

    expect(res.status).toBe(200);
    const dataCallArgs = pool.query.mock.calls[1];
    expect(dataCallArgs[1]).toContain('executed');
  });

  it('returns 400 for invalid event_type', async () => {
    const pool = makeMockPool([]);
    const app = buildApp(pool);

    const res = await request(app).get(`/payments/${MERCHANT}?event_type=invalid`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid event_type/);
  });

  it('filters by subscriber', async () => {
    const pool = makeMockPool([sampleRow]);
    const app = buildApp(pool);
    const sub = 'GSUB111111111111111111111111111111111111111111111111111';

    const res = await request(app).get(
      `/payments/${MERCHANT}?subscriber=${sub}`,
    );

    expect(res.status).toBe(200);
    const dataCallArgs = pool.query.mock.calls[1];
    expect(dataCallArgs[1]).toContain(sub);
  });

  it('filters by date range', async () => {
    const pool = makeMockPool([sampleRow]);
    const app = buildApp(pool);

    const res = await request(app).get(
      `/payments/${MERCHANT}?from=2025-01-01&to=2025-12-31`,
    );

    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid "from" date', async () => {
    const pool = makeMockPool([]);
    const app = buildApp(pool);

    const res = await request(app).get(`/payments/${MERCHANT}?from=notadate`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from/);
  });

  it('returns 400 for invalid "to" date', async () => {
    const pool = makeMockPool([]);
    const app = buildApp(pool);

    const res = await request(app).get(`/payments/${MERCHANT}?to=notadate`);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/to/);
  });

  it('paginates correctly', async () => {
    const pool = makeMockPool([sampleRow], 50);
    const app = buildApp(pool);

    const res = await request(app).get(
      `/payments/${MERCHANT}?page=3&pageSize=10`,
    );

    expect(res.status).toBe(200);
    expect(res.body.pagination.page).toBe(3);
    expect(res.body.pagination.pageSize).toBe(10);
    expect(res.body.pagination.totalPages).toBe(5);
  });

  it('exports CSV when Accept: text/csv is sent', async () => {
    const pool = makeMockPool([sampleRow]);
    const app = buildApp(pool);

    const res = await request(app)
      .get(`/payments/${MERCHANT}`)
      .set('Accept', 'text/csv');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.text).toContain('tx_hash');
    expect(res.text).toContain('abc123def456');
  });

  it('CSV includes all column headers', async () => {
    const pool = makeMockPool([sampleRow]);
    const app = buildApp(pool);

    const res = await request(app)
      .get(`/payments/${MERCHANT}`)
      .set('Accept', 'text/csv');

    const firstLine = res.text.split('\r\n')[0];
    expect(firstLine).toContain('tx_hash');
    expect(firstLine).toContain('event_type');
    expect(firstLine).toContain('subscriber');
    expect(firstLine).toContain('amount');
    expect(firstLine).toContain('occurred_at');
  });

  it('returns 500 when DB throws', async () => {
    const pool = {
      query: jest.fn().mockRejectedValue(new Error('DB error')),
    };
    const app = buildApp(pool);

    const res = await request(app).get(`/payments/${MERCHANT}`);

    expect(res.status).toBe(500);
  });
});
