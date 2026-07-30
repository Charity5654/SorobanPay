import express from 'express';
import request from 'supertest';
import { extendedHealthRouter, HealthState } from '../src/routes/extendedHealth';

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
  });

  describe('GET /health/live (Liveness Probe)', () => {
    it('should return 200 OK as long as the HTTP process is running', async () => {
      const res = await request(app).get('/health/live');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('alive');
    });
  });
});
