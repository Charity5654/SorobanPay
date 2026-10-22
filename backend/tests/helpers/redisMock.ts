/**
 * redisMock.ts — Minimal in-memory fake of the ioredis client surface used by
 * authService.ts (get / set with EX / getdel / keys / del), for unit tests
 * that shouldn't require a real Redis server.
 *
 * TTL expiry is computed from Date.now() at write time and checked against
 * Date.now() again on read, so tests that fast-forward the clock (as
 * auth.test.ts does for its expiry test) behave the same way a real Redis
 * server's TTL would.
 */

interface StoredValue {
  value: string;
  expiresAtMs: number;
}

export class MockRedisClient {
  private store = new Map<string, StoredValue>();

  private isLive(key: string): boolean {
    const entry = this.store.get(key);
    if (!entry) return false;
    if (Date.now() >= entry.expiresAtMs) {
      this.store.delete(key);
      return false;
    }
    return true;
  }

  async get(key: string): Promise<string | null> {
    return this.isLive(key) ? this.store.get(key)!.value : null;
  }

  async set(key: string, value: string, mode: 'EX', ttlSeconds: number): Promise<'OK'> {
    this.store.set(key, { value, expiresAtMs: Date.now() + ttlSeconds * 1000 });
    return 'OK';
  }

  /** Atomic get-then-delete, matching Redis's own GETDEL. */
  async getdel(key: string): Promise<string | null> {
    const value = await this.get(key);
    this.store.delete(key);
    return value;
  }

  async keys(pattern: string): Promise<string[]> {
    // Only the simple "prefix*" form used by authService is supported here.
    const prefix = pattern.endsWith('*') ? pattern.slice(0, -1) : pattern;
    return Array.from(this.store.keys()).filter(
      (k) => this.isLive(k) && k.startsWith(prefix),
    );
  }

  async del(...keys: string[]): Promise<number> {
    let count = 0;
    for (const key of keys) {
      if (this.store.delete(key)) count++;
    }
    return count;
  }
}
