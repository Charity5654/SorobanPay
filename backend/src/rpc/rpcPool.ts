/**
 * BE-70: RPC Connection Pool with Circuit Breaker and Automatic Failover
 *
 * Manages a pool of Soroban RPC endpoints with:
 * - Round-robin selection across healthy endpoints
 * - Automatic failover on error or HTTP 429 (rate-limit)
 * - Circuit breaker: mark endpoint unhealthy after N consecutive failures
 * - Auto-recovery after configurable timeout
 */

import { logger } from '../utils/logger';

// ── Types ────────────────────────────────────────────────────────────────────

export type EndpointState = 'healthy' | 'unhealthy';

export interface EndpointStatus {
  url: string;
  state: EndpointState;
  consecutiveFailures: number;
  lastFailureAt: number | null;
  totalRequests: number;
  totalFailures: number;
  lastCheckedAt: number | null;
}

export interface RpcPoolConfig {
  /** Comma-separated RPC URLs or an array */
  urls: string | string[];
  /** Consecutive failures before marking unhealthy (default: 3) */
  failureThreshold?: number;
  /** Milliseconds before retrying an unhealthy endpoint (default: 60 000) */
  recoveryTimeoutMs?: number;
  /** Per-request HTTP timeout in milliseconds (default: 10 000) */
  requestTimeoutMs?: number;
}

export interface RpcRequest {
  method: string;
  params?: unknown[];
  id?: number | string;
}

export interface RpcResponse<T = unknown> {
  jsonrpc: string;
  id: number | string | null;
  result?: T;
  error?: { code: number; message: string; data?: unknown };
}

// ── RPC Pool ─────────────────────────────────────────────────────────────────

export class RpcConnectionPool {
  private readonly endpoints: EndpointStatus[];
  private currentIndex: number = 0;

  private readonly failureThreshold: number;
  private readonly recoveryTimeoutMs: number;
  private readonly requestTimeoutMs: number;

  constructor(config: RpcPoolConfig) {
    const rawUrls = Array.isArray(config.urls)
      ? config.urls
      : config.urls.split(',').map((u) => u.trim());

    // Deduplicate while preserving order
    const urls = [...new Set(rawUrls.filter(Boolean))];

    if (urls.length === 0) {
      throw new Error('RpcConnectionPool: at least one RPC URL is required');
    }

    this.failureThreshold = config.failureThreshold ?? 3;
    this.recoveryTimeoutMs = config.recoveryTimeoutMs ?? 60_000;
    this.requestTimeoutMs = config.requestTimeoutMs ?? 10_000;

    this.endpoints = urls.map((url) => ({
      url,
      state: 'healthy' as EndpointState,
      consecutiveFailures: 0,
      lastFailureAt: null,
      totalRequests: 0,
      totalFailures: 0,
      lastCheckedAt: null,
    }));

    logger.info(
      `[RpcPool] Initialized with ${this.endpoints.length} endpoint(s): ${urls.join(', ')}`,
    );
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Send a JSON-RPC request. Automatically retries on unhealthy/failing
   * endpoints until all are exhausted.
   */
  async request<T = unknown>(req: RpcRequest): Promise<RpcResponse<T>> {
    const tried = new Set<string>();
    const startIndex = this.currentIndex;

    // Try the current endpoint first, then the next healthy endpoints.
    // A failed initial endpoint should not rotate the pointer until a later
    // request succeeds, which preserves the circuit-breaker behavior.
    for (let offset = 0; offset < this.endpoints.length; offset++) {
      this.maybeRecoverEndpoints();

      const idx = (startIndex + offset) % this.endpoints.length;
      const endpoint = this.endpoints[idx];
      if (!endpoint || tried.has(endpoint.url) || endpoint.state !== 'healthy') {
        continue;
      }
      tried.add(endpoint.url);

      try {
        const response = await this.sendRequest<T>(endpoint, req);
        this.recordSuccess(endpoint);

        // Only advance the round-robin pointer when the initial endpoint succeeds.
        if (offset === 0) {
          this.currentIndex = (idx + 1) % this.endpoints.length;
        }

        return response;
      } catch (err) {
        logger.warn(
          `[RpcPool] Request failed on ${endpoint.url}: ${(err as Error).message}`,
        );
        this.recordFailure(endpoint);
      }
    }

    throw new Error(
      '[RpcPool] All RPC endpoints are unavailable or exhausted',
    );
  }

  /** Return a snapshot of all endpoint statuses (for /health) */
  getStatus(): EndpointStatus[] {
    this.maybeRecoverEndpoints();
    return this.endpoints.map((ep) => ({ ...ep }));
  }

  /** Return the URL of the currently selected healthy endpoint (if any) */
  get activeUrl(): string | null {
    this.maybeRecoverEndpoints();
    const ep = this.pickEndpoint();
    return ep ? ep.url : null;
  }

  /** Total number of configured endpoints */
  get size(): number {
    return this.endpoints.length;
  }

  /** Number of healthy endpoints */
  get healthyCount(): number {
    this.maybeRecoverEndpoints();
    return this.endpoints.filter((ep) => ep.state === 'healthy').length;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Pick the next healthy endpoint using round-robin. Skips unhealthy
   * endpoints unless recovery timeout has elapsed.
   */
  private pickEndpoint(): EndpointStatus | null {
    this.maybeRecoverEndpoints();

    const total = this.endpoints.length;
    for (let i = 0; i < total; i++) {
      const idx = (this.currentIndex + i) % total;
      const ep = this.endpoints[idx];
      if (ep.state === 'healthy') {
        this.currentIndex = idx;
        return ep;
      }
    }
    return null;
  }

  /** Advance the round-robin pointer */
  private advanceIndex(): void {
    this.currentIndex = (this.currentIndex + 1) % this.endpoints.length;
  }

  /** Restore endpoints whose recovery timeout has elapsed */
  private maybeRecoverEndpoints(): void {
    const now = Date.now();
    for (const ep of this.endpoints) {
      if (
        ep.state === 'unhealthy' &&
        ep.lastFailureAt !== null &&
        now - ep.lastFailureAt >= this.recoveryTimeoutMs
      ) {
        ep.state = 'healthy';
        ep.consecutiveFailures = 0;
        logger.info(`[RpcPool] Endpoint recovered: ${ep.url}`);
      }
    }
  }

  private recordSuccess(ep: EndpointStatus): void {
    ep.consecutiveFailures = 0;
    ep.totalRequests++;
    ep.lastCheckedAt = Date.now();
    if (ep.state !== 'healthy') {
      ep.state = 'healthy';
      logger.info(`[RpcPool] Endpoint back to healthy: ${ep.url}`);
    }
  }

  private recordFailure(ep: EndpointStatus): void {
    ep.consecutiveFailures++;
    ep.totalFailures++;
    ep.totalRequests++;
    ep.lastFailureAt = Date.now();
    ep.lastCheckedAt = Date.now();

    if (ep.consecutiveFailures >= this.failureThreshold) {
      ep.state = 'unhealthy';
      logger.warn(
        `[RpcPool] Circuit breaker OPEN for ${ep.url} ` +
          `(${ep.consecutiveFailures} consecutive failures). ` +
          `Will retry after ${this.recoveryTimeoutMs / 1000}s`,
      );
    }
  }

  /** Perform a single JSON-RPC POST with a timeout */
  private async sendRequest<T>(
    ep: EndpointStatus,
    req: RpcRequest,
  ): Promise<RpcResponse<T>> {
    const body = JSON.stringify({
      jsonrpc: '2.0',
      id: req.id ?? 1,
      method: req.method,
      params: req.params ?? [],
    });

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.requestTimeoutMs,
    );

    let res: Response;
    try {
      res = await fetch(ep.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    // Treat HTTP 429 (rate-limited) as a failure to trigger failover
    if (res.status === 429) {
      throw new Error(`HTTP 429 rate-limited by ${ep.url}`);
    }

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} from ${ep.url}`);
    }

    const json = (await res.json()) as RpcResponse<T>;

    // JSON-RPC level errors are NOT considered connection failures —
    // the endpoint responded correctly, just with an application error.
    return json;
  }
}

// ── Singleton factory ─────────────────────────────────────────────────────────

let _pool: RpcConnectionPool | null = null;

/**
 * Build (or return the cached) global RPC pool from environment variables.
 * Call once at startup; subsequent calls return the same instance.
 */
export function getRpcPool(): RpcConnectionPool {
  if (_pool) return _pool;

  const urls =
    process.env.STELLAR_RPC_URLS ||
    'https://soroban-testnet.stellar.org';

  _pool = new RpcConnectionPool({
    urls,
    failureThreshold: Number(process.env.RPC_FAILURE_THRESHOLD ?? 3),
    recoveryTimeoutMs: Number(
      process.env.RPC_RECOVERY_TIMEOUT_MS ?? 60_000,
    ),
    requestTimeoutMs: Number(
      process.env.RPC_REQUEST_TIMEOUT_MS ?? 10_000,
    ),
  });

  return _pool;
}

/** Reset the singleton — used in tests */
export function resetRpcPool(): void {
  _pool = null;
}
