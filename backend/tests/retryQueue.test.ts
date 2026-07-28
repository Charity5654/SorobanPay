/**
 * Unit tests for the payment retry queue service.
 *
 * All external dependencies (BullMQ Queue/Worker, IORedis, prisma, notifyWebhooks)
 * are fully mocked so no running Redis or database is required.
 */

// ─── Mock logger (avoids pino/pino-pretty transitive dependency) ──────────────

jest.mock('../src/lib/logger', () => ({
  __esModule: true,
  default: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

// ─── Mock BullMQ ─────────────────────────────────────────────────────────────

const mockAdd = jest.fn();
const mockJobRemove = jest.fn();
const mockJobFromId = jest.fn();

jest.mock('bullmq', () => {
  const mockJob = jest.fn().mockImplementation((id: string, data: unknown) => ({
    id,
    data,
    remove: mockJobRemove,
  }));

  return {
    Queue: jest.fn().mockImplementation(() => ({
      add: mockAdd,
      close: jest.fn(),
    })),
    Worker: jest.fn().mockImplementation(() => ({
      on: jest.fn(),
      close: jest.fn(),
    })),
    Job: {
      fromId: mockJobFromId,
    },
    QueueEvents: jest.fn(),
  };
});

// ─── Mock ioredis ─────────────────────────────────────────────────────────────

jest.mock('ioredis', () =>
  jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    quit: jest.fn(),
  })),
);

// ─── Mock prisma ─────────────────────────────────────────────────────────────

const mockQueryRaw = jest.fn();
const mockExecuteRawUnsafe = jest.fn();

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    $queryRaw: (...args: unknown[]) => mockQueryRaw(...args),
    $executeRawUnsafe: (...args: unknown[]) => mockExecuteRawUnsafe(...args),
  },
}));

// ─── Mock webhookNotifier ─────────────────────────────────────────────────────

const mockNotifyWebhooks = jest.fn();

jest.mock('../src/services/webhookNotifier', () => ({
  notifyWebhooks: (...args: unknown[]) => mockNotifyWebhooks(...args),
}));

// ─── Import under test (AFTER mocks) ─────────────────────────────────────────

import {
  enqueueRetries,
  cancelRetries,
  processRetryJob,
  emitMaxRetriesExceeded,
  getRetryDelays,
  getRawRetries,
  MAX_RETRIES,
  QUEUE_NAME,
} from '../src/services/retryQueue';
import type { RetryJobData, PaymentRetryRecord } from '../src/services/retryQueue';
import type { Job } from 'bullmq';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeRetryRecord(overrides: Partial<PaymentRetryRecord> = {}): PaymentRetryRecord {
  return {
    id: 1,
    subscriber: 'GSUB',
    merchant: 'GMER',
    amount: '1000',
    token: 'CTOKEN',
    attemptNumber: 1,
    status: 'pending',
    scheduledAt: new Date('2024-01-02T00:00:00Z'),
    attemptedAt: null,
    error: null,
    jobId: 'bull-job-1',
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-01T00:00:00Z'),
    ...overrides,
  };
}

function makeJob(data: RetryJobData, id = 'job-1'): Job<RetryJobData> {
  return {
    id,
    data,
    remove: mockJobRemove,
  } as unknown as Job<RetryJobData>;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  mockExecuteRawUnsafe.mockResolvedValue(undefined);
});

// ---------------------------------------------------------------------------
describe('getRetryDelays', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  it('returns default schedule [1d, 3d, 7d] when RETRY_DELAYS_MS is not set', () => {
    delete process.env.RETRY_DELAYS_MS;
    expect(getRetryDelays()).toEqual([DAY_MS, 3 * DAY_MS, 7 * DAY_MS]);
  });

  it('parses a valid RETRY_DELAYS_MS override', () => {
    process.env.RETRY_DELAYS_MS = '1000,2000,3000';
    expect(getRetryDelays()).toEqual([1000, 2000, 3000]);
    delete process.env.RETRY_DELAYS_MS;
  });

  it('falls back to defaults when RETRY_DELAYS_MS contains non-numbers', () => {
    process.env.RETRY_DELAYS_MS = '1000,bad,3000';
    expect(getRetryDelays()).toEqual([DAY_MS, 3 * DAY_MS, 7 * DAY_MS]);
    delete process.env.RETRY_DELAYS_MS;
  });
});

// ---------------------------------------------------------------------------
describe('enqueueRetries', () => {
  it('creates MAX_RETRIES DB rows and BullMQ jobs when no pending retries exist', async () => {
    // First call: getRawRetries returns empty array (no existing retries)
    mockQueryRaw
      .mockResolvedValueOnce([])            // getRawRetries idempotency check
      .mockResolvedValue([makeRetryRecord()]); // createRetryRecord calls

    mockAdd.mockResolvedValue({ id: 'j1' });

    process.env.RETRY_DELAYS_MS = '100,200,300'; // fast delays for the test
    const ids = await enqueueRetries('GSUB', 'GMER', '1000', 'CTOKEN');
    delete process.env.RETRY_DELAYS_MS;

    // One DB insert + BullMQ add per attempt
    expect(mockAdd).toHaveBeenCalledTimes(MAX_RETRIES);
    // Returns one id per created record
    expect(ids).toHaveLength(MAX_RETRIES);
  });

  it('skips enqueueing when pending retries already exist (idempotency)', async () => {
    const pending = makeRetryRecord({ status: 'pending' });
    mockQueryRaw.mockResolvedValueOnce([pending]); // getRawRetries returns pending

    process.env.RETRY_DELAYS_MS = '100,200,300';
    const ids = await enqueueRetries('GSUB', 'GMER', '1000', 'CTOKEN');
    delete process.env.RETRY_DELAYS_MS;

    expect(mockAdd).not.toHaveBeenCalled();
    expect(ids).toHaveLength(0);
  });

  it('passes the correct delay to BullMQ for each attempt', async () => {
    mockQueryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValue([makeRetryRecord()]);
    mockAdd.mockResolvedValue({ id: 'j1' });

    process.env.RETRY_DELAYS_MS = '1000,2000,3000';
    await enqueueRetries('GSUB', 'GMER', '500', 'CTOK');
    delete process.env.RETRY_DELAYS_MS;

    const addCalls = mockAdd.mock.calls;
    expect(addCalls[0][2]).toMatchObject({ delay: 1000 });
    expect(addCalls[1][2]).toMatchObject({ delay: 2000 });
    expect(addCalls[2][2]).toMatchObject({ delay: 3000 });
  });
});

// ---------------------------------------------------------------------------
describe('cancelRetries', () => {
  it('removes pending BullMQ jobs and marks DB rows cancelled', async () => {
    const pending1 = makeRetryRecord({ id: 1, attemptNumber: 1, jobId: 'j1' });
    const pending2 = makeRetryRecord({ id: 2, attemptNumber: 2, jobId: 'j2' });
    mockQueryRaw.mockResolvedValueOnce([pending1, pending2]);

    const fakeJob = { remove: mockJobRemove };
    mockJobFromId.mockResolvedValue(fakeJob);

    await cancelRetries('GSUB', 'GMER');

    expect(mockJobFromId).toHaveBeenCalledTimes(2);
    expect(mockJobRemove).toHaveBeenCalledTimes(2);
    // executeRawUnsafe called once per cancelled row (status update)
    expect(mockExecuteRawUnsafe).toHaveBeenCalledTimes(2);
    // Verify the UPDATE sets status = 'cancelled'
    const updateSql: string = mockExecuteRawUnsafe.mock.calls[0][0];
    expect(updateSql).toContain('UPDATE payment_retries');
  });

  it('does nothing when no pending retries exist', async () => {
    const done = makeRetryRecord({ status: 'succeeded' });
    mockQueryRaw.mockResolvedValueOnce([done]);

    await cancelRetries('GSUB', 'GMER');

    expect(mockJobFromId).not.toHaveBeenCalled();
    expect(mockExecuteRawUnsafe).not.toHaveBeenCalled();
  });

  it('continues cancelling remaining rows even if one BullMQ job removal fails', async () => {
    const pending1 = makeRetryRecord({ id: 1, jobId: 'j1' });
    const pending2 = makeRetryRecord({ id: 2, jobId: 'j2' });
    mockQueryRaw.mockResolvedValueOnce([pending1, pending2]);

    // First removal throws, second succeeds
    mockJobFromId
      .mockRejectedValueOnce(new Error('job not found'))
      .mockResolvedValueOnce({ remove: mockJobRemove });

    await expect(cancelRetries('GSUB', 'GMER')).resolves.not.toThrow();
    // Both rows should still be cancelled in DB
    expect(mockExecuteRawUnsafe).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
describe('processRetryJob', () => {
  const jobData: RetryJobData = {
    subscriber: 'GSUB',
    merchant: 'GMER',
    amount: '1000',
    token: 'CTOK',
    attemptNumber: 1,
    retryId: 42,
  };

  it('marks retry as succeeded and cancels remaining pending when webhook succeeds', async () => {
    mockNotifyWebhooks.mockResolvedValue(undefined);
    // getRawRetries returns remaining pending records (different ids)
    const remaining = [
      makeRetryRecord({ id: 43, attemptNumber: 2, status: 'pending', jobId: 'j2' }),
      makeRetryRecord({ id: 44, attemptNumber: 3, status: 'pending', jobId: 'j3' }),
    ];
    mockQueryRaw.mockResolvedValueOnce(remaining);
    mockJobFromId.mockResolvedValue({ remove: mockJobRemove });

    const job = makeJob(jobData);
    await processRetryJob(job);

    expect(mockNotifyWebhooks).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'payment.failed', subscriber: 'GSUB', merchant: 'GMER' }),
    );
    // Status set to 'succeeded' for retryId=42
    const succeededCall = mockExecuteRawUnsafe.mock.calls.find(
      (c: unknown[]) => (c[0] as string).includes('UPDATE') && c.includes('succeeded'),
    );
    expect(succeededCall).toBeDefined();
    // Remaining pending retries cancelled
    expect(mockJobRemove).toHaveBeenCalledTimes(2);
  });

  it('marks retry as failed and emits max_retries_exceeded on final attempt', async () => {
    mockNotifyWebhooks
      .mockRejectedValueOnce(new Error('webhook unreachable')) // processRetryJob call
      .mockResolvedValue(undefined);                           // emitMaxRetriesExceeded call

    const lastAttemptData: RetryJobData = { ...jobData, attemptNumber: MAX_RETRIES };
    const job = makeJob(lastAttemptData);
    await processRetryJob(job);

    // notifyWebhooks called once for the retry attempt, once for max_retries_exceeded
    expect(mockNotifyWebhooks).toHaveBeenCalledTimes(2);
    const escalationCall = mockNotifyWebhooks.mock.calls[1][0];
    expect(escalationCall).toMatchObject({
      event: 'payment.failed',
      txHash: 'max_retries_exceeded',
    });
  });

  it('marks retry as failed but does NOT emit max_retries_exceeded on non-final attempt', async () => {
    mockNotifyWebhooks.mockRejectedValue(new Error('webhook unreachable'));

    const earlyAttempt: RetryJobData = { ...jobData, attemptNumber: 1 };
    const job = makeJob(earlyAttempt);
    await processRetryJob(job);

    // Only one notifyWebhooks call — no escalation for early attempts
    expect(mockNotifyWebhooks).toHaveBeenCalledTimes(1);
    const failedUpdateCall = mockExecuteRawUnsafe.mock.calls.find(
      (c: unknown[]) => (c[0] as string).includes('UPDATE') && c.includes('failed'),
    );
    expect(failedUpdateCall).toBeDefined();
  });

  it('records the error message in the DB row on failure', async () => {
    const boom = new Error('upstream payment processor unavailable');
    mockNotifyWebhooks.mockRejectedValue(boom);

    const earlyAttempt: RetryJobData = { ...jobData, attemptNumber: 1 };
    await processRetryJob(makeJob(earlyAttempt));

    const updateCall = mockExecuteRawUnsafe.mock.calls.find(
      (c: unknown[]) => (c[0] as string).includes('UPDATE') && c.includes(boom.message),
    );
    expect(updateCall).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
describe('emitMaxRetriesExceeded', () => {
  it('calls notifyWebhooks with txHash = max_retries_exceeded', async () => {
    mockNotifyWebhooks.mockResolvedValue(undefined);
    await emitMaxRetriesExceeded('GSUB', 'GMER', '1000', 'CTOK');

    expect(mockNotifyWebhooks).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'payment.failed',
        subscriber: 'GSUB',
        merchant: 'GMER',
        txHash: 'max_retries_exceeded',
      }),
    );
  });

  it('does not throw if notifyWebhooks rejects', async () => {
    mockNotifyWebhooks.mockRejectedValue(new Error('redis down'));
    await expect(emitMaxRetriesExceeded('GSUB', 'GMER', '500', 'CTOK')).resolves.not.toThrow();
  });
});

// ---------------------------------------------------------------------------
describe('getRawRetries', () => {
  it('queries the correct table and returns mapped records', async () => {
    const rows = [makeRetryRecord({ id: 10, attemptNumber: 1, status: 'pending' })];
    mockQueryRaw.mockResolvedValueOnce(rows);

    const result = await getRawRetries('GSUB', 'GMER');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(10);
    expect(result[0].status).toBe('pending');
  });

  it('returns an empty array when no records exist', async () => {
    mockQueryRaw.mockResolvedValueOnce([]);
    const result = await getRawRetries('UNKNOWN', 'GMER');
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('MAX_RETRIES constant', () => {
  it('equals 3', () => {
    expect(MAX_RETRIES).toBe(3);
  });
});

// ---------------------------------------------------------------------------
describe('QUEUE_NAME constant', () => {
  it('equals "payment-retries"', () => {
    expect(QUEUE_NAME).toBe('payment-retries');
  });
});
