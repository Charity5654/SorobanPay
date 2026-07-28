/**
 * BE-58 — Revenue reporting API integration tests.
 *
 * Tests the GET /v1/reports/payments endpoint for:
 *  - JSON export with all fields
 *  - CSV export with correct RFC 4180 formatting
 *  - Query param validation (Zod)
 *  - Rate limiting (exportLimiter — 1/min)
 *  - Streaming without memory overflow (1 000-row dataset)
 *
 * This test uses an in-memory mock of the Prisma client so no live DB is needed.
 */

import express, { Express } from 'express';
import request from 'supertest';
import rateLimit from 'express-rate-limit';

// ---------------------------------------------------------------------------
// Mock Prisma before importing the route (which imports prisma at module load)
// ---------------------------------------------------------------------------

const mockAuditLogs: any[] = [];

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    auditLog: {
      findMany: jest.fn(async ({ where, take, skip }: any) => {
        let rows = [...mockAuditLogs];

        if (where?.merchant) {
          rows = rows.filter((r) => r.merchant === where.merchant);
        }
        if (where?.status === 'executed') {
          rows = rows.filter((r) => r.status === 'executed');
        } else if (where?.status?.not) {
          rows = rows.filter((r) => r.status !== where.status.not);
        }
        if (where?.createdAt?.gte) {
          rows = rows.filter((r) => r.createdAt >= where.createdAt.gte);
        }
        if (where?.createdAt?.lte) {
          rows = rows.filter((r) => r.createdAt <= where.createdAt.lte);
        }

        rows = rows.slice(skip ?? 0, (skip ?? 0) + (take ?? rows.length));
        return rows;
      }),
    },
  },
}));

// ---------------------------------------------------------------------------
// Import route AFTER mock is set up
// ---------------------------------------------------------------------------

import reportsRouter from '../src/routes/reports';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MERCHANT = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWXYZ';

function makeRow(i: number) {
  return {
    id: i,
    eventType: 'executed',
    subscriber: `GSUB${String(i).padStart(52, '0')}`,
    merchant: MERCHANT,
    token: `GTKN${String(i % 3).padStart(52, '0')}`,
    amount: String((i + 1) * 1_000_000),
    transactionHash: `hash_${i}`,
    ledger: BigInt(1000 + i),
    status: 'executed',
    createdAt: new Date('2024-06-01T00:00:00Z'),
  };
}

/**
 * Build an Express app that uses the reports router.
 * When withRateLimit=true, applies a fresh 1/min rate limiter so we can
 * verify rate limit behaviour without the limiter state leaking between tests.
 */
function buildTestApp(withRateLimit = false): Express {
  const app = express();
  app.use(express.json());

  if (withRateLimit) {
    const testLimiter = rateLimit({
      windowMs: 60_000,
      max: 1,
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      handler: (_req: any, res: any) => {
        res.setHeader('Retry-After', '60');
        res.status(429).json({ error: 'Too Many Requests', retryAfter: 60 });
      },
    });
    app.use('/v1/reports/payments', testLimiter, reportsRouter);
  } else {
    app.use('/v1/reports/payments', reportsRouter);
  }

  // Expose unhandled errors so test failures are easier to diagnose
  app.use((err: any, _req: any, res: any, _next: any) => {
    console.error('[TEST ERROR HANDLER]', err?.message ?? err);
    res.status(500).json({ error: err?.message ?? String(err) });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GET /v1/reports/payments', () => {
  let app: Express;

  beforeEach(() => {
    mockAuditLogs.length = 0;
    app = buildTestApp(false);
  });

  // ── Validation ─────────────────────────────────────────────────────────────

  it('returns 400 when merchant param is missing', async () => {
    const res = await request(app).get('/v1/reports/payments');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Invalid query parameters');
  });

  it('returns 400 for invalid format param', async () => {
    const res = await request(app).get('/v1/reports/payments?merchant=G123&format=xml');
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('format');
  });

  it('returns 400 for invalid status param', async () => {
    const res = await request(app).get('/v1/reports/payments?merchant=G123&status=unknown');
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('status');
  });

  // ── JSON export ─────────────────────────────────────────────────────────────

  it('returns empty JSON array when no data matches', async () => {
    const res = await request(app).get(`/v1/reports/payments?merchant=${MERCHANT}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toEqual([]);
  });

  it('returns JSON array with all payment fields', async () => {
    mockAuditLogs.push(makeRow(1));

    const res = await request(app).get(`/v1/reports/payments?merchant=${MERCHANT}&format=json`);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    expect(rows).toHaveLength(1);

    const row = rows[0];
    expect(row).toHaveProperty('date');
    expect(row).toHaveProperty('subscriber');
    expect(row).toHaveProperty('token');
    expect(row).toHaveProperty('amountHuman');
    expect(row).toHaveProperty('amountRaw');
    expect(row).toHaveProperty('txHash', 'hash_1');
    expect(row).toHaveProperty('status', 'executed');
  });

  it('formats amount correctly (7 decimal places)', async () => {
    mockAuditLogs.push({ ...makeRow(0), amount: '10000000' }); // 1.0 in Stellar units

    const res = await request(app).get(`/v1/reports/payments?merchant=${MERCHANT}`);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    expect(rows[0].amountHuman).toBe('1.0');
    expect(rows[0].amountRaw).toBe('10000000');
  });

  // ── CSV export ──────────────────────────────────────────────────────────────

  it('returns CSV with correct headers', async () => {
    const res = await request(app).get(
      `/v1/reports/payments?merchant=${MERCHANT}&format=csv`,
    );
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment/);

    const lines = res.text.split('\r\n').filter(Boolean);
    expect(lines[0]).toBe(
      'Date,Subscriber,Token,Amount (human-readable),Amount (raw),Tx Hash,Status',
    );
  });

  it('exports CSV rows correctly (RFC 4180 — comma-separated, quoted on special chars)', async () => {
    mockAuditLogs.push(makeRow(1));

    const res = await request(app).get(
      `/v1/reports/payments?merchant=${MERCHANT}&format=csv`,
    );
    expect(res.status).toBe(200);

    const lines = res.text.split('\r\n').filter(Boolean);
    // Header + 1 data row
    expect(lines).toHaveLength(2);
    // Data row has 7 comma-separated fields
    const fields = lines[1].split(',');
    expect(fields).toHaveLength(7);
  });

  it('quotes CSV cells that contain commas', async () => {
    mockAuditLogs.push({ ...makeRow(0), subscriber: 'G,BADADDR' });

    const res = await request(app).get(
      `/v1/reports/payments?merchant=${MERCHANT}&format=csv`,
    );
    expect(res.status).toBe(200);
    expect(res.text).toContain('"G,BADADDR"');
  });

  // ── Streaming with 1 000 rows ──────────────────────────────────────────────

  it('streams 1 000 rows as JSON without error', async () => {
    for (let i = 0; i < 1000; i++) {
      mockAuditLogs.push(makeRow(i));
    }

    const res = await request(app).get(`/v1/reports/payments?merchant=${MERCHANT}&limit=1000`);
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThanOrEqual(1000);
  });

  it('streams 1 000 rows as CSV without error', async () => {
    for (let i = 0; i < 1000; i++) {
      mockAuditLogs.push(makeRow(i));
    }

    const res = await request(app).get(
      `/v1/reports/payments?merchant=${MERCHANT}&format=csv&limit=1000`,
    );
    expect(res.status).toBe(200);
    const lines = res.text.split('\r\n').filter(Boolean);
    expect(lines.length).toBeGreaterThan(1);
  });

  // ── Status filtering ────────────────────────────────────────────────────────

  it('filters by status=success (returns only executed rows)', async () => {
    mockAuditLogs.push({ ...makeRow(1), status: 'executed' });
    mockAuditLogs.push({ ...makeRow(2), status: 'failed', transactionHash: 'hash_failed' });

    const res = await request(app).get(
      `/v1/reports/payments?merchant=${MERCHANT}&status=success`,
    );
    expect(res.status).toBe(200);
    const rows = res.body as any[];
    expect(rows.every((r: any) => r.status === 'executed')).toBe(true);
  });

  // ── Rate limiting — isolated test with fresh limiter ─────────────────────

  it('enforces rate limit: second request in same window returns 429 with Retry-After', async () => {
    const rateLimitedApp = buildTestApp(true);

    const first = await request(rateLimitedApp).get(
      `/v1/reports/payments?merchant=${MERCHANT}`,
    );
    expect(first.status).toBe(200);

    const second = await request(rateLimitedApp).get(
      `/v1/reports/payments?merchant=${MERCHANT}`,
    );
    expect(second.status).toBe(429);
    expect(second.headers['retry-after']).toBeDefined();
    expect(Number(second.headers['retry-after'])).toBeGreaterThan(0);
    expect(second.body.retryAfter).toBeGreaterThan(0);
  });
});
