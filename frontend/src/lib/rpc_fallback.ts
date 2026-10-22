"use client";

/**
 * rpc_fallback.ts
 *
 * RPC endpoint fallback mechanism to retry via alternate Soroban nodes
 * if the primary endpoint is unavailable.
 *
 * Issue #40: Add support for fetch-based RPC endpoint fallback
 */

import * as SorobanRpc from "@stellar/js-sdk/rpc";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RpcEndpoint {
  /** Endpoint URL */
  url: string;
  /** Priority (lower = higher priority) */
  priority: number;
  /** Whether this endpoint is currently available */
  available: boolean;
  /** Last check timestamp */
  lastChecked?: number;
}

export interface RpcFallbackConfig {
  /** Primary RPC endpoint */
  primary: string;
  /** Fallback endpoints (in priority order) */
  fallbacks: string[];
  /** Health check timeout in milliseconds */
  healthCheckTimeoutMs?: number;
  /** How long to cache availability status (milliseconds) */
  cacheExpiryMs?: number;
}

export interface RpcCallResult<T> {
  /** Result from RPC call */
  data: T;
  /** Which endpoint was used */
  usedEndpoint: string;
  /** Number of retries before success */
  retries: number;
}

// ─── Configuration ────────────────────────────────────────────────────────────

const DEFAULT_HEALTH_CHECK_TIMEOUT_MS = 5000;
const DEFAULT_CACHE_EXPIRY_MS = 60000; // 1 minute

// ─── State ────────────────────────────────────────────────────────────────────

class RpcFallbackManager {
  private endpoints: Map<string, RpcEndpoint> = new Map();
  private primaryEndpoint: string;
  private config: RpcFallbackConfig;

  constructor(config: RpcFallbackConfig) {
    this.config = {
      healthCheckTimeoutMs: DEFAULT_HEALTH_CHECK_TIMEOUT_MS,
      cacheExpiryMs: DEFAULT_CACHE_EXPIRY_MS,
      ...config,
    };
    this.primaryEndpoint = config.primary;

    // Initialize endpoint map
    this.endpoints.set(config.primary, {
      url: config.primary,
      priority: 0,
      available: true,
    });

    config.fallbacks.forEach((url, index) => {
      this.endpoints.set(url, {
        url,
        priority: index + 1,
        available: true,
      });
    });
  }

  /**
   * Get all endpoints sorted by priority
   */
  private getEndpointsByPriority(): RpcEndpoint[] {
    return Array.from(this.endpoints.values())
      .filter((ep) => this.isEndpointAvailable(ep))
      .sort((a, b) => a.priority - b.priority);
  }

  /**
   * Check if endpoint is available (considering cache)
   */
  private isEndpointAvailable(endpoint: RpcEndpoint): boolean {
    if (!endpoint.available) {
      // Check if cache expired
      if (endpoint.lastChecked) {
        const now = Date.now();
        const expiry = this.config.cacheExpiryMs!;
        if (now - endpoint.lastChecked > expiry) {
          // Cache expired, consider it available again
          endpoint.available = true;
        }
      }
    }
    return endpoint.available;
  }

  /**
   * Mark endpoint as unavailable
   */
  private markUnavailable(url: string): void {
    const ep = this.endpoints.get(url);
    if (ep) {
      ep.available = false;
      ep.lastChecked = Date.now();
    }
  }

  /**
   * Health check: Test if RPC endpoint is reachable
   */
  private async healthCheckEndpoint(url: string): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        this.config.healthCheckTimeoutMs!,
      );

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getHealth",
          params: [],
        }),
        signal: controller.signal,
      });

      clearTimeout(timeout);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Create a Soroban RPC server for an endpoint
   */
  private createServer(url: string): SorobanRpc.Server {
    return new SorobanRpc.Server(url, { allowHttp: false });
  }

  /**
   * Execute an RPC call with automatic fallback
   */
  async executeWithFallback<T>(
    operation: (server: SorobanRpc.Server) => Promise<T>,
  ): Promise<RpcCallResult<T>> {
    const endpoints = this.getEndpointsByPriority();

    if (endpoints.length === 0) {
      throw new Error("No RPC endpoints available");
    }

    let lastError: Error | null = null;
    let retryCount = 0;

    for (const endpoint of endpoints) {
      try {
        const server = this.createServer(endpoint.url);
        const result = await operation(server);

        return {
          data: result,
          usedEndpoint: endpoint.url,
          retries: retryCount,
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.markUnavailable(endpoint.url);
        retryCount++;

        console.warn(
          `[RpcFallback] Endpoint ${endpoint.url} failed: ${lastError.message}. Trying next...`,
        );
      }
    }

    // All endpoints failed
    throw new Error(
      `All RPC endpoints failed. Last error: ${lastError?.message}`,
    );
  }

  /**
   * Get current primary endpoint
   */
  getPrimary(): string {
    return this.primaryEndpoint;
  }

  /**
   * Get all configured endpoints
   */
  getAllEndpoints(): string[] {
    return [this.primaryEndpoint, ...this.config.fallbacks];
  }

  /**
   * Get status of all endpoints
   */
  getStatus(): Array<{
    url: string;
    available: boolean;
    priority: number;
  }> {
    return Array.from(this.endpoints.values()).map((ep) => ({
      url: ep.url,
      available: this.isEndpointAvailable(ep),
      priority: ep.priority,
    }));
  }

  /**
   * Reset availability status (useful for testing)
   */
  resetStatus(): void {
    this.endpoints.forEach((ep) => {
      ep.available = true;
      ep.lastChecked = undefined;
    });
  }
}

// ─── Singleton Instance ────────────────────────────────────────────────────────

let fallbackManager: RpcFallbackManager | null = null;

/**
 * Initialize the RPC fallback manager with configuration
 */
export function initializeRpcFallback(config: RpcFallbackConfig): void {
  fallbackManager = new RpcFallbackManager(config);
}

/**
 * Get the RPC fallback manager instance
 */
export function getRpcFallbackManager(): RpcFallbackManager {
  if (!fallbackManager) {
    throw new Error(
      "RPC fallback not initialized. Call initializeRpcFallback() first.",
    );
  }
  return fallbackManager;
}

/**
 * Execute RPC operation with automatic fallback
 */
export async function executeRpcWithFallback<T>(
  operation: (server: SorobanRpc.Server) => Promise<T>,
): Promise<RpcCallResult<T>> {
  const manager = getRpcFallbackManager();
  return manager.executeWithFallback(operation);
}

/**
 * Get RPC endpoint status
 */
export function getRpcEndpointStatus(): Array<{
  url: string;
  available: boolean;
  priority: number;
}> {
  try {
    const manager = getRpcFallbackManager();
    return manager.getStatus();
  } catch {
    return [];
  }
}

// ─── Helper: Create fallback config from env ────────────────────────────────────

/**
 * Create RPC fallback config from environment variables
 * Expects: PRIMARY_RPC, FALLBACK_RPC_1, FALLBACK_RPC_2, etc.
 */
export function createRpcFallbackConfigFromEnv(): RpcFallbackConfig {
  const primary =
    process.env.NEXT_PUBLIC_RPC_URL ||
    "https://soroban-testnet.stellar.org";

  // Collect fallback endpoints from env
  const fallbacks: string[] = [];
  const fallbackEnvVars = [
    process.env.NEXT_PUBLIC_FALLBACK_RPC_1,
    process.env.NEXT_PUBLIC_FALLBACK_RPC_2,
    process.env.NEXT_PUBLIC_FALLBACK_RPC_3,
  ].filter((url) => url);

  fallbacks.push(...fallbackEnvVars);

  // If no fallbacks, use a default fallback
  if (fallbacks.length === 0) {
    fallbacks.push("https://soroban-mainnet.stellar.org");
  }

  return {
    primary,
    fallbacks,
    healthCheckTimeoutMs: 5000,
    cacheExpiryMs: 60000,
  };
}
