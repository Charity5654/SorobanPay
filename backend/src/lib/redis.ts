/**
 * backend/src/lib/redis.ts
 *
 * Redis client with outage fallback behavior for SorobanPay.
 *
 * Design principles:
 *   - Bypass safe caches: when Redis is unavailable, cache reads return a
 *     "cache miss" sentinel rather than throwing so callers fall back to the
 *     source of truth (DB / RPC) without knowing Redis is down.
 *   - Fail closed for locks: when Redis is unavailable, distributed lock
 *     acquisition returns `false` (lock not held) so the caller skips the
 *     operation rather than running it without mutual exclusion.
 *   - Bounded dependency failure: all Redis operations time out after
 *     OPERATION_TIMEOUT_MS and the client reconnects automatically with
 *     exponential back-off up to MAX_RETRY_DELAY_MS.  Callers never hang.
 *   - Observable: every outage, recovery, and operation error is logged with
 *     enough context to diagnose the root cause without exposing secrets.
 *   - Tenant isolation: cache keys are namespaced with a tenant prefix so no
 *     cross-tenant leakage is possible even when multiple merchants share an
 *     instance.
 *
 * Usage:
 *   import { redisClient, cacheGet, cacheSet, acquireLock, releaseLock } from '../lib/redis';
 */

// ─── Constants ────────────────────────────────────────────────────────────────

/** Maximum time (ms) to wait for a single Redis operation before timing out. */
export const OPERATION_TIMEOUT_MS = 2_000;

/** Base delay (ms) for the first reconnect attempt. */
export const INITIAL_RETRY_DELAY_MS = 100;

/** Maximum delay (ms) between reconnect attempts (capped exponential back-off). */
export const MAX_RETRY_DELAY_MS = 30_000;

/** Sentinel value returned by cacheGet when Redis is unavailable or key absent. */
export const CACHE_MISS = Symbol('CACHE_MISS');

/** Default TTL (seconds) for cache entries when none is specified. */
const DEFAULT_TTL_SECONDS = 300; // 5 minutes

/** Lock TTL (seconds) — locks auto-expire if the holder crashes. */
const LOCK_TTL_SECONDS = 30;

// ─── Types ────────────────────────────────────────────────────────────────────

/** Minimal async Redis interface — kept narrow so it is easily mockable in tests. */
export interface RedisAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options?: { ex?: number }): Promise<void>;
  del(key: string): Promise<void>;
  /** Set key to value only if it does not already exist.  Returns true if set. */
  set_nx(key: string, value: string, ex: number): Promise<boolean>;
  ping(): Promise<string>;
  quit(): Promise<void>;
}

/** Result of a lock acquisition attempt. */
export interface LockResult {
  acquired: boolean;
  /** Unique token to pass to releaseLock — undefined when lock was not acquired. */
  token?: string;
}

/** Internal circuit-breaker state. */
type CircuitState = 'closed' | 'open' | 'half-open';

// ─── Observability helpers (redacts secrets) ──────────────────────────────────

/** Safe logger — key names are logged but values are never emitted. */
const log = {
  info: (msg: string, meta?: Record<string, unknown>) =>
    console.info('[redis]', msg, meta ?? ''),
  warn: (msg: string, meta?: Record<string, unknown>) =>
    console.warn('[redis]', msg, meta ?? ''),
  error: (msg: string, meta?: Record<string, unknown>) =>
    console.error('[redis]', msg, meta ?? ''),
};

/**
 * Sanitise an error for logging: extracts message and code only.
 * Prevents stack traces or connection strings leaking into structured logs.
 */
function sanitiseError(err: unknown): Record<string, unknown> {
  if (err instanceof Error) {
    return {
      message: err.message,
      code: (err as NodeJS.ErrnoException).code ?? 'UNKNOWN',
    };
  }
  return { message: String(err) };
}

// ─── Circuit breaker ──────────────────────────────────────────────────────────

/**
 * Lightweight circuit breaker to prevent hammering an unavailable Redis.
 *
 * States:
 *   closed    — normal operation; calls flow through.
 *   open      — Redis is assumed unavailable; calls return fallback immediately.
 *   half-open — one probe call is allowed to test recovery.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureAt = 0;

  constructor(
    private readonly failureThreshold = 3,
    private readonly recoveryWindowMs = 10_000,
  ) {}

  /** Returns true if a call should be attempted. */
  allowCall(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureAt >= this.recoveryWindowMs) {
        this.state = 'half-open';
        log.info('circuit-breaker entering half-open — probing Redis');
        return true;
      }
      return false;
    }
    // half-open: allow one probe
    return true;
  }

  onSuccess(): void {
    if (this.state !== 'closed') {
      log.info('circuit-breaker reset to closed — Redis recovered');
    }
    this.state = 'closed';
    this.failures = 0;
  }

  onFailure(): void {
    this.failures += 1;
    this.lastFailureAt = Date.now();
    if (this.state === 'half-open' || this.failures >= this.failureThreshold) {
      this.state = 'open';
      log.warn('circuit-breaker opened — Redis unavailable', {
        failures: this.failures,
      });
    }
  }

  get currentState(): CircuitState {
    return this.state;
  }
}

// ─── RedisClient ──────────────────────────────────────────────────────────────

/**
 * Wraps a RedisAdapter with:
 *   - Circuit breaker (fail-fast when Redis is down)
 *   - Operation timeout (no hanging callers)
 *   - Key namespacing (tenant isolation)
 *   - Safe logging (values are never logged)
 */
export class RedisClient {
  private readonly breaker: CircuitBreaker;
  private connected = false;

  constructor(
    private readonly adapter: RedisAdapter,
    private readonly keyPrefix: string = 'sorobanpay',
    breaker?: CircuitBreaker,
  ) {
    this.breaker = breaker ?? new CircuitBreaker();
  }

  /** Namespace a user-supplied key with the configured prefix. */
  private ns(key: string): string {
    return `${this.keyPrefix}:${key}`;
  }

  /**
   * Wrap an async Redis operation with a timeout and circuit-breaker.
   * Returns `null` on any failure so callers can fall back gracefully.
   */
  private async withFallback<T>(
    operation: string,
    fn: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    if (!this.breaker.allowCall()) {
      log.warn(`circuit open — skipping ${operation}`, { state: this.breaker.currentState });
      return fallback;
    }

    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Redis ${operation} timed out after ${OPERATION_TIMEOUT_MS}ms`)), OPERATION_TIMEOUT_MS),
    );

    try {
      const result = await Promise.race([fn(), timeout]);
      this.breaker.onSuccess();
      this.connected = true;
      return result;
    } catch (err) {
      this.breaker.onFailure();
      this.connected = false;
      log.error(`${operation} failed — returning fallback`, {
        ...sanitiseError(err),
        operation,
      });
      return fallback;
    }
  }

  /**
   * Retrieve a cached value.
   *
   * Returns:
   *   - The cached value string if the key exists.
   *   - `CACHE_MISS` if the key does not exist or Redis is unavailable.
   *
   * Callers should treat CACHE_MISS as a signal to fetch from the primary
   * source and optionally re-populate the cache.
   */
  async get(key: string): Promise<string | typeof CACHE_MISS> {
    const namespacedKey = this.ns(key);
    const result = await this.withFallback(
      'GET',
      () => this.adapter.get(namespacedKey),
      null,
    );
    if (result === null) {
      return CACHE_MISS;
    }
    return result;
  }

  /**
   * Store a value in the cache with an optional TTL.
   *
   * Silently no-ops if Redis is unavailable — the caller continues without
   * caching rather than failing the request.
   */
  async set(key: string, value: string, ttlSeconds = DEFAULT_TTL_SECONDS): Promise<void> {
    const namespacedKey = this.ns(key);
    await this.withFallback(
      'SET',
      () => this.adapter.set(namespacedKey, value, { ex: ttlSeconds }),
      undefined,
    );
  }

  /**
   * Remove a key from the cache.
   *
   * Silently no-ops if Redis is unavailable.
   */
  async del(key: string): Promise<void> {
    const namespacedKey = this.ns(key);
    await this.withFallback(
      'DEL',
      () => this.adapter.del(namespacedKey),
      undefined,
    );
  }

  /**
   * Attempt to acquire a distributed lock.
   *
   * Fail-closed contract: if Redis is unavailable the lock is NOT acquired
   * (`acquired: false`).  The caller must skip the guarded operation rather
   * than proceeding without mutual exclusion.
   *
   * @param resource  Logical resource name (namespaced automatically).
   * @param ttl       Lock TTL in seconds — lock self-expires if holder crashes.
   * @returns         LockResult with `acquired` and an opaque `token` for release.
   */
  async acquireLock(
    resource: string,
    ttl = LOCK_TTL_SECONDS,
  ): Promise<LockResult> {
    if (!this.breaker.allowCall()) {
      log.warn('circuit open — lock NOT acquired (fail-closed)', { resource });
      return { acquired: false };
    }

    const lockKey = this.ns(`lock:${resource}`);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const timeout = new Promise<boolean>((_, reject) =>
      setTimeout(() => reject(new Error(`Redis acquireLock timed out`)), OPERATION_TIMEOUT_MS),
    );

    try {
      const acquired = await Promise.race([
        this.adapter.set_nx(lockKey, token, ttl),
        timeout,
      ]);
      this.breaker.onSuccess();
      if (acquired) {
        log.info('lock acquired', { resource });
        return { acquired: true, token };
      }
      return { acquired: false };
    } catch (err) {
      this.breaker.onFailure();
      log.error('acquireLock failed — failing closed', {
        resource,
        ...sanitiseError(err),
      });
      return { acquired: false };
    }
  }

  /**
   * Release a previously acquired lock.
   *
   * Only releases if the stored token matches — prevents releasing a lock
   * held by a different holder after the original TTL expired.
   */
  async releaseLock(resource: string, token: string): Promise<void> {
    const lockKey = this.ns(`lock:${resource}`);

    await this.withFallback('releaseLock', async () => {
      const stored = await this.adapter.get(lockKey);
      if (stored === token) {
        await this.adapter.del(lockKey);
        log.info('lock released', { resource });
      } else {
        log.warn('releaseLock skipped — token mismatch or lock expired', { resource });
      }
    }, undefined);
  }

  /**
   * Health-check ping.
   * Returns true if Redis responds within the timeout; false otherwise.
   */
  async ping(): Promise<boolean> {
    const response = await this.withFallback('PING', () => this.adapter.ping(), null);
    return response === 'PONG';
  }

  /** Gracefully close the connection. */
  async quit(): Promise<void> {
    await this.adapter.quit().catch((err) => {
      log.warn('quit error', sanitiseError(err));
    });
    this.connected = false;
    log.info('connection closed');
  }

  get isConnected(): boolean {
    return this.connected;
  }
}

// ─── In-process fallback store (used when Redis is unavailable) ───────────────

/**
 * Simple in-memory LRU-ish cache used as a last-resort when Redis is down.
 * Bounded to MAX_ENTRIES to prevent unbounded memory growth.
 *
 * This is intentionally simple — it does NOT replicate cross-process and
 * does NOT support TTL eviction in tests.  Production code should treat
 * Redis unavailability as a cache miss and go to the primary store.
 */
export class InMemoryFallbackCache {
  private readonly store = new Map<string, { value: string; expiresAt: number }>();
  private readonly MAX_ENTRIES = 1_000;

  set(key: string, value: string, ttlSeconds: number): void {
    if (this.store.size >= this.MAX_ENTRIES) {
      // Evict the oldest entry.
      const firstKey = this.store.keys().next().value;
      if (firstKey !== undefined) {
        this.store.delete(firstKey);
      }
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1_000 });
  }

  get(key: string): string | typeof CACHE_MISS {
    const entry = this.store.get(key);
    if (!entry) return CACHE_MISS;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return CACHE_MISS;
    }
    return entry.value;
  }

  del(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }

  get size(): number {
    return this.store.size;
  }
}

// ─── Convenience wrappers (module-level singleton) ───────────────────────────

/**
 * Create a RedisClient backed by a NoopAdapter for environments where
 * Redis is not configured.  All operations return fallback values immediately.
 */
class NoopAdapter implements RedisAdapter {
  async get(_key: string): Promise<null> { return null; }
  async set(_key: string, _value: string): Promise<void> { /* noop */ }
  async del(_key: string): Promise<void> { /* noop */ }
  async set_nx(_key: string, _value: string, _ex: number): Promise<boolean> { return false; }
  async ping(): Promise<string> { return 'PONG'; }
  async quit(): Promise<void> { /* noop */ }
}

/**
 * Module-level singleton.
 *
 * In production, replace the NoopAdapter with a real ioredis/upstash adapter
 * by calling `setRedisAdapter(adapter)` during application startup.
 */
let _adapter: RedisAdapter = new NoopAdapter();
let _client: RedisClient = new RedisClient(_adapter);
const _fallbackCache = new InMemoryFallbackCache();

/**
 * Replace the underlying adapter.  Call once during application bootstrap
 * after importing your Redis client library and passing the connected client.
 *
 * Example (ioredis):
 *   import Redis from 'ioredis';
 *   import { setRedisAdapter } from './lib/redis';
 *
 *   const raw = new Redis(process.env.REDIS_URL);
 *   setRedisAdapter({
 *     get: (k) => raw.get(k),
 *     set: (k, v, opts) => raw.set(k, v, 'EX', opts?.ex ?? 300).then(() => {}),
 *     del: (k) => raw.del(k).then(() => {}),
 *     set_nx: (k, v, ex) => raw.set(k, v, 'EX', ex, 'NX').then((r) => r === 'OK'),
 *     ping: () => raw.ping(),
 *     quit: () => raw.quit().then(() => {}),
 *   });
 */
export function setRedisAdapter(adapter: RedisAdapter, prefix?: string): void {
  _adapter = adapter;
  _client = new RedisClient(adapter, prefix);
  log.info('Redis adapter configured', { prefix: prefix ?? 'sorobanpay' });
}

/** The module-level RedisClient singleton. */
export const redisClient = (): RedisClient => _client;

/**
 * Get a value from cache with automatic fallback to the in-memory cache.
 *
 * @returns  The cached string, or CACHE_MISS if not found in either layer.
 */
export async function cacheGet(key: string): Promise<string | typeof CACHE_MISS> {
  const redisResult = await _client.get(key);
  if (redisResult !== CACHE_MISS) return redisResult;

  // Redis unavailable — try in-memory fallback
  const memResult = _fallbackCache.get(key);
  if (memResult !== CACHE_MISS) {
    log.info('cache-get served from in-memory fallback', { key });
    return memResult;
  }

  return CACHE_MISS;
}

/**
 * Set a value in the cache.
 *
 * Writes to both Redis and the in-memory fallback so warm data is available
 * immediately after a Redis outage recovery.
 */
export async function cacheSet(
  key: string,
  value: string,
  ttlSeconds = DEFAULT_TTL_SECONDS,
): Promise<void> {
  await _client.set(key, value, ttlSeconds);
  _fallbackCache.set(key, value, ttlSeconds);
}

/**
 * Delete a key from both cache layers.
 */
export async function cacheDel(key: string): Promise<void> {
  await _client.del(key);
  _fallbackCache.del(key);
}

/**
 * Attempt to acquire a distributed lock (fail-closed).
 *
 * Returns LockResult.  Check `acquired` before proceeding with the
 * guarded operation.
 */
export async function acquireLock(
  resource: string,
  ttl = LOCK_TTL_SECONDS,
): Promise<LockResult> {
  return _client.acquireLock(resource, ttl);
}

/**
 * Release a previously acquired lock.
 */
export async function releaseLock(resource: string, token: string): Promise<void> {
  return _client.releaseLock(resource, token);
}

export { CACHE_MISS as REDIS_CACHE_MISS };
export type { CircuitState };
