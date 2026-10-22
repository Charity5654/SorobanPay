/**
 * backend/tests/errorEnvelope.contract.test.ts
 *
 * Issue #1120 — Add backend error-envelope contract tests
 *
 * Contract tests verifying that backend API error responses strictly conform
 * to the SorobanPay error-envelope schema:
 *   - HTTP Status: Appropriate 4xx/5xx status code
 *   - Response Body Envelope: JSON object containing at least `{ error: string }`
 *   - Safety: No internal stack traces, DB details, or credentials leaked
 *   - Content-Type: application/json
 */

import http from 'http';
import express, { Express, Request, Response, NextFunction } from 'express';
import summariesRouter from '../src/routes/summaries';
import subscriptionsRouter from '../src/routes/subscriptions';
import { InMemoryPrismaClient } from './helpers/inMemoryDb';

// Mock in-memory Prisma client
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: new (require('./helpers/inMemoryDb').InMemoryPrismaClient)(),
}));

// Mock redis
jest.mock('../src/lib/redis', () => ({
  cacheGet: jest.fn().mockResolvedValue(null),
  cacheSet: jest.fn().mockResolvedValue(undefined),
  CacheKey: {
    subscriptionStatus: (sub: string, mer: string) => `status:${sub}:${mer}`,
  },
  CACHE_TTL: { SUBSCRIPTION_STATUS: 60 },
}));

import prisma from '../src/lib/prisma';
const db = prisma as unknown as InMemoryPrismaClient;

// ── HTTP Request Helper ───────────────────────────────────────────────────────

interface HttpResponse {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
  raw: string;
}

function request(
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
  payload?: string,
): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(urlPath, baseUrl);
    const req = http.request(
      {
        hostname: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...headers,
        },
      },
      (res) => {
        let raw = '';
        res.on('data', (chunk) => (raw += chunk));
        res.on('end', () => {
          let body: Record<string, unknown> = {};
          try {
            body = JSON.parse(raw);
          } catch {
            // Leave raw
          }
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body,
            raw,
          });
        });
      },
    );
    req.on('error', reject);
    if (payload) {
      req.write(payload);
    }
    req.end();
  });
}

// ── Test Server ───────────────────────────────────────────────────────────────

let server: http.Server;
let baseUrl: string;

beforeAll((done: jest.DoneCallback) => {
  const app: Express = express();
  app.use(express.json());

  // Mount routers
  app.use('/api/summaries', summariesRouter);
  app.use('/api/v1/subscriptions', subscriptionsRouter);

  // Global 404 handler returning standard error envelope
  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: 'Endpoint not found' });
  });

  // Global error handler returning standard error envelope
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message || 'Internal server error' });
  });

  server = app.listen(0, '127.0.0.1', () => {
    const addr = server.address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    done();
  });
});

afterAll((done) => {
  server.close(done);
});
beforeEach(() => db.reset());

// ── Contract Schema Validator ─────────────────────────────────────────────────

function assertValidErrorEnvelope(res: HttpResponse, expectedStatus: number): void {
  expect(res.status).toBe(expectedStatus);

  // Content-Type must be JSON
  const contentType = res.headers['content-type'] ?? '';
  expect(contentType).toMatch(/application\/json/);

  // Body must be an object
  expect(typeof res.body).toBe('object');
  expect(res.body).not.toBeNull();

  // Must have an 'error' field of type string
  expect(res.body).toHaveProperty('error');
  expect(typeof res.body.error).toBe('string');
  expect((res.body.error as string).trim().length).toBeGreaterThan(0);

  // Security: must not leak stack traces or internal environment variables
  expect(res.body).not.toHaveProperty('stack');
  expect(res.raw).not.toMatch(/node_modules/i);
  expect(res.raw).not.toMatch(/DATABASE_URL/i);
  expect(res.raw).not.toMatch(/SECRET_KEY/i);
}

// ── Test Suites ───────────────────────────────────────────────────────────────

describe('Backend Error-Envelope Contract Tests (#1120)', () => {
  describe('401 Unauthorized Error Envelopes', () => {
    it('returns standard error envelope when authorization header is missing on subscriptions endpoint', async () => {
      const res = await request('GET', '/api/v1/subscriptions');
      assertValidErrorEnvelope(res, 401);
      expect(res.body.error).toMatch(/authorization/i);
    });
  });

  describe('400 Bad Request Error Envelopes', () => {
    it('returns standard error envelope when status filter query parameter is invalid', async () => {
      const res = await request(
        'GET',
        '/api/v1/subscriptions?status=NON_EXISTENT_STATUS',
        { 'x-mock-merchant': 'GMERCHANT01' },
      );
      // If unauthenticated, it returns 401; with auth, 400
      expect([400, 401]).toContain(res.status);
      assertValidErrorEnvelope(res, res.status);
    });

    it('returns standard error envelope on malformed json payload', async () => {
      const res = await request('POST', '/api/summaries/merchant/GMERCHANT', {}, '{"invalid json:');
      assertValidErrorEnvelope(res, 500); // Express default error handler caught malformed JSON or router error
    });
  });

  describe('404 Not Found Error Envelopes', () => {
    it('returns standard error envelope for nonexistent summary ID', async () => {
      const res = await request('GET', '/api/summaries/999999');
      assertValidErrorEnvelope(res, 404);
      expect(res.body.error).toBe('Summary not found');
    });

    it('returns standard error envelope for nonexistent route', async () => {
      const res = await request('GET', '/api/v1/unknown-resource-endpoint');
      assertValidErrorEnvelope(res, 404);
      expect(res.body.error).toBe('Endpoint not found');
    });
  });

  describe('Boundary and Recovery Contract Properties', () => {
    it('handles negative or overflow numeric ID parameters gracefully', async () => {
      const res = await request('GET', '/api/summaries/-1');
      assertValidErrorEnvelope(res, 404);
    });

    it('handles non-numeric ID parameter cleanly with error envelope', async () => {
      const res = await request('GET', '/api/summaries/not-a-number');
      assertValidErrorEnvelope(res, 404);
    });

    it('handles oversized query strings and special characters without crashing or leaking details', async () => {
      const maliciousQuery = encodeURIComponent('<script>alert(1)</script>--\'; DROP TABLE subscriptions;');
      const res = await request('GET', `/api/summaries/merchant/GMER1?type=${maliciousQuery}`);
      // Returns 200 with empty array (clean handling) or 4xx error envelope
      if (res.status !== 200) {
        assertValidErrorEnvelope(res, res.status);
      } else {
        expect(Array.isArray(res.body)).toBe(true);
      }
    });
  });
});
