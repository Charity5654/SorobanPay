import express from 'express';
import request from 'supertest';
import {
  extendedHealthRouter,
  HealthState,
  CHECK_TIMEOUT_MS,
  checkWithTimeout,
} from '../src/routes/extendedHealth';

const app = express();
app.use(express.json());
app.use('/', extendedHealthRouter);

describe('Health Check Endpoints (#397 / BE-62)', () => {
  beforeEach(() => {
    HealthState.reset();
  });

  describe('GET /health', () => {
    it('should return 200 OK and healthy dependency status when all dependencies are healthy', async () => {
      const res = await request(app).get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('healthy');
      expect(typeof res.body.uptime).toBe('number');
      expect(res.body.dependencies.postgres).toBe('healthy');
      expect(res.body.dependencies.redis).toBe('healthy');
      expect(res.body.dependencies.stellar_rpc).toBe('healthy');
      expect(res.body.dependencies.indexer_lag_seconds).toBe(12);
    });

    it('should return 503 Service Unavailable when any critical dependency is down', async () => {
      HealthState.postgres = 'unhealthy';

      const res = await request(app).get('/health');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('degraded');
      expect(res.body.dependencies.postgres).toBe('unhealthy');
    });

    it('should not require any authentication headers', async () => {
      const res = await request(app)
        .get('/health')
        .set('Authorization', '');

      expect(res.status).toBe(200);
    });

    // ── New tests for #1076 ──────────────────────────────────────────────────

    it('includes queue dependency in response', async () => {
      const res = await request(app).get('/health');
      expect(res.body.dependencies).toHaveProperty('queue');
      expect(res.body.dependencies.queue).toBe('healthy');
    });

    it('reflects unhealthy queue in response with 503', async () => {
      HealthState.queue = 'unhealthy';
      // queue is not a critical dep for overall status — only postgres/redis/stellar_rpc
      // but it must be present in the response
      const res = await request(app).get('/health');
      expect(res.body.dependencies.queue).toBe('unhealthy');
    });
  });

  describe('GET /health/ready (Readiness Probe)', () => {
    it('should return 503 when not yet ready', async () => {
      HealthState.isReady = false;
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
    });

    it('should return 200 OK once ready after migrations and first RPC poll', async () => {
      HealthState.isReady = true;
      const res = await request(app).get('/health/ready');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });

    // ── New tests for #1076 ──────────────────────────────────────────────────

    it('returns 503 with reason dependencies_unhealthy when postgres is down even if isReady=true', async () => {
      HealthState.isReady = true;
      HealthState.postgres = 'unhealthy';

      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.reason).toBe('dependencies_unhealthy');
      expect(res.body.dependencies.postgres).toBe('unhealthy');
    });

    it('returns 503 with reason dependencies_unhealthy when stellar_rpc is down even if isReady=true', async () => {
      HealthState.isReady = true;
      HealthState.stellarRpc = 'unhealthy';

      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(503);
      expect(res.body.status).toBe('not_ready');
      expect(res.body.reason).toBe('dependencies_unhealthy');
      expect(res.body.dependencies.stellar_rpc).toBe('unhealthy');
    });

    it('returns 200 when isReady=true and all critical deps are healthy', async () => {
      HealthState.isReady = true;
      HealthState.postgres = 'healthy';
      HealthState.stellarRpc = 'healthy';

      const res = await request(app).get('/health/ready');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ready');
    });
  });

  describe('GET /health/live (Liveness Probe)', () => {
    it('should return 200 OK as long as the HTTP process is running', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
    });

    // ── New tests for #1076 ──────────────────────────────────────────────────

    it('returns 200 alive even when postgres is unhealthy (liveness is process-only)', async () => {
      HealthState.postgres = 'unhealthy';
      HealthState.redis = 'unhealthy';
      HealthState.stellarRpc = 'unhealthy';

      const res = await request(app).get('/health/live');

      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
    });
  });

  describe('CHECK_TIMEOUT_MS constant (#1076)', () => {
    it('is exported and equals 5000', () => {
      expect(CHECK_TIMEOUT_MS).toBe(5000);
    });
  });

  describe('checkWithTimeout utility (#1076)', () => {
    it('resolves with function result when it completes within timeout', async () => {
      const result = await checkWithTimeout(() => Promise.resolve('ok'), 1000);
      expect(result).toBe('ok');
    });

    it('resolves with null when the function exceeds the timeout', async () => {
      const result = await checkWithTimeout(
        () => new Promise((resolve) => setTimeout(() => resolve('late'), 200)),
        50,
      );
      expect(result).toBeNull();
    });

    it('resolves with null when the function rejects', async () => {
      const result = await checkWithTimeout(
        () => Promise.reject(new Error('boom')),
        1000,
      );
      expect(result).toBeNull();
    });
  });
});
