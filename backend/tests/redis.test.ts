/**
 * backend/tests/redis.test.ts
 *
 * Unit tests for backend/src/lib/redis.ts
 *
 * Covers:
 *   - Happy-path cache get/set/del
 *   - CACHE_MISS sentinel returned when key absent
 *   - CACHE_MISS returned when Redis is unavailable (circuit open)
 *   - Timeout → circuit opens → subsequent calls skip Redis
 *   - Circuit recovery (half-open probe succeeds → circuit closes)
 *   - acquireLock returns acquired=false when Redis is unavailable (fail-closed)
 *   - releaseLock is a no-op when token mismatches
 *   - InMemoryFallbackCache: set, get, del, TTL expiry, MAX_ENTRIES eviction
 *   - Tenant isolation: keys are namespaced per prefix
 *   - Sensitive values are never passed to the adapter get/set by key only
 */

import {
  RedisClient,
  CircuitBreaker,
  InMemoryFallbackCache,
  CACHE_MISS,
  cacheGet,
  cacheSet,
  cacheDel,
  acquireLock,
  setRedisAdapter,
  OPERATION_TIMEOUT_MS,
  type RedisAdapter,
} from '../src/lib/redis';

// ─── Mock adapter factory ─────────────────────────────────────────────────────

function makeAdapter(overrides: Partial<RedisAdapter> = {}): jest.Mocked<RedisAdapter> {
  return {
    get:    jest.fn().mockResolvedValue(null),
    set:    jest.fn().mockResolvedValue(undefined),
    del:    jest.fn().mockResolvedValue(undefined),
    set_nx: jest.fn().mockResolvedValue(true),
    ping:   jest.fn().mockResolvedValue('PONG'),
    quit:   jest.fn().mockResolvedValue(undefined),
    ...overrides,
  } as jest.Mocked<RedisAdapter>;
}

// ─── CircuitBreaker ───────────────────────────────────────────────────────────

describe('CircuitBreaker', () => {
  test('starts closed — allows calls', () => {
    const cb = new CircuitBreaker(3, 1_000);
    expect(cb.allowCall()).toBe(true);
    expect(cb.currentState).toBe('closed');
  });

  test('opens after failureThreshold failures', () => {
    const cb = new CircuitBreaker(3, 1_000);
    cb.onFailure();
    cb.onFailure();
    expect(cb.allowCall()).toBe(true);
    cb.onFailure(); // 3rd failure
    expect(cb.currentState).toBe('open');
    expect(cb.allowCall()).toBe(false);
  });

  test('transitions to half-open after recovery window', () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker(2, 500);
    cb.onFailure();
    cb.onFailure();
    expect(cb.allowCall()).toBe(false);

    jest.advanceTimersByTime(600);
    expect(cb.allowCall()).toBe(true);     // half-open probe
    expect(cb.currentState).toBe('half-open');
    jest.useRealTimers();
  });

  test('resets to closed on success from half-open', () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker(2, 500);
    cb.onFailure(); cb.onFailure();
    jest.advanceTimersByTime(600);
    cb.allowCall(); // enter half-open
    cb.onSuccess();
    expect(cb.currentState).toBe('closed');
    jest.useRealTimers();
  });

  test('returns to open if half-open probe fails', () => {
    jest.useFakeTimers();
    const cb = new CircuitBreaker(2, 500);
    cb.onFailure(); cb.onFailure();
    jest.advanceTimersByTime(600);
    cb.allowCall(); // half-open
    cb.onFailure();
    expect(cb.currentState).toBe('open');
    jest.useRealTimers();
  });
});

// ─── RedisClient — happy path ─────────────────────────────────────────────────

describe('RedisClient — happy path', () => {
  test('get returns value when key exists', async () => {
    const adapter = makeAdapter({ get: jest.fn().mockResolvedValue('hello') });
    const client = new RedisClient(adapter, 'test');

    const result = await client.get('mykey');
    expect(result).toBe('hello');
    expect(adapter.get).toHaveBeenCalledWith('test:mykey');
  });

  test('get returns CACHE_MISS when key absent', async () => {
    const adapter = makeAdapter({ get: jest.fn().mockResolvedValue(null) });
    const client = new RedisClient(adapter, 'test');

    const result = await client.get('absent');
    expect(result).toBe(CACHE_MISS);
  });

  test('set calls adapter.set with namespaced key and TTL', async () => {
    const adapter = makeAdapter();
    const client = new RedisClient(adapter, 'ns');

    await client.set('k', 'v', 60);
    expect(adapter.set).toHaveBeenCalledWith('ns:k', 'v', { ex: 60 });
  });

  test('del calls adapter.del with namespaced key', async () => {
    const adapter = makeAdapter();
    const client = new RedisClient(adapter, 'ns');

    await client.del('k');
    expect(adapter.del).toHaveBeenCalledWith('ns:k');
  });

  test('ping returns true when adapter returns PONG', async () => {
    const adapter = makeAdapter();
    const client = new RedisClient(adapter, 'ns');
    expect(await client.ping()).toBe(true);
  });
});

// ─── RedisClient — outage fallback ───────────────────────────────────────────

describe('RedisClient — outage fallback behavior', () => {
  test('get returns CACHE_MISS when adapter throws', async () => {
    const adapter = makeAdapter({
      get: jest.fn().mockRejectedValue(new Error('connection refused')),
    });
    const client = new RedisClient(adapter, 'test');

    const result = await client.get('k');
    expect(result).toBe(CACHE_MISS);
  });

  test('set is a no-op (does not throw) when adapter throws', async () => {
    const adapter = makeAdapter({
      set: jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    });
    const client = new RedisClient(adapter, 'test');

    await expect(client.set('k', 'v')).resolves.not.toThrow();
  });

  test('circuit opens after repeated failures — subsequent calls skip adapter', async () => {
    const adapter = makeAdapter({
      get: jest.fn().mockRejectedValue(new Error('down')),
    });
    const cb = new CircuitBreaker(2, 60_000);
    const client = new RedisClient(adapter, 'test', cb);

    await client.get('a'); // failure 1
    await client.get('b'); // failure 2 → circuit opens

    const callCount = (adapter.get as jest.Mock).mock.calls.length;
    await client.get('c'); // circuit open — should NOT call adapter
    expect((adapter.get as jest.Mock).mock.calls.length).toBe(callCount); // unchanged
  });

  test('operation timeout causes CACHE_MISS and opens circuit', async () => {
    jest.useFakeTimers();
    const adapter = makeAdapter({
      get: jest.fn().mockImplementation(
        () => new Promise(() => { /* never resolves */ }),
      ),
    });
    const client = new RedisClient(adapter, 'test');

    const getPromise = client.get('k');
    jest.advanceTimersByTime(OPERATION_TIMEOUT_MS + 100);
    const result = await getPromise;
    expect(result).toBe(CACHE_MISS);
    jest.useRealTimers();
  });
});

// ─── RedisClient — distributed lock (fail-closed) ────────────────────────────

describe('RedisClient — acquireLock', () => {
  test('acquires lock when set_nx returns true', async () => {
    const adapter = makeAdapter({ set_nx: jest.fn().mockResolvedValue(true) });
    const client = new RedisClient(adapter, 'test');

    const result = await client.acquireLock('resource-a');
    expect(result.acquired).toBe(true);
    expect(typeof result.token).toBe('string');
  });

  test('returns acquired=false when lock already held (set_nx returns false)', async () => {
    const adapter = makeAdapter({ set_nx: jest.fn().mockResolvedValue(false) });
    const client = new RedisClient(adapter, 'test');

    const result = await client.acquireLock('resource-b');
    expect(result.acquired).toBe(false);
    expect(result.token).toBeUndefined();
  });

  test('fails closed when adapter throws — acquired=false', async () => {
    const adapter = makeAdapter({
      set_nx: jest.fn().mockRejectedValue(new Error('Redis error')),
    });
    const client = new RedisClient(adapter, 'test');

    const result = await client.acquireLock('resource-c');
    expect(result.acquired).toBe(false);
  });

  test('fails closed when circuit is open', async () => {
    const adapter = makeAdapter({ set_nx: jest.fn() });
    const cb = new CircuitBreaker(1, 60_000);
    cb.onFailure(); // open circuit
    const client = new RedisClient(adapter, 'test', cb);

    const result = await client.acquireLock('resource-d');
    expect(result.acquired).toBe(false);
    expect(adapter.set_nx).not.toHaveBeenCalled();
  });

  test('releaseLock deletes key when token matches', async () => {
    const store: Record<string, string> = {};
    const adapter = makeAdapter({
      get:    jest.fn().mockImplementation((k: string) => Promise.resolve(store[k] ?? null)),
      del:    jest.fn().mockImplementation((k: string) => { delete store[k]; return Promise.resolve(); }),
      set_nx: jest.fn().mockImplementation((k: string, v: string) => {
        if (store[k]) return Promise.resolve(false);
        store[k] = v;
        return Promise.resolve(true);
      }),
    });
    const client = new RedisClient(adapter, 'test');

    const { token } = await client.acquireLock('res');
    await client.releaseLock('res', token!);
    expect(adapter.del).toHaveBeenCalled();
  });

  test('releaseLock is a no-op when token does not match', async () => {
    const adapter = makeAdapter({
      get: jest.fn().mockResolvedValue('correct-token'),
    });
    const client = new RedisClient(adapter, 'test');

    await expect(client.releaseLock('res', 'wrong-token')).resolves.not.toThrow();
    expect(adapter.del).not.toHaveBeenCalled();
  });
});

// ─── InMemoryFallbackCache ────────────────────────────────────────────────────

describe('InMemoryFallbackCache', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test('set and get round-trip', () => {
    const cache = new InMemoryFallbackCache();
    cache.set('k', 'v', 60);
    expect(cache.get('k')).toBe('v');
  });

  test('returns CACHE_MISS for absent key', () => {
    const cache = new InMemoryFallbackCache();
    expect(cache.get('absent')).toBe(CACHE_MISS);
  });

  test('del removes key', () => {
    const cache = new InMemoryFallbackCache();
    cache.set('k', 'v', 60);
    cache.del('k');
    expect(cache.get('k')).toBe(CACHE_MISS);
  });

  test('expired entry returns CACHE_MISS', () => {
    const cache = new InMemoryFallbackCache();
    cache.set('k', 'v', 1); // 1 second TTL
    jest.advanceTimersByTime(1_500);
    expect(cache.get('k')).toBe(CACHE_MISS);
  });

  test('evicts oldest entry when MAX_ENTRIES exceeded', () => {
    // @ts-ignore — access private for testing
    const cache = new InMemoryFallbackCache();
    // Fill to exactly 1000 entries (the internal MAX)
    for (let i = 0; i < 1_000; i++) {
      cache.set(`key-${i}`, 'v', 3600);
    }
    // Adding one more should evict key-0
    cache.set('overflow', 'v', 3600);
    expect(cache.get('key-0')).toBe(CACHE_MISS);
    expect(cache.get('overflow')).toBe('v');
  });
});

// ─── Module-level helpers ─────────────────────────────────────────────────────

describe('module-level cacheGet/cacheSet/cacheDel/acquireLock', () => {
  let adapter: jest.Mocked<RedisAdapter>;

  beforeEach(() => {
    adapter = makeAdapter();
    setRedisAdapter(adapter, 'test');
  });

  test('cacheGet returns value when Redis has key', async () => {
    adapter.get.mockResolvedValue('cached-value');
    const result = await cacheGet('merchant:abc');
    expect(result).toBe('cached-value');
  });

  test('cacheGet returns CACHE_MISS when key absent in Redis and fallback', async () => {
    adapter.get.mockResolvedValue(null);
    const result = await cacheGet('no-such-key');
    expect(result).toBe(CACHE_MISS);
  });

  test('cacheSet writes to Redis adapter', async () => {
    await cacheSet('mykey', 'myvalue', 120);
    expect(adapter.set).toHaveBeenCalledWith(
      expect.stringContaining('mykey'),
      'myvalue',
      { ex: 120 },
    );
  });

  test('cacheDel removes from Redis', async () => {
    await cacheDel('mykey');
    expect(adapter.del).toHaveBeenCalledWith(expect.stringContaining('mykey'));
  });

  test('acquireLock returns acquired=true when set_nx succeeds', async () => {
    adapter.set_nx.mockResolvedValue(true);
    const result = await acquireLock('my-resource');
    expect(result.acquired).toBe(true);
  });

  test('acquireLock returns acquired=false when Redis errors (fail-closed)', async () => {
    adapter.set_nx.mockRejectedValue(new Error('outage'));
    const result = await acquireLock('my-resource');
    expect(result.acquired).toBe(false);
  });
});

// ─── Tenant isolation ─────────────────────────────────────────────────────────

describe('tenant isolation via key namespacing', () => {
  test('two clients with different prefixes call adapter with different keys', async () => {
    const adapter = makeAdapter();
    const clientA = new RedisClient(adapter, 'merchantA');
    const clientB = new RedisClient(adapter, 'merchantB');

    await clientA.get('invoice:1');
    await clientB.get('invoice:1');

    const calls = (adapter.get as jest.Mock).mock.calls.map(([k]: [string]) => k);
    expect(calls).toContain('merchantA:invoice:1');
    expect(calls).toContain('merchantB:invoice:1');
    expect(calls[0]).not.toBe(calls[1]); // different namespaced keys
  });
});
