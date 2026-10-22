/**
 * redis.lock.test.ts
 *
 * Unit tests for the distributed lock ownership token helpers added in #1067:
 *   acquireLock, renewLock, releaseLock
 *
 * The ioredis module is fully mocked so no real Redis connection is needed.
 */

// ─── Mock ioredis ─────────────────────────────────────────────────────────────

const mockSet = jest.fn();
const mockEval = jest.fn();
const mockGet = jest.fn();
const mockConnect = jest.fn().mockResolvedValue(undefined);

const mockRedisInstance = {
  set: mockSet,
  eval: mockEval,
  get: mockGet,
  connect: mockConnect,
  on: jest.fn(),
  quit: jest.fn().mockResolvedValue(undefined),
  disconnect: jest.fn(),
};

jest.mock('ioredis', () => {
  return jest.fn().mockImplementation(() => mockRedisInstance);
});

// ─── Module under test ────────────────────────────────────────────────────────
// We need to reset module state so each test group gets a clean client.
// Use jest.isolateModules where we need to control the singleton.

describe('acquireLock', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Make the client appear available by default.
    mockConnect.mockResolvedValue(undefined);
  });

  async function loadRedis() {
    // Re-import after clearing the module registry so the singleton resets.
    jest.resetModules();
    // Re-apply the ioredis mock after resetModules.
    jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedisInstance));
    process.env.REDIS_URL = 'redis://localhost:6379';
    const mod = await import('../redis');
    // Trigger the lazy client creation by reading the client.
    // The 'connect' handler fires synchronously in the mock so we can
    // simulate availability by triggering the 'ready' event handler.
    // Instead, we directly patch redisAvailable via the module API:
    // getRedisClient() returns null until 'connect' fires, so we simulate
    // it by having the connect mock call the 'connect' event handler.
    return mod;
  }

  test('returns LockHandle with token when SET NX succeeds', async () => {
    // Directly test by mocking internal getRedisClient result.
    // We use a simpler strategy: patch the module's internal functions
    // by testing the exported functions with a known Redis state.

    // Since we cannot easily control the private singleton, we test by
    // resetting the module and wiring the mock appropriately.
    jest.resetModules();
    jest.mock('ioredis', () => {
      const m = jest.fn().mockImplementation(() => ({
        set: jest.fn().mockResolvedValue('OK'),
        eval: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        on: (event: string, cb: Function) => {
          if (event === 'connect') cb();
          if (event === 'ready') cb();
        },
        quit: jest.fn().mockResolvedValue(undefined),
      }));
      return m;
    });

    process.env.REDIS_URL = 'redis://localhost:6379';
    const { acquireLock } = await import('../redis');
    const handle = await acquireLock('test-resource', { ttlMs: 5000 });

    expect(handle).not.toBeNull();
    expect(handle!.key).toBe('lock:test-resource');
    expect(handle!.token).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(handle!.expiresAt).toBeGreaterThan(Date.now());
  });

  test('returns null when SET NX returns null (lock held)', async () => {
    jest.resetModules();
    jest.mock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        set: jest.fn().mockResolvedValue(null),
        eval: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        on: (event: string, cb: Function) => {
          if (event === 'connect') cb();
          if (event === 'ready') cb();
        },
        quit: jest.fn().mockResolvedValue(undefined),
      })),
    );

    process.env.REDIS_URL = 'redis://localhost:6379';
    const { acquireLock } = await import('../redis');
    const handle = await acquireLock('busy-resource', { ttlMs: 5000 });

    expect(handle).toBeNull();
  });

  test('retries on failure and succeeds on second attempt', async () => {
    jest.resetModules();
    const mockSetFn = jest.fn()
      .mockResolvedValueOnce(null)   // first attempt fails
      .mockResolvedValueOnce('OK');  // second attempt succeeds

    jest.mock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        set: mockSetFn,
        eval: jest.fn(),
        connect: jest.fn().mockResolvedValue(undefined),
        on: (event: string, cb: Function) => {
          if (event === 'connect') cb();
          if (event === 'ready') cb();
        },
        quit: jest.fn().mockResolvedValue(undefined),
      })),
    );

    process.env.REDIS_URL = 'redis://localhost:6379';
    const { acquireLock } = await import('../redis');

    const handle = await acquireLock('retry-resource', {
      ttlMs: 5000,
      retryCount: 1,
      retryDelayMs: 1, // minimal delay in tests
    });

    expect(handle).not.toBeNull();
    expect(mockSetFn).toHaveBeenCalledTimes(2);
  });

  test('returns null when REDIS_URL is not set', async () => {
    jest.resetModules();
    delete process.env.REDIS_URL;
    const { acquireLock } = await import('../redis');
    const handle = await acquireLock('resource', { ttlMs: 1000 });
    expect(handle).toBeNull();
    // Restore
    process.env.REDIS_URL = 'redis://localhost:6379';
  });
});

// ─── renewLock ────────────────────────────────────────────────────────────────

describe('renewLock', () => {
  test('returns true when Lua script returns 1 (token matches)', async () => {
    jest.resetModules();
    jest.mock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        set: jest.fn(),
        eval: jest.fn().mockResolvedValue(1),
        connect: jest.fn().mockResolvedValue(undefined),
        on: (event: string, cb: Function) => {
          if (event === 'connect') cb();
          if (event === 'ready') cb();
        },
        quit: jest.fn().mockResolvedValue(undefined),
      })),
    );

    process.env.REDIS_URL = 'redis://localhost:6379';
    const { renewLock } = await import('../redis');

    const handle = { key: 'lock:res', token: 'tok-abc', expiresAt: Date.now() + 5000 };
    const result = await renewLock(handle, 5000);
    expect(result).toBe(true);
  });

  test('returns false when Lua script returns 0 (token mismatch / expired)', async () => {
    jest.resetModules();
    jest.mock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        set: jest.fn(),
        eval: jest.fn().mockResolvedValue(0),
        connect: jest.fn().mockResolvedValue(undefined),
        on: (event: string, cb: Function) => {
          if (event === 'connect') cb();
          if (event === 'ready') cb();
        },
        quit: jest.fn().mockResolvedValue(undefined),
      })),
    );

    process.env.REDIS_URL = 'redis://localhost:6379';
    const { renewLock } = await import('../redis');

    const handle = { key: 'lock:res', token: 'wrong-tok', expiresAt: Date.now() - 1 };
    const result = await renewLock(handle, 5000);
    expect(result).toBe(false);
  });

  test('returns false when Redis is unavailable', async () => {
    jest.resetModules();
    delete process.env.REDIS_URL;
    const { renewLock } = await import('../redis');
    const handle = { key: 'lock:res', token: 'tok', expiresAt: Date.now() + 1000 };
    const result = await renewLock(handle, 5000);
    expect(result).toBe(false);
    process.env.REDIS_URL = 'redis://localhost:6379';
  });
});

// ─── releaseLock ──────────────────────────────────────────────────────────────

describe('releaseLock', () => {
  test('returns true when Lua script returns 1 (token matches)', async () => {
    jest.resetModules();
    jest.mock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        set: jest.fn(),
        eval: jest.fn().mockResolvedValue(1),
        connect: jest.fn().mockResolvedValue(undefined),
        on: (event: string, cb: Function) => {
          if (event === 'connect') cb();
          if (event === 'ready') cb();
        },
        quit: jest.fn().mockResolvedValue(undefined),
      })),
    );

    process.env.REDIS_URL = 'redis://localhost:6379';
    const { releaseLock } = await import('../redis');

    const handle = { key: 'lock:res', token: 'valid-tok', expiresAt: Date.now() + 5000 };
    const result = await releaseLock(handle);
    expect(result).toBe(true);
  });

  test('returns false when token mismatches (expired lock held by another worker)', async () => {
    jest.resetModules();
    jest.mock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        set: jest.fn(),
        eval: jest.fn().mockResolvedValue(0),
        connect: jest.fn().mockResolvedValue(undefined),
        on: (event: string, cb: Function) => {
          if (event === 'connect') cb();
          if (event === 'ready') cb();
        },
        quit: jest.fn().mockResolvedValue(undefined),
      })),
    );

    process.env.REDIS_URL = 'redis://localhost:6379';
    const { releaseLock } = await import('../redis');

    const handle = { key: 'lock:res', token: 'stale-tok', expiresAt: Date.now() - 1000 };
    const result = await releaseLock(handle);
    expect(result).toBe(false);
  });

  test('returns false gracefully when Redis is unavailable', async () => {
    jest.resetModules();
    delete process.env.REDIS_URL;
    const { releaseLock } = await import('../redis');
    const handle = { key: 'lock:res', token: 'tok', expiresAt: Date.now() + 1000 };
    const result = await releaseLock(handle);
    expect(result).toBe(false);
    process.env.REDIS_URL = 'redis://localhost:6379';
  });

  test('returns false and swallows error when eval throws', async () => {
    jest.resetModules();
    jest.mock('ioredis', () =>
      jest.fn().mockImplementation(() => ({
        set: jest.fn(),
        eval: jest.fn().mockRejectedValue(new Error('EVALSHA error')),
        connect: jest.fn().mockResolvedValue(undefined),
        on: (event: string, cb: Function) => {
          if (event === 'connect') cb();
          if (event === 'ready') cb();
        },
        quit: jest.fn().mockResolvedValue(undefined),
      })),
    );

    process.env.REDIS_URL = 'redis://localhost:6379';
    const { releaseLock } = await import('../redis');
    const handle = { key: 'lock:res', token: 'tok', expiresAt: Date.now() + 1000 };
    const result = await releaseLock(handle);
    expect(result).toBe(false);
  });
});
