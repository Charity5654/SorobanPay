/**
 * Tests for src/routes/retries.ts
 *
 * Uses supertest against a minimal Express app.
 * Prisma and retryQueue are mocked — no DB or Redis required.
 */

import request from 'supertest';
import express from 'express';

// ─── Logger mock (pino is not installed in test environment) ──────────────────
jest.mock('../src/lib/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Prisma mock ──────────────────────────────────────────────────────────────

interface StoredRetry {
  id: number;
  attemptNumber: number;
  scheduledAt: Date;
  executedAt: Date | null;
  status: string;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let mockRetries: StoredRetry[] = [];

const mockPrismaPaymentRetry = {
  findMany: jest.fn(async () => [...mockRetries]),
};

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: { paymentRetry: mockPrismaPaymentRetry },
}));

// ─── RetryQueue mock ──────────────────────────────────────────────────────────

const mockCancelRetries = jest.fn(async () => 0);

jest.mock('../src/services/retryQueue', () => ({
  cancelRetries: mockCancelRetries,
}));

// ─── Route setup ──────────────────────────────────────────────────────────────

import retriesRouter from '../src/routes/retries';

function buildApp() {
  const app = express();
  app.use(express.json());
  // Mount with explicit params to simulate the parent router's mergeParams
  app.use('/api/v1/subscriptions/:subscriber/:merchant/retries', retriesRouter);
  return app;
}

const SUB = 'GSUBSCRIBER1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const MERCHANT = 'GMERCHANT1AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const BASE_URL = `/api/v1/subscriptions/${SUB}/${MERCHANT}/retries`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRetry(overrides: Partial<StoredRetry> = {}): StoredRetry {
  return {
    id: 1,
    attemptNumber: 1,
    scheduledAt: new Date('2026-07-28T00:00:00Z'),
    executedAt: null,
    status: 'PENDING',
    errorMessage: null,
    createdAt: new Date('2026-07-27T00:00:00Z'),
    updatedAt: new Date('2026-07-27T00:00:00Z'),
    ...overrides,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET /api/v1/subscriptions/:subscriber/:merchant/retries', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    mockRetries = [];
    mockPrismaPaymentRetry.findMany.mockClear();
    mockCancelRetries.mockClear();
  });

  it('returns 200 with retry list when records exist', async () => {
    mockRetries = [
      makeRetry({ id: 1, attemptNumber: 1 }),
      makeRetry({ id: 2, attemptNumber: 2, status: 'SUCCEEDED', executedAt: new Date() }),
      makeRetry({ id: 3, attemptNumber: 3, status: 'PENDING' }),
    ];

    const res = await request(app).get(BASE_URL);

    expect(res.status).toBe(200);
    expect(res.body.subscriber).toBe(SUB);
    expect(res.body.merchant).toBe(MERCHANT);
    expect(res.body.retries).toHaveLength(3);
    expect(res.body.retries[0].attemptNumber).toBe(1);
    expect(res.body.retries[1].status).toBe('SUCCEEDED');
  });

  it('returns 404 when no retry records exist', async () => {
    mockRetries = [];

    const res = await request(app).get(BASE_URL);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no retry records/i);
    expect(res.body.subscriber).toBe(SUB);
    expect(res.body.merchant).toBe(MERCHANT);
  });

  it('does not expose jobId or token fields in the response', async () => {
    mockRetries = [makeRetry({ id: 1 })];

    const res = await request(app).get(BASE_URL);

    expect(res.status).toBe(200);
    res.body.retries.forEach((r: Record<string, unknown>) => {
      expect(r).not.toHaveProperty('jobId');
      expect(r).not.toHaveProperty('token');
    });
  });

  it('returns 500 when Prisma throws', async () => {
    mockPrismaPaymentRetry.findMany.mockRejectedValueOnce(new Error('db error'));

    const res = await request(app).get(BASE_URL);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to fetch/i);
  });
});

describe('DELETE /api/v1/subscriptions/:subscriber/:merchant/retries', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    app = buildApp();
    mockRetries = [];
    mockPrismaPaymentRetry.findMany.mockClear();
    mockCancelRetries.mockClear();
  });

  it('returns 200 with cancelled count when pending retries exist', async () => {
    mockCancelRetries.mockResolvedValueOnce(3);

    const res = await request(app).delete(BASE_URL);

    expect(res.status).toBe(200);
    expect(res.body.subscriber).toBe(SUB);
    expect(res.body.merchant).toBe(MERCHANT);
    expect(res.body.cancelled).toBe(3);
    expect(mockCancelRetries).toHaveBeenCalledWith(SUB, MERCHANT);
  });

  it('returns 404 when no pending retries exist (cancelRetries returns 0)', async () => {
    mockCancelRetries.mockResolvedValueOnce(0);

    const res = await request(app).delete(BASE_URL);

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no pending retry jobs/i);
    expect(res.body.subscriber).toBe(SUB);
    expect(res.body.merchant).toBe(MERCHANT);
  });

  it('passes correct subscriber and merchant to cancelRetries', async () => {
    mockCancelRetries.mockResolvedValueOnce(1);

    await request(app).delete(BASE_URL);

    expect(mockCancelRetries).toHaveBeenCalledTimes(1);
    const firstCall = (mockCancelRetries.mock.calls[0] as unknown) as [string, string];
    const [calledSub, calledMerchant] = firstCall;
    expect(calledSub).toBe(SUB);
    expect(calledMerchant).toBe(MERCHANT);
  });

  it('returns 500 when cancelRetries throws', async () => {
    mockCancelRetries.mockRejectedValueOnce(new Error('redis unavailable'));

    const res = await request(app).delete(BASE_URL);

    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/failed to cancel/i);
  });
});
