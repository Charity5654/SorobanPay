/**
 * subscriptionRoute.validation.test.ts — #1059
 *
 * Validates that subscription routes reject unknown query fields and invalid
 * inputs before reaching service calls, and return stable error shapes.
 *
 * Prisma, Redis, subscriptionStateService, and retryQueue are all mocked
 * so no real DB or Redis server is needed.
 */

import request from 'supertest';
import express from 'express';

// ─── Prisma mock ──────────────────────────────────────────────────────────────

const mockPrisma = {
  subscription: {
    findMany: jest.fn().mockResolvedValue([]),
    count: jest.fn().mockResolvedValue(0),
  },
  event: {
    findMany: jest.fn().mockResolvedValue([]),
    findFirst: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(0),
  },
  $transaction: jest.fn().mockImplementation(async (ops: unknown[]) => {
    return Promise.all(ops);
  }),
};

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: mockPrisma,
}));

// ─── Redis mock ───────────────────────────────────────────────────────────────

jest.mock('../src/lib/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  CacheKey: {
    merchantSubscriptions: (addr: string) => `subscriptions:merchant:${addr}`,
  },
  CACHE_TTL: { subscriptions: 60 },
}));

// ─── subscriptionStateService mock ───────────────────────────────────────────

jest.mock('../src/services/subscriptionStateService', () => ({
  getSubscriptionStatus: jest.fn().mockResolvedValue('ACTIVE'),
}));

// ─── retryQueue mock ──────────────────────────────────────────────────────────

jest.mock('../src/services/retryQueue', () => ({
  getRawRetries: jest.fn().mockResolvedValue([]),
  cancelRetries: jest.fn().mockResolvedValue(undefined),
}));

// ─── App setup ────────────────────────────────────────────────────────────────

import subscriptionsRouter from '../src/routes/subscriptions';

function buildApp(merchantAddress?: string) {
  const app = express();
  app.use(express.json());
  // Simulate requireMerchant setting res.locals.merchantAddress
  app.use((req, res, next) => {
    if (merchantAddress) {
      res.locals.merchantAddress = merchantAddress;
    }
    next();
  });
  app.use('/v1/subscriptions', subscriptionsRouter);
  return app;
}

const MERCHANT = 'GXYZ1234MERCHANTADDRESS567890ABCDEF';
const app = buildApp(MERCHANT);
const unauthApp = buildApp(); // no merchantAddress set

// ─── GET / — list subscriptions ───────────────────────────────────────────────

describe('GET /v1/subscriptions/', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with default pagination', async () => {
    const res = await request(app).get('/v1/subscriptions/');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('page');
  });

  it('returns 200 with valid page and limit params', async () => {
    const res = await request(app).get('/v1/subscriptions/?page=2&limit=10');
    expect(res.status).toBe(200);
  });

  it('returns 200 with valid status filter', async () => {
    const res = await request(app).get('/v1/subscriptions/?status=ACTIVE');
    expect(res.status).toBe(200);
  });

  it('returns 400 for invalid status value', async () => {
    const res = await request(app).get('/v1/subscriptions/?status=INVALID');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body).toHaveProperty('details');
  });

  it('returns 400 for unknown query field (strict mode)', async () => {
    const res = await request(app).get('/v1/subscriptions/?unknownField=xyz');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid query parameters');
    expect(res.body.details).toBeInstanceOf(Array);
  });

  it('returns 400 for non-numeric page', async () => {
    const res = await request(app).get('/v1/subscriptions/?page=abc');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });

  it('returns 400 for limit exceeding max (100)', async () => {
    const res = await request(app).get('/v1/subscriptions/?limit=999');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });

  it('returns 401 when merchant address is not set', async () => {
    const res = await request(unauthApp).get('/v1/subscriptions/');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });
});

// ─── GET /payments — payment history ─────────────────────────────────────────

describe('GET /v1/subscriptions/payments', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with required merchant param', async () => {
    const res = await request(app).get('/v1/subscriptions/payments?merchant=GABC123');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body).toHaveProperty('meta');
  });

  it('returns 400 when merchant param is missing', async () => {
    const res = await request(app).get('/v1/subscriptions/payments');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid query parameters');
    expect(res.body.details.some((d: { field: string }) => d.field === 'merchant')).toBe(true);
  });

  it('returns 400 for invalid from date', async () => {
    const res = await request(app).get('/v1/subscriptions/payments?merchant=GABC&from=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });

  it('returns 400 for invalid to date', async () => {
    const res = await request(app).get('/v1/subscriptions/payments?merchant=GABC&to=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });

  it('returns 200 with valid from/to date range', async () => {
    const res = await request(app).get(
      '/v1/subscriptions/payments?merchant=GABC&from=2024-01-01&to=2024-12-31',
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 for unknown query field (strict mode)', async () => {
    const res = await request(app).get('/v1/subscriptions/payments?merchant=GABC&extra=oops');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid query parameters');
  });

  it('returns 400 for limit exceeding max (200)', async () => {
    const res = await request(app).get('/v1/subscriptions/payments?merchant=GABC&limit=999');
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });
});

// ─── GET /merchant/:merchantAddress ──────────────────────────────────────────

describe('GET /v1/subscriptions/merchant/:merchantAddress', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with no query params', async () => {
    const res = await request(app).get(`/v1/subscriptions/merchant/${MERCHANT}`);
    expect(res.status).toBe(200);
  });

  it('returns 200 with valid token filter', async () => {
    const res = await request(app).get(
      `/v1/subscriptions/merchant/${MERCHANT}?token=CABC123TOKEN`,
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 for unknown query field (strict mode)', async () => {
    const res = await request(app).get(`/v1/subscriptions/merchant/${MERCHANT}?unknownParam=x`);
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid query parameters');
  });
});

// ─── GET /merchant/:merchantAddress/payments ──────────────────────────────────

describe('GET /v1/subscriptions/merchant/:merchantAddress/payments', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 200 with default pagination', async () => {
    const res = await request(app).get(`/v1/subscriptions/merchant/${MERCHANT}/payments`);
    expect(res.status).toBe(200);
  });

  it('returns 200 with valid limit and offset', async () => {
    const res = await request(app).get(
      `/v1/subscriptions/merchant/${MERCHANT}/payments?limit=10&offset=5`,
    );
    expect(res.status).toBe(200);
  });

  it('returns 400 for unknown query field (strict mode)', async () => {
    const res = await request(app).get(
      `/v1/subscriptions/merchant/${MERCHANT}/payments?unexpectedKey=1`,
    );
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Invalid query parameters');
  });

  it('returns 400 for non-numeric limit', async () => {
    const res = await request(app).get(
      `/v1/subscriptions/merchant/${MERCHANT}/payments?limit=abc`,
    );
    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('details');
  });
});

// ─── GET /:subscriber/:merchant — single subscription ────────────────────────

describe('GET /v1/subscriptions/:subscriber/:merchant', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns 404 when subscription not found', async () => {
    (mockPrisma.event.findFirst as jest.Mock).mockResolvedValue(null);
    const res = await request(app).get('/v1/subscriptions/GSUB123/GMERCH456');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error', 'Subscription not found');
  });

  it('returns 200 when subscription exists', async () => {
    (mockPrisma.event.findFirst as jest.Mock).mockResolvedValue({
      subscriber: 'GSUB123',
      merchant: 'GMERCH456',
      token: 'CTOKEN789',
      amount: '100',
      ledgerTimestamp: BigInt(1700000000),
    });
    const res = await request(app).get('/v1/subscriptions/GSUB123/GMERCH456');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('subscriber', 'GSUB123');
    expect(res.body).toHaveProperty('status', 'ACTIVE');
  });
});

// ─── Error shape contract ─────────────────────────────────────────────────────

describe('Error shape contract', () => {
  it('validation errors include both error string and details array', async () => {
    const res = await request(app).get('/v1/subscriptions/?status=INVALID');
    expect(res.status).toBe(400);
    expect(typeof res.body.error).toBe('string');
    expect(Array.isArray(res.body.details)).toBe(true);
    expect(res.body.details[0]).toHaveProperty('field');
    expect(res.body.details[0]).toHaveProperty('message');
  });

  it('unknown fields produce error with details listing the unrecognized key', async () => {
    const res = await request(app).get('/v1/subscriptions/?injectedField=evil');
    expect(res.status).toBe(400);
    const fields = res.body.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('injectedField');
  });
});
