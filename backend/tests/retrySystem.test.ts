/**
 * retrySystem.test.ts
 *
 * Unit tests for the payment retry system:
 *   - RetryQueue (enqueue, cancelAll, processDueJobs, getRetries)
 *   - RetryScheduler (scheduleRetries, handleJob, onJobFailed, webhook)
 *   - GET /:subscriber/:merchant/retries route
 *   - DELETE /:subscriber/:merchant/retries route
 */

// ─── Mock prisma before any service imports ───────────────────────────────────

interface StoredRetry {
  id: number;
  subscriber: string;
  merchant: string;
  amount: string;
  token: string;
  attemptNumber: number;
  status: string;
  scheduledAt: Date;
  executedAt: Date | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredRetryConfig {
  id: number;
  merchant: string;
  intervalsDays: string;
  webhookUrl: string | null;
  createdAt: Date;
  updatedAt: Date;
}

interface StoredWebhookEndpoint {
  id: number;
  merchant: string;
  url: string;
  active: boolean;
  createdAt: Date;
}

interface StoredWebhookDelivery {
  id: number;
  url: string;
  merchant: string;
  event: string;
  payload: string;
  statusCode: number;
  attempt: number;
  success: boolean;
  error?: string | null;
  createdAt: Date;
}

class MockPrismaClient {
  retries: StoredRetry[] = [];
  retryConfigs: StoredRetryConfig[] = [];
  webhookEndpoints: StoredWebhookEndpoint[] = [];
  webhookDeliveries: StoredWebhookDelivery[] = [];
  private nextId = 1;

  paymentRetry = {
    findFirst: async (args: any) => {
      return this.retries.find((r) => this._matchRetry(r, args.where)) ?? null;
    },
    findMany: async (args?: any) => {
      let results = [...this.retries];
      if (args?.where) results = results.filter((r) => this._matchRetry(r, args.where));
      if (args?.orderBy?.scheduledAt === 'asc') {
        results.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());
      }
      return results;
    },
    create: async (args: any) => {
      const now = new Date();
      const record: StoredRetry = {
        id: this.nextId++,
        ...args.data,
        executedAt: args.data.executedAt ?? null,
        error: args.data.error ?? null,
        createdAt: now,
        updatedAt: now,
      };
      this.retries.push(record);
      return record;
    },
    update: async (args: any) => {
      const idx = this.retries.findIndex((r) => r.id === args.where.id);
      if (idx === -1) throw new Error(`PaymentRetry ${args.where.id} not found`);
      this.retries[idx] = { ...this.retries[idx], ...args.data, updatedAt: new Date() };
      return this.retries[idx];
    },
    updateMany: async (args: any) => {
      let count = 0;
      for (let i = 0; i < this.retries.length; i++) {
        if (this._matchRetry(this.retries[i], args.where)) {
          this.retries[i] = { ...this.retries[i], ...args.data, updatedAt: new Date() };
          count++;
        }
      }
      return { count };
    },
    count: async (args: any) => {
      return this.retries.filter((r) => this._matchRetry(r, args.where)).length;
    },
  };

  retryConfig = {
    findUnique: async (args: any) => {
      return this.retryConfigs.find((c) => c.merchant === args.where.merchant) ?? null;
    },
  };

  webhookEndpoint = {
    findFirst: async (args: any) => {
      return (
        this.webhookEndpoints.find(
          (e) => e.merchant === args.where.merchant && e.active === args.where.active,
        ) ?? null
      );
    },
  };

  webhookDelivery = {
    create: async (args: any) => {
      const record: StoredWebhookDelivery = {
        id: this.nextId++,
        ...args.data,
        createdAt: new Date(),
      };
      this.webhookDeliveries.push(record);
      return record;
    },
  };

  /** Match a retry record against a Prisma-style where clause. */
  _matchRetry(r: StoredRetry, where: any): boolean {
    if (!where) return true;
    for (const [key, val] of Object.entries(where)) {
      if (val === undefined) continue;
      if (key === 'status') {
        const statusCond = val as any;
        if (statusCond.in) {
          if (!statusCond.in.includes(r.status)) return false;
        } else {
          if (r.status !== val) return false;
        }
      } else if (key === 'scheduledAt') {
        const cond = val as any;
        if (cond.lte && r.scheduledAt > cond.lte) return false;
        if (cond.gte && r.scheduledAt < cond.gte) return false;
      } else {
        if ((r as any)[key] !== val) return false;
      }
    }
    return true;
  }

  reset() {
    this.retries = [];
    this.retryConfigs = [];
    this.webhookEndpoints = [];
    this.webhookDeliveries = [];
    this.nextId = 1;
  }
}

const mockPrisma = new MockPrismaClient();

jest.mock('../src/lib/prisma', () => ({ __esModule: true, default: mockPrisma }));
jest.mock('../src/lib/logger', () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ─── Imports (after mocks are registered) ─────────────────────────────────────

import { RetryQueue } from '../src/services/retryQueue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const SUB = 'GSUB1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const MER = 'GMER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
const AMT = '1000000';
const TOK = 'CTOKEN1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';

function daysFromNow(days: number): Date {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

// ─── RetryQueue ───────────────────────────────────────────────────────────────

describe('RetryQueue', () => {
  let queue: RetryQueue;

  beforeEach(() => {
    mockPrisma.reset();
    queue = new RetryQueue();
  });

  // ── enqueue ────────────────────────────────────────────────────────────────

  describe('enqueue', () => {
    it('creates a new pending job and returns it', async () => {
      const scheduledAt = daysFromNow(1);
      const job = await queue.enqueue(SUB, MER, AMT, TOK, 1, scheduledAt);

      expect(job.id).toBeDefined();
      expect(job.subscriber).toBe(SUB);
      expect(job.merchant).toBe(MER);
      expect(job.attemptNumber).toBe(1);
      expect(job.status).toBe('pending');
      expect(job.scheduledAt).toEqual(scheduledAt);
      expect(mockPrisma.retries).toHaveLength(1);
    });

    it('is idempotent: returns existing job when called twice with the same args', async () => {
      const scheduledAt = daysFromNow(1);
      const job1 = await queue.enqueue(SUB, MER, AMT, TOK, 1, scheduledAt);
      const job2 = await queue.enqueue(SUB, MER, AMT, TOK, 1, scheduledAt);

      expect(job1.id).toBe(job2.id);
      expect(mockPrisma.retries).toHaveLength(1);
    });

    it('allows multiple attempts for the same pair', async () => {
      await queue.enqueue(SUB, MER, AMT, TOK, 1, daysFromNow(1));
      await queue.enqueue(SUB, MER, AMT, TOK, 2, daysFromNow(3));
      await queue.enqueue(SUB, MER, AMT, TOK, 3, daysFromNow(7));

      expect(mockPrisma.retries).toHaveLength(3);
    });
  });

  // ── cancelAll ─────────────────────────────────────────────────────────────

  describe('cancelAll', () => {
    it('cancels all pending jobs for the pair', async () => {
      await queue.enqueue(SUB, MER, AMT, TOK, 1, daysFromNow(1));
      await queue.enqueue(SUB, MER, AMT, TOK, 2, daysFromNow(3));

      const count = await queue.cancelAll(SUB, MER);

      expect(count).toBe(2);
      expect(mockPrisma.retries.every((r) => r.status === 'cancelled')).toBe(true);
    });

    it('returns 0 when no pending jobs exist', async () => {
      const count = await queue.cancelAll(SUB, MER);
      expect(count).toBe(0);
    });

    it('does not cancel already-succeeded jobs', async () => {
      await queue.enqueue(SUB, MER, AMT, TOK, 1, daysFromNow(1));
      mockPrisma.retries[0].status = 'succeeded';

      const count = await queue.cancelAll(SUB, MER);

      expect(count).toBe(0);
      expect(mockPrisma.retries[0].status).toBe('succeeded');
    });
  });

  // ── getRetries ────────────────────────────────────────────────────────────

  describe('getRetries', () => {
    it('returns all retry rows for the pair ordered by scheduledAt asc', async () => {
      await queue.enqueue(SUB, MER, AMT, TOK, 2, daysFromNow(3));
      await queue.enqueue(SUB, MER, AMT, TOK, 1, daysFromNow(1));

      const retries = await queue.getRetries(SUB, MER);

      expect(retries).toHaveLength(2);
      expect(retries[0].attemptNumber).toBe(1);
      expect(retries[1].attemptNumber).toBe(2);
    });

    it('returns empty array when no retries exist', async () => {
      const retries = await queue.getRetries(SUB, MER);
      expect(retries).toEqual([]);
    });
  });

  // ── processDueJobs ────────────────────────────────────────────────────────

  describe('processDueJobs', () => {
    it('does nothing when no handler is registered', async () => {
      await queue.enqueue(SUB, MER, AMT, TOK, 1, daysAgo(1));
      // No handler registered; should not throw
      await expect(queue.processDueJobs()).resolves.toBeUndefined();
      // Job status unchanged
      expect(mockPrisma.retries[0].status).toBe('pending');
    });

    it('skips jobs scheduled in the future', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      queue.registerHandler(handler);

      await queue.enqueue(SUB, MER, AMT, TOK, 1, daysFromNow(1));
      await queue.processDueJobs();

      expect(handler).not.toHaveBeenCalled();
      expect(mockPrisma.retries[0].status).toBe('pending');
    });

    it('executes due jobs and marks them succeeded', async () => {
      const handler = jest.fn().mockResolvedValue(undefined);
      queue.registerHandler(handler);

      await queue.enqueue(SUB, MER, AMT, TOK, 1, daysAgo(1));
      await queue.processDueJobs();

      expect(handler).toHaveBeenCalledTimes(1);
      expect(mockPrisma.retries[0].status).toBe('succeeded');
    });

    it('marks job as failed and stores error when handler throws', async () => {
      const handler = jest.fn().mockRejectedValue(new Error('on-chain failure'));
      queue.registerHandler(handler);

      await queue.enqueue(SUB, MER, AMT, TOK, 1, daysAgo(1));
      await queue.processDueJobs();

      expect(mockPrisma.retries[0].status).toBe('failed');
      expect(mockPrisma.retries[0].error).toBe('on-chain failure');
    });

    it('processes multiple due jobs in scheduledAt order', async () => {
      const order: number[] = [];
      const handler = jest.fn().mockImplementation(async (job: any) => {
        order.push(job.attemptNumber);
      });
      queue.registerHandler(handler);

      await queue.enqueue(SUB, MER, AMT, TOK, 2, daysAgo(1));
      await queue.enqueue(SUB, MER, AMT, TOK, 1, daysAgo(2));
      await queue.processDueJobs();

      expect(order).toEqual([1, 2]);
    });
  });
});

// ─── RetryScheduler ───────────────────────────────────────────────────────────

import { RetryScheduler } from '../src/services/retryScheduler';

describe('RetryScheduler', () => {
  let executePaymentFn: jest.Mock;
  let scheduler: RetryScheduler;
  let queue: RetryQueue;

  beforeEach(() => {
    mockPrisma.reset();
    delete process.env.RETRY_INTERVALS_DAYS;
    delete process.env.RETRY_WEBHOOK_URL_FALLBACK;
    executePaymentFn = jest.fn().mockResolvedValue('mock-tx-hash');
    // Each test needs a fresh queue so the handler binding is fresh
    queue = new RetryQueue();
    scheduler = new RetryScheduler(executePaymentFn);
    // Point the scheduler's internal retryQueue at our local queue instance
    // by registering the scheduler's handler onto our local queue
    queue.registerHandler((scheduler as any).handleJob.bind(scheduler));
  });

  // ── scheduleRetries ───────────────────────────────────────────────────────

  describe('scheduleRetries', () => {
    it('creates 3 jobs with default intervals when no config exists', async () => {
      await scheduler.scheduleRetries(SUB, MER, AMT, TOK);

      // Check jobs were created in the DB
      const jobs = mockPrisma.retries;
      expect(jobs).toHaveLength(3);
      expect(jobs.map((j) => j.attemptNumber).sort()).toEqual([1, 2, 3]);
      expect(jobs.every((j) => j.status === 'pending')).toBe(true);
    });

    it('uses RETRY_INTERVALS_DAYS env var when set', async () => {
      process.env.RETRY_INTERVALS_DAYS = '2,5';

      await scheduler.scheduleRetries(SUB, MER, AMT, TOK);

      expect(mockPrisma.retries).toHaveLength(2);
      expect(mockPrisma.retries.map((j) => j.attemptNumber)).toEqual([1, 2]);
    });

    it('uses per-merchant DB config over env var', async () => {
      process.env.RETRY_INTERVALS_DAYS = '2,5,10';
      mockPrisma.retryConfigs.push({
        id: 1,
        merchant: MER,
        intervalsDays: '1,4',
        webhookUrl: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await scheduler.scheduleRetries(SUB, MER, AMT, TOK);

      expect(mockPrisma.retries).toHaveLength(2);
    });

    it('schedules jobs at correct offsets from now', async () => {
      const before = Date.now();
      await scheduler.scheduleRetries(SUB, MER, AMT, TOK);
      const after = Date.now();

      const dayMs = 24 * 60 * 60 * 1000;
      const [j1, j2, j3] = mockPrisma.retries.sort((a, b) => a.attemptNumber - b.attemptNumber);

      expect(j1.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 1 * dayMs);
      expect(j1.scheduledAt.getTime()).toBeLessThanOrEqual(after + 1 * dayMs);

      expect(j2.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 3 * dayMs);
      expect(j3.scheduledAt.getTime()).toBeGreaterThanOrEqual(before + 7 * dayMs);
    });

    it('is idempotent: does not create duplicate jobs on second call', async () => {
      await scheduler.scheduleRetries(SUB, MER, AMT, TOK);
      await scheduler.scheduleRetries(SUB, MER, AMT, TOK);

      expect(mockPrisma.retries).toHaveLength(3);
    });
  });

  // ── handleJob (via processDueJobs) ────────────────────────────────────────

  describe('handleJob success path', () => {
    it('calls executePaymentFn and cancels remaining pending retries on success', async () => {
      // Seed: attempt 1 is due, attempts 2 and 3 are still pending future
      const now = new Date();
      await mockPrisma.paymentRetry.create({
        data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 1, status: 'pending', scheduledAt: daysAgo(1) },
      });
      await mockPrisma.paymentRetry.create({
        data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 2, status: 'pending', scheduledAt: daysFromNow(3) },
      });
      await mockPrisma.paymentRetry.create({
        data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 3, status: 'pending', scheduledAt: daysFromNow(7) },
      });

      await queue.processDueJobs();

      expect(executePaymentFn).toHaveBeenCalledWith(SUB, MER);

      const statuses = mockPrisma.retries.map((r) => r.status);
      // Attempt 1 → succeeded; attempts 2 & 3 → cancelled (by cancelAll inside handleJob)
      expect(statuses).toContain('succeeded');
      expect(statuses.filter((s) => s === 'cancelled')).toHaveLength(2);
    });
  });

  // ── onJobFailed + max_retries_exceeded webhook ─────────────────────────────

  describe('onJobFailed', () => {
    let fetchMock: jest.SpyInstance;

    beforeEach(() => {
      fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
        ok: true,
        status: 200,
      } as Response);
    });

    afterEach(() => {
      fetchMock.mockRestore();
    });

    it('fires the webhook when all attempts are failed and none succeeded', async () => {
      const webhookUrl = 'https://merchant.example.com/webhook';
      mockPrisma.webhookEndpoints.push({
        id: 1, merchant: MER, url: webhookUrl, active: true, createdAt: new Date(),
      });

      // Seed 3 failed retries — no pending, no succeeded
      for (let i = 1; i <= 3; i++) {
        await mockPrisma.paymentRetry.create({
          data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: i, status: 'failed', scheduledAt: daysAgo(i) },
        });
      }

      const failedJob = mockPrisma.retries[2]; // attempt 3
      await scheduler.onJobFailed(failedJob as any);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toBe(webhookUrl);

      const body = JSON.parse((options as RequestInit).body as string);
      expect(body.event).toBe('max_retries_exceeded');
      expect(body.subscriber).toBe(SUB);
      expect(body.merchant).toBe(MER);
      expect(body.totalAttempts).toBe(3);
    });

    it('records the webhook delivery in the DB', async () => {
      const webhookUrl = 'https://merchant.example.com/webhook';
      mockPrisma.webhookEndpoints.push({
        id: 1, merchant: MER, url: webhookUrl, active: true, createdAt: new Date(),
      });

      for (let i = 1; i <= 3; i++) {
        await mockPrisma.paymentRetry.create({
          data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: i, status: 'failed', scheduledAt: daysAgo(i) },
        });
      }

      await scheduler.onJobFailed(mockPrisma.retries[2] as any);

      expect(mockPrisma.webhookDeliveries).toHaveLength(1);
      expect(mockPrisma.webhookDeliveries[0].event).toBe('max_retries_exceeded');
      expect(mockPrisma.webhookDeliveries[0].success).toBe(true);
    });

    it('does not fire webhook when pending jobs still remain', async () => {
      // 1 failed + 2 still pending → not all exhausted yet
      await mockPrisma.paymentRetry.create({
        data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 1, status: 'failed', scheduledAt: daysAgo(1) },
      });
      await mockPrisma.paymentRetry.create({
        data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 2, status: 'pending', scheduledAt: daysFromNow(3) },
      });

      await scheduler.onJobFailed(mockPrisma.retries[0] as any);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('does not fire webhook when at least one attempt succeeded', async () => {
      await mockPrisma.paymentRetry.create({
        data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 1, status: 'succeeded', scheduledAt: daysAgo(1) },
      });
      await mockPrisma.paymentRetry.create({
        data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 2, status: 'failed', scheduledAt: daysAgo(0) },
      });

      await scheduler.onJobFailed(mockPrisma.retries[1] as any);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('uses RETRY_WEBHOOK_URL_FALLBACK env var when no endpoint configured', async () => {
      process.env.RETRY_WEBHOOK_URL_FALLBACK = 'https://fallback.example.com/hook';

      for (let i = 1; i <= 3; i++) {
        await mockPrisma.paymentRetry.create({
          data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: i, status: 'failed', scheduledAt: daysAgo(i) },
        });
      }

      await scheduler.onJobFailed(mockPrisma.retries[2] as any);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url] = fetchMock.mock.calls[0];
      expect(url).toBe('https://fallback.example.com/hook');
    });

    it('skips webhook delivery when no URL is configured', async () => {
      for (let i = 1; i <= 3; i++) {
        await mockPrisma.paymentRetry.create({
          data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: i, status: 'failed', scheduledAt: daysAgo(i) },
        });
      }

      await scheduler.onJobFailed(mockPrisma.retries[2] as any);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});

// ─── Route tests: GET & DELETE /:subscriber/:merchant/retries ─────────────────

import express from 'express';
import request from 'supertest';
import subscriptionsRouter from '../src/routes/subscriptions';

// Build a minimal express app for route tests
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/v1/subscriptions', subscriptionsRouter);
  return app;
}

// We need the retryQueue singleton to be backed by our mockPrisma.
// Since retryQueue is already imported by the router (which imported our mocked prisma),
// the singleton's DB calls will hit mockPrisma automatically.

describe('GET /api/v1/subscriptions/:subscriber/:merchant/retries', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    mockPrisma.reset();
    app = buildApp();
  });

  it('returns 200 with empty retries array when no records exist', async () => {
    const res = await request(app).get(`/api/v1/subscriptions/${SUB}/${MER}/retries`);

    expect(res.status).toBe(200);
    expect(res.body.subscriber).toBe(SUB);
    expect(res.body.merchant).toBe(MER);
    expect(res.body.retries).toEqual([]);
  });

  it('returns retry records ordered by scheduledAt asc', async () => {
    await mockPrisma.paymentRetry.create({
      data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 2, status: 'pending', scheduledAt: daysFromNow(3) },
    });
    await mockPrisma.paymentRetry.create({
      data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 1, status: 'pending', scheduledAt: daysFromNow(1) },
    });

    const res = await request(app).get(`/api/v1/subscriptions/${SUB}/${MER}/retries`);

    expect(res.status).toBe(200);
    expect(res.body.retries).toHaveLength(2);
    expect(res.body.retries[0].attemptNumber).toBe(1);
    expect(res.body.retries[1].attemptNumber).toBe(2);
  });

  it('returns expected fields on each retry item', async () => {
    const scheduledAt = daysFromNow(1);
    await mockPrisma.paymentRetry.create({
      data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 1, status: 'pending', scheduledAt },
    });

    const res = await request(app).get(`/api/v1/subscriptions/${SUB}/${MER}/retries`);

    const item = res.body.retries[0];
    expect(item).toHaveProperty('id');
    expect(item).toHaveProperty('attemptNumber', 1);
    expect(item).toHaveProperty('status', 'pending');
    expect(item).toHaveProperty('scheduledAt');
    expect(item).toHaveProperty('executedAt');
    expect(item).toHaveProperty('error');
    expect(item).toHaveProperty('createdAt');
  });

  it('does not return retries belonging to a different subscriber', async () => {
    const OTHER_SUB = 'GOTHER1XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX';
    await mockPrisma.paymentRetry.create({
      data: { subscriber: OTHER_SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 1, status: 'pending', scheduledAt: daysFromNow(1) },
    });

    const res = await request(app).get(`/api/v1/subscriptions/${SUB}/${MER}/retries`);

    expect(res.status).toBe(200);
    expect(res.body.retries).toHaveLength(0);
  });
});

describe('DELETE /api/v1/subscriptions/:subscriber/:merchant/retries', () => {
  let app: ReturnType<typeof buildApp>;

  beforeEach(() => {
    mockPrisma.reset();
    app = buildApp();
  });

  it('returns 200 with cancelled: 0 when no pending retries exist', async () => {
    const res = await request(app).delete(`/api/v1/subscriptions/${SUB}/${MER}/retries`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: 0 });
  });

  it('cancels all pending retries and returns the count', async () => {
    await mockPrisma.paymentRetry.create({
      data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 1, status: 'pending', scheduledAt: daysFromNow(1) },
    });
    await mockPrisma.paymentRetry.create({
      data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 2, status: 'pending', scheduledAt: daysFromNow(3) },
    });

    const res = await request(app).delete(`/api/v1/subscriptions/${SUB}/${MER}/retries`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: 2 });
    expect(mockPrisma.retries.every((r) => r.status === 'cancelled')).toBe(true);
  });

  it('does not cancel succeeded or failed retries', async () => {
    await mockPrisma.paymentRetry.create({
      data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 1, status: 'succeeded', scheduledAt: daysAgo(1) },
    });
    await mockPrisma.paymentRetry.create({
      data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 2, status: 'failed', scheduledAt: daysAgo(1) },
    });
    await mockPrisma.paymentRetry.create({
      data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 3, status: 'pending', scheduledAt: daysFromNow(7) },
    });

    const res = await request(app).delete(`/api/v1/subscriptions/${SUB}/${MER}/retries`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: 1 });

    const statuses = mockPrisma.retries.map((r) => r.status);
    expect(statuses).toContain('succeeded');
    expect(statuses).toContain('failed');
    expect(statuses).toContain('cancelled');
  });

  it('subsequent GET after DELETE shows cancelled status', async () => {
    await mockPrisma.paymentRetry.create({
      data: { subscriber: SUB, merchant: MER, amount: AMT, token: TOK, attemptNumber: 1, status: 'pending', scheduledAt: daysFromNow(1) },
    });

    await request(app).delete(`/api/v1/subscriptions/${SUB}/${MER}/retries`);
    const res = await request(app).get(`/api/v1/subscriptions/${SUB}/${MER}/retries`);

    expect(res.status).toBe(200);
    expect(res.body.retries[0].status).toBe('cancelled');
  });
});
