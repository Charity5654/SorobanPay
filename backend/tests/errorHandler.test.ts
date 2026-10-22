/**
 * backend/tests/errorHandler.test.ts
 *
 * Issue #1074 — Add structured API error codes
 *
 * Tests for errorHandler middleware, notFoundHandler, AppError, and isSafeMessage.
 * Covers: valid serialization, correlation IDs, no internal leakage,
 * authorization failures, retry hints, and idempotency conflicts.
 */
import request from 'supertest';
import express, { Request, Response, NextFunction } from 'express';
import {
  errorHandler,
  notFoundHandler,
  AppError,
  isSafeMessage,
} from '../src/middleware/errorHandler';

// ── Test app factory ──────────────────────────────────────────────────────────

function buildApp(
  routeFn: (req: Request, res: Response, next: NextFunction) => void,
) {
  const app = express();
  app.use(express.json());
  app.get('/test', routeFn);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('errorHandler middleware (#1074)', () => {
  describe('AppError — valid paths', () => {
    it('serializes AppError 400 VALIDATION_ERROR to correct envelope', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(400, 'VALIDATION_ERROR', 'Merchant address is missing'));
      });
      const res = await request(app).get('/test');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_ERROR');
      expect(res.body.error).toBe('Merchant address is missing');
      expect(typeof res.body.correlationId).toBe('string');
      expect(res.body.correlationId.length).toBeGreaterThan(0);
    });

    it('serializes AppError 401 UNAUTHORIZED', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(401, 'UNAUTHORIZED', 'Missing or invalid token'));
      });
      const res = await request(app).get('/test');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body.error).toBe('Missing or invalid token');
    });

    it('serializes AppError 403 FORBIDDEN', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(403, 'FORBIDDEN', 'You do not own this subscription'));
      });
      const res = await request(app).get('/test');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });

    it('serializes AppError 503 DEPENDENCY_UNAVAILABLE', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(503, 'DEPENDENCY_UNAVAILABLE', 'Database is unreachable'));
      });
      const res = await request(app).get('/test');
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('DEPENDENCY_UNAVAILABLE');
    });

    it('includes details for retry hints (RATE_LIMITED)', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(429, 'RATE_LIMITED', 'Too many requests', { retryAfter: 60 }));
      });
      const res = await request(app).get('/test');
      expect(res.status).toBe(429);
      expect(res.body.code).toBe('RATE_LIMITED');
      expect(res.body.details).toEqual({ retryAfter: 60 });
    });

    it('includes details for IDEMPOTENCY_CONFLICT', async () => {
      const app = buildApp((_req, _res, next) => {
        next(
          new AppError(409, 'IDEMPOTENCY_CONFLICT', 'Request already processed', {
            existingRequestId: 'req_abc123',
          }),
        );
      });
      const res = await request(app).get('/test');
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('IDEMPOTENCY_CONFLICT');
      expect(res.body.details).toHaveProperty('existingRequestId', 'req_abc123');
    });

    it('sets details to null when not provided', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(400, 'VALIDATION_ERROR', 'bad input'));
      });
      const res = await request(app).get('/test');
      expect(res.body.details).toBeNull();
    });
  });

  describe('Correlation ID', () => {
    it('uses X-Correlation-ID header when provided', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(400, 'VALIDATION_ERROR', 'bad input'));
      });
      const res = await request(app)
        .get('/test')
        .set('X-Correlation-ID', 'my-trace-123');
      expect(res.body.correlationId).toBe('my-trace-123');
    });

    it('generates a correlationId when header is absent', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(500, 'INTERNAL_ERROR', 'oops'));
      });
      const res = await request(app).get('/test');
      expect(typeof res.body.correlationId).toBe('string');
      expect(res.body.correlationId.length).toBeGreaterThan(0);
    });

    it('two requests without header get different correlationIds', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(500, 'INTERNAL_ERROR', 'oops'));
      });
      const res1 = await request(app).get('/test');
      const res2 = await request(app).get('/test');
      // Generated IDs should differ (timestamp component ensures this)
      expect(res1.body.correlationId).not.toBe(res2.body.correlationId);
    });
  });

  describe('Safety — no internals leaked', () => {
    it('never leaks stack traces for unknown errors', async () => {
      const app = buildApp((_req, _res, next) => {
        const err = new Error('unhandled internal error');
        err.stack = 'Error\n    at node_modules/express/lib/router/index.js:284:7';
        next(err);
      });
      const res = await request(app).get('/test');
      expect(res.body).not.toHaveProperty('stack');
      expect(JSON.stringify(res.body)).not.toMatch(/node_modules/);
      expect(res.body.error).toBe('An internal error occurred');
    });

    it('never leaks DATABASE_URL in response', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new Error('DATABASE_URL=postgresql://user:secret@localhost/db'));
      });
      const res = await request(app).get('/test');
      expect(JSON.stringify(res.body)).not.toMatch(/DATABASE_URL/);
      expect(JSON.stringify(res.body)).not.toMatch(/postgresql/);
    });

    it('returns safe INTERNAL_ERROR for unknown error objects', async () => {
      const app = buildApp((_req, _res, next) => {
        next({ status: 500, message: 'SECRET_KEY is compromised' });
      });
      const res = await request(app).get('/test');
      expect(res.body.error).toBe('An internal error occurred');
      expect(res.body.code).toBe('INTERNAL_ERROR');
    });

    it('response content-type is application/json', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(400, 'VALIDATION_ERROR', 'bad'));
      });
      const res = await request(app).get('/test');
      expect(res.headers['content-type']).toMatch(/application\/json/);
    });
  });

  describe('404 Not Found handler', () => {
    it('returns 404 NOT_FOUND for unmapped routes', async () => {
      const app = express();
      app.use(notFoundHandler);
      const res = await request(app).get('/unknown-path');
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOT_FOUND');
      expect(res.body.error).toMatch(/not found/i);
    });

    it('includes correlationId in 404 response', async () => {
      const app = express();
      app.use(notFoundHandler);
      const res = await request(app).get('/missing');
      expect(typeof res.body.correlationId).toBe('string');
    });
  });

  describe('isSafeMessage utility', () => {
    it('returns false for stack trace patterns', () => {
      expect(isSafeMessage('Error at index.js (line 42)')).toBe(false);
      expect(isSafeMessage('at Object.<anonymous> (server.js:1:1)')).toBe(false);
    });

    it('returns false for node_modules paths', () => {
      expect(isSafeMessage('node_modules/express/lib/router')).toBe(false);
    });

    it('returns false for secret patterns', () => {
      expect(isSafeMessage('DATABASE_URL=...')).toBe(false);
      expect(isSafeMessage('JWT_SECRET is invalid')).toBe(false);
      expect(isSafeMessage('admin PASSWORD required')).toBe(false);
    });

    it('returns true for safe user-facing messages', () => {
      expect(isSafeMessage('Merchant address is missing')).toBe(true);
      expect(isSafeMessage('Invalid subscription interval')).toBe(true);
      expect(isSafeMessage('Subscription not found')).toBe(true);
    });
  });

  describe('Authorization failure paths', () => {
    it('returns structured 401 for missing auth', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(401, 'UNAUTHORIZED', 'Authorization header is missing'));
      });
      const res = await request(app).get('/test');
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
      expect(res.body).toHaveProperty('correlationId');
      expect(res.body).not.toHaveProperty('stack');
    });

    it('returns structured 403 for forbidden access', async () => {
      const app = buildApp((_req, _res, next) => {
        next(new AppError(403, 'FORBIDDEN', 'You do not own this subscription'));
      });
      const res = await request(app).get('/test');
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    });
  });

  describe('Retry paths', () => {
    it('IDEMPOTENCY_CONFLICT response includes existing request reference in details', async () => {
      const app = buildApp((_req, _res, next) => {
        next(
          new AppError(409, 'IDEMPOTENCY_CONFLICT', 'This payment was already processed', {
            existingRequestId: 'req_xyz789',
            processedAt: '2024-01-15T10:00:00Z',
          }),
        );
      });
      const res = await request(app).get('/test');
      expect(res.status).toBe(409);
      expect(res.body.details.existingRequestId).toBe('req_xyz789');
      expect(res.body.details.processedAt).toBeDefined();
    });
  });
});
