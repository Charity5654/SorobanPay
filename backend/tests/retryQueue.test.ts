/**
 * Tests for src/services/retryQueue.ts
 *
 * BullMQ and ioredis are mocked entirely — no real Redis connection required.
 * Prisma is replaced with a lightweight in-memory mock scoped to PaymentRetry.
 */

// ─── Logger mock ──────────────────────────────────────────────────────────────
jest.mock('../src/lib/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── BullMQ mock ─────────────────────────────────────────────────────────────
// We need the mock defined before any imports that load bullmq.

interface MockJob {
  id: string;
  data: Record<string, unknown>;
  remove: jest.Mock;
}

const mockJobs: Map<string, MockJob> = new Map();
let mockJobIdCounter = 0;

const mockQueueAdd = jest.fn(async (name: string, data: Record<string, unknown>, opts?: { delay?: number }) => {
  const id = String(++mockJobIdCounter);
  const job: MockJob = { id, data, remove: jest.fn().mockResolvedValue(undefined) };
  mockJobs.set(id, job);
  return { id };
});

const mockQueueGetJob = jest.fn(async (id: string) => mockJobs.get(id) ?? null);
const mockQueueClose = jest.fn().mockResolvedValue(undefined);

const workerListeners: Record<string, jest.Mock> = {};
const mockWorkerClose = jest.fn().mockResolvedValue(undefined);
const mockWorkerOn = jest.fn((event: string, cb: jest.Mock) => { workerListeners[event] = cb; });

jest.mock('bullmq', () => {
  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: mockQueueAdd,
      getJob: mockQueueGetJob,
      close: mockQueueClose,
    })),
    Worker: jest.fn().mockImplementation(() => ({
      on: mockWorkerOn,
      close: mockWorkerClose,
    })),
    QueueEvents: jest.fn(),
  };
});

// ─── webhookNotifier mock ─────────────────────────────────────────────────────
const mockNotifyWebhooks = jest.fn().mockResolvedValue(undefined);

jest.mock('../src/services/webhookNotifier', () => ({
  notifyWebhooks: mockNotifyWebhooks,
}));

// ─── Prisma mock ──────────────────────────────────────────────────────────────
// Minimal PaymentRetry table backed by an in-memory array.

interface StoredRetry {
  id: number;
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  attemptNumber: number;
  scheduledAt: Date;
  executedAt: Date | null;
  status: string;
  errorMessage: string | null;
  jobId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

let retryStore: StoredRetry[] = [];
let nextId = 1;

function matchesWhere(row: StoredRetry, where: Record<string, any>): boolean {
  return Object.entries(where).every(([k, v]) => {
    if (v === undefined || v === null) return true;
    if (k === 'status' && typeof v === 'object' && 'in' in v) {
      return (v as { in: string[] }).in.includes(row.status);
    }
    return String((row as any)[k]) === String(v);
  });
}

const mockPrismaPaymentRetry = {
  findFirst: jest.fn(async (args: { where: Record<string, any> }) => {
    return retryStore.find((r) => matchesWhere(r, args.where)) ?? null;
  }),
  findMany: jest.fn(async (args?: { where?: Record<string, any>; orderBy?: any }) => {
    if (!args?.where) return [...retryStore];
    return retryStore.filter((r) => matchesWhere(r, args.where!));
  }),
  upsert: jest.fn(async (args: {
    where: { subscriber_merchant_attempt: { subscriber: string; merchant: string; attemptNumber: number } };
    create: Omit<StoredRetry, 'id' | 'createdAt' | 'updatedAt' | 'executedAt'>;
    update: Partial<StoredRetry>;
  }) => {
    const { subscriber, merchant, attemptNumber } = args.where.subscriber_merchant_attempt;
    const idx = retryStore.findIndex(
      (r) => r.subscriber === subscriber && r.merchant === merchant && r.attemptNumber === attemptNumber,
    );
    if (idx >= 0) {
      retryStore[idx] = { ...retryStore[idx], ...args.update, updatedAt: new Date() };
      return retryStore[idx];
    }
    const created: StoredRetry = {
      id: nextId++,
      executedAt: null,
      ...args.create,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    retryStore.push(created);
    return created;
  }),
  update: jest.fn(async (args: { where: { id: number }; data: Partial<StoredRetry> }) => {
    const idx = retryStore.findIndex((r) => r.id === args.where.id);
    if (idx < 0) throw new Error(`PaymentRetry #${args.where.id} not found`);
    retryStore[idx] = { ...retryStore[idx], ...args.data, updatedAt: new Date() };
    return retryStore[idx];
  }),
  updateMany: jest.fn(async (args: { where: Record<string, any>; data: Partial<StoredRetry> }) => {
    let count = 0;
    retryStore = retryStore.map((r) => {
      if (matchesWhere(r, args.where)) {
        count++;
        return { ...r, ...args.data, updatedAt: new Date() };
      }
      return r;
    });
    return { count };
  }),
};

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: { paymentRetry: mockPrismaPaymentRetry },
}));

// ─── Imports (after all mocks are registered) ─────────────────────────────────
import {
  initRetryQueue,
  scheduleRetries,
  cancelRetries,
  closeRetryQueue,
  parseIntervalDays,
  MAX_RETRY_ATTEMPTS,
  _processRetryJob,
} from '../src/services/retryQueue';
import type { RetryJobData } from '../src/services/retryQueue';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeJob(data: RetryJobData): { id: string; data: RetryJobData } {
  return { id: 'test-job-id', data };
}

function resetState() {
  retryStore = [];
  nextId = 1;
  mockJobs.clear();
  mockJobIdCounter = 0;
  mockQueueAdd.mockClear();
  mockQueueGetJob.mockClear();
  mockQueueClose.mockClear();
  mockWorkerClose.mockClear();
  mockNotifyWebhooks.mockClear();
  mockPrismaPaymentRetry.findFirst.mockClear();
  mockPrismaPaymentRetry.findMany.mockClear();
  mockPrismaPaymentRetry.upsert.mockClear();
  mockPrismaPaymentRetry.update.mockClear();
  mockPrismaPaymentRetry.updateMany.mockClear();
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parseIntervalDays', () => {
  it('returns default [1,3,7] when env is undefined', () => {
    expect(parseIntervalDays(undefined)).toEqual([1, 3, 7]);
  });

  it('parses comma-separated day values', () => {
    expect(parseIntervalDays('2,5,10')).toEqual([2, 5, 10]);
  });

  it('falls back to defaults on all-invalid input', () => {
    expect(parseIntervalDays('abc,,,xyz')).toEqual([1, 3, 7]);
  });

  it('caps to MAX_RETRY_ATTEMPTS entries', () => {
    expect(parseIntervalDays('1,2,3,4,5').length).toBeLessThanOrEqual(MAX_RETRY_ATTEMPTS);
  });
});

describe('initRetryQueue', () => {
  afterEach(async () => {
    await closeRetryQueue();
    resetState();
  });

  it('initialises Queue and Worker with correct connection options', async () => {
    const { Queue, Worker } = require('bullmq');
    initRetryQueue('redis://localhost:6379');
    expect(Queue).toHaveBeenCalledTimes(1);
    expect(Worker).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — calling twice does not create a second queue', async () => {
    const { Queue } = require('bullmq');
    Queue.mockClear();
    initRetryQueue('redis://localhost:6379');
    initRetryQueue('redis://localhost:6379');
    expect(Queue).toHaveBeenCalledTimes(1);
  });
});

describe('scheduleRetries', () => {
  beforeEach(async () => {
    await closeRetryQueue();
    resetState();
    initRetryQueue('redis://localhost:6379');
  });

  afterEach(async () => {
    await closeRetryQueue();
  });

  it('creates MAX_RETRY_ATTEMPTS DB rows and BullMQ jobs', async () => {
    await scheduleRetries('GSUB1', 'GMERCHANT1', '1000', 'CTOKEN1');

    expect(retryStore).toHaveLength(MAX_RETRY_ATTEMPTS);
    expect(mockQueueAdd).toHaveBeenCalledTimes(MAX_RETRY_ATTEMPTS);
  });

  it('sets status PENDING and incrementing attemptNumber on each row', async () => {
    await scheduleRetries('GSUB2', 'GMERCHANT2', '500', 'CTOKEN2');

    const attempts = retryStore.map((r) => r.attemptNumber).sort();
    expect(attempts).toEqual([1, 2, 3]);
    retryStore.forEach((r) => expect(r.status).toBe('PENDING'));
  });

  it('schedules delays matching configured intervals', async () => {
    const origEnv = process.env.RETRY_INTERVALS_DAYS;
    process.env.RETRY_INTERVALS_DAYS = '1,3,7';

    await scheduleRetries('GSUB3', 'GMERCHANT3', '200', 'CTOKEN3');

    const calls = mockQueueAdd.mock.calls;
    const delays = calls.map((c) => c[2]?.delay as number);
    expect(delays[0]).toBeCloseTo(1 * 24 * 60 * 60 * 1000, -3);
    expect(delays[1]).toBeCloseTo(3 * 24 * 60 * 60 * 1000, -3);
    expect(delays[2]).toBeCloseTo(7 * 24 * 60 * 60 * 1000, -3);

    process.env.RETRY_INTERVALS_DAYS = origEnv;
  });

  it('skips scheduling if PENDING rows already exist (idempotency)', async () => {
    await scheduleRetries('GSUB4', 'GMERCHANT4', '100', 'CTOKEN4');
    mockQueueAdd.mockClear();
    mockPrismaPaymentRetry.upsert.mockClear();

    await scheduleRetries('GSUB4', 'GMERCHANT4', '100', 'CTOKEN4');

    expect(mockQueueAdd).not.toHaveBeenCalled();
    expect(mockPrismaPaymentRetry.upsert).not.toHaveBeenCalled();
  });

  it('stores jobId from BullMQ on each DB row', async () => {
    await scheduleRetries('GSUB5', 'GMERCHANT5', '300', 'CTOKEN5');

    retryStore.forEach((r) => {
      expect(r.jobId).toBeDefined();
      expect(typeof r.jobId).toBe('string');
    });
  });

  it('is a no-op when queue is not initialised', async () => {
    await closeRetryQueue();
    resetState();

    // Don't call initRetryQueue — queue is null
    await scheduleRetries('GSUB6', 'GMERCHANT6', '100', 'CTOKEN6');

    expect(retryStore).toHaveLength(0);
    expect(mockQueueAdd).not.toHaveBeenCalled();
  });
});

describe('cancelRetries', () => {
  beforeEach(async () => {
    await closeRetryQueue();
    resetState();
    initRetryQueue('redis://localhost:6379');
  });

  afterEach(async () => {
    await closeRetryQueue();
  });

  it('marks all PENDING rows as CANCELLED and returns the count', async () => {
    await scheduleRetries('GSUB7', 'GMERCHANT7', '100', 'CTOKEN7');

    const cancelled = await cancelRetries('GSUB7', 'GMERCHANT7');

    expect(cancelled).toBe(MAX_RETRY_ATTEMPTS);
    retryStore
      .filter((r) => r.subscriber === 'GSUB7')
      .forEach((r) => expect(r.status).toBe('CANCELLED'));
  });

  it('returns 0 when no PENDING rows exist', async () => {
    const cancelled = await cancelRetries('UNKNOWN', 'UNKNOWN');
    expect(cancelled).toBe(0);
  });

  it('does not cancel SUCCEEDED or FAILED rows', async () => {
    // Manually seed a SUCCEEDED row
    retryStore.push({
      id: nextId++,
      subscriber: 'GSUB8',
      merchant: 'GMERCHANT8',
      token: 'CTOKEN8',
      amount: '100',
      attemptNumber: 1,
      scheduledAt: new Date(),
      executedAt: new Date(),
      status: 'SUCCEEDED',
      errorMessage: null,
      jobId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const cancelled = await cancelRetries('GSUB8', 'GMERCHANT8');
    expect(cancelled).toBe(0);
    expect(retryStore[0].status).toBe('SUCCEEDED');
  });

  it('removes BullMQ jobs for cancelled PENDING rows', async () => {
    await scheduleRetries('GSUB9', 'GMERCHANT9', '100', 'CTOKEN9');

    // Snapshot the job IDs that were created
    const jobsBefore = [...mockJobs.keys()];
    expect(jobsBefore.length).toBe(MAX_RETRY_ATTEMPTS);

    await cancelRetries('GSUB9', 'GMERCHANT9');

    // Each job's .remove() should have been called
    for (const jobId of jobsBefore) {
      const job = mockJobs.get(jobId);
      expect(job?.remove).toHaveBeenCalled();
    }
  });
});

describe('processRetryJob', () => {
  beforeEach(async () => {
    await closeRetryQueue();
    resetState();
    initRetryQueue('redis://localhost:6379');
  });

  afterEach(async () => {
    await closeRetryQueue();
  });

  it('marks row PROCESSING then SUCCEEDED and calls notifyWebhooks', async () => {
    // Seed a PENDING row for attempt 1
    retryStore.push({
      id: nextId++,
      subscriber: 'GSUB10', merchant: 'GMERCHANT10', token: 'CTOKEN10',
      amount: '1000', attemptNumber: 1,
      scheduledAt: new Date(), executedAt: null,
      status: 'PENDING', errorMessage: null, jobId: 'j1',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const job = makeJob({ subscriber: 'GSUB10', merchant: 'GMERCHANT10', token: 'CTOKEN10', amount: '1000', attemptNumber: 1 });
    await _processRetryJob(job as any);

    expect(mockNotifyWebhooks).toHaveBeenCalledTimes(1);
    const row = retryStore.find((r) => r.subscriber === 'GSUB10');
    expect(row?.status).toBe('SUCCEEDED');
    expect(row?.executedAt).toBeInstanceOf(Date);
  });

  it('fires max_retries_exceeded webhook on the final attempt', async () => {
    retryStore.push({
      id: nextId++,
      subscriber: 'GSUB11', merchant: 'GMERCHANT11', token: 'CTOKEN11',
      amount: '1000', attemptNumber: MAX_RETRY_ATTEMPTS,
      scheduledAt: new Date(), executedAt: null,
      status: 'PENDING', errorMessage: null, jobId: 'j2',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const job = makeJob({
      subscriber: 'GSUB11', merchant: 'GMERCHANT11', token: 'CTOKEN11',
      amount: '1000', attemptNumber: MAX_RETRY_ATTEMPTS,
    });
    await _processRetryJob(job as any);

    // Two calls: the retry notification + max_retries_exceeded
    expect(mockNotifyWebhooks).toHaveBeenCalledTimes(2);

    // The second call should carry the max_retries_exceeded traceContext
    const secondCall = mockNotifyWebhooks.mock.calls[1][0];
    const ctx = JSON.parse(secondCall.traceContext ?? '{}');
    expect(ctx.eventType).toBe('max_retries_exceeded');
  });

  it('marks row FAILED and re-throws when notifyWebhooks throws', async () => {
    mockNotifyWebhooks.mockRejectedValueOnce(new Error('webhook down'));

    retryStore.push({
      id: nextId++,
      subscriber: 'GSUB12', merchant: 'GMERCHANT12', token: 'CTOKEN12',
      amount: '500', attemptNumber: 1,
      scheduledAt: new Date(), executedAt: null,
      status: 'PENDING', errorMessage: null, jobId: 'j3',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const job = makeJob({ subscriber: 'GSUB12', merchant: 'GMERCHANT12', token: 'CTOKEN12', amount: '500', attemptNumber: 1 });
    await expect(_processRetryJob(job as any)).rejects.toThrow('webhook down');

    const row = retryStore.find((r) => r.subscriber === 'GSUB12');
    expect(row?.status).toBe('FAILED');
    expect(row?.errorMessage).toBe('webhook down');
  });

  it('still fires max_retries_exceeded even when the final attempt fails', async () => {
    // First call (retry notification) fails; second call (max_retries_exceeded) is mocked to succeed
    mockNotifyWebhooks
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce(undefined);

    retryStore.push({
      id: nextId++,
      subscriber: 'GSUB13', merchant: 'GMERCHANT13', token: 'CTOKEN13',
      amount: '500', attemptNumber: MAX_RETRY_ATTEMPTS,
      scheduledAt: new Date(), executedAt: null,
      status: 'PENDING', errorMessage: null, jobId: 'j4',
      createdAt: new Date(), updatedAt: new Date(),
    });

    const job = makeJob({
      subscriber: 'GSUB13', merchant: 'GMERCHANT13', token: 'CTOKEN13',
      amount: '500', attemptNumber: MAX_RETRY_ATTEMPTS,
    });

    // Should throw (BullMQ records failure) but max_retries_exceeded still fires
    await expect(_processRetryJob(job as any)).rejects.toThrow('transient');
    expect(mockNotifyWebhooks).toHaveBeenCalledTimes(2);
  });
});
