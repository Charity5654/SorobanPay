"use client";

/**
 * contract_metrics.ts
 *
 * Dedicated metrics and instrumentation for contract calls.
 * Tracks success/failure rates, latency, and error categories.
 *
 * Issue #38: Add dedicated contract call metrics instrumentation
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export enum ContractCallType {
  SUBSCRIBE = "subscribe",
  CANCEL = "cancel",
  PAUSE = "pause",
  RESUME = "resume",
  QUERY = "query",
  UPDATE = "update",
  OTHER = "other",
}

export enum ContractCallStatus {
  SUCCESS = "success",
  FAILURE = "failure",
  TIMEOUT = "timeout",
  USER_REJECTED = "user_rejected",
  NETWORK_ERROR = "network_error",
  VALIDATION_ERROR = "validation_error",
}

export interface ContractCallMetrics {
  /** Call type */
  type: ContractCallType;
  /** Call status */
  status: ContractCallStatus;
  /** Duration in milliseconds */
  durationMs: number;
  /** Timestamp when call started */
  startedAt: number;
  /** Error message if failed */
  errorMessage?: string;
  /** Error category for classification */
  errorCategory?: string;
  /** RPC endpoint used */
  rpcEndpoint?: string;
  /** Number of retries */
  retries?: number;
}

export interface ContractMetricsAggregate {
  /** Total calls */
  totalCalls: number;
  /** Successful calls */
  successfulCalls: number;
  /** Failed calls */
  failedCalls: number;
  /** Success rate percentage */
  successRate: number;
  /** Average latency in ms */
  averageLatencyMs: number;
  /** P95 latency in ms */
  p95LatencyMs: number;
  /** P99 latency in ms */
  p99LatencyMs: number;
  /** Error breakdown by category */
  errorsByCategory: Record<string, number>;
  /** Calls by status */
  callsByStatus: Record<ContractCallStatus, number>;
}

// ─── Metrics Collection ────────────────────────────────────────────────────────

class ContractMetricsCollector {
  private metrics: ContractCallMetrics[] = [];
  private maxMetrics = 1000; // Keep last 1000 metrics in memory

  /**
   * Record a contract call metric
   */
  recordCall(metric: ContractCallMetrics): void {
    this.metrics.push(metric);

    // Keep only last N metrics
    if (this.metrics.length > this.maxMetrics) {
      this.metrics = this.metrics.slice(-this.maxMetrics);
    }

    // Log to console in development
    if (process.env.NODE_ENV === "development") {
      console.log(
        `[ContractMetrics] ${metric.type} ${metric.status} (${metric.durationMs}ms)`,
        metric,
      );
    }
  }

  /**
   * Get all recorded metrics
   */
  getMetrics(): ContractCallMetrics[] {
    return [...this.metrics];
  }

  /**
   * Get metrics for a specific call type
   */
  getMetricsForType(type: ContractCallType): ContractCallMetrics[] {
    return this.metrics.filter((m) => m.type === type);
  }

  /**
   * Get metrics aggregated by status
   */
  getMetricsForStatus(status: ContractCallStatus): ContractCallMetrics[] {
    return this.metrics.filter((m) => m.status === status);
  }

  /**
   * Get aggregated metrics
   */
  getAggregate(): ContractMetricsAggregate {
    const total = this.metrics.length;

    if (total === 0) {
      return {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        successRate: 0,
        averageLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        errorsByCategory: {},
        callsByStatus: {
          [ContractCallStatus.SUCCESS]: 0,
          [ContractCallStatus.FAILURE]: 0,
          [ContractCallStatus.TIMEOUT]: 0,
          [ContractCallStatus.USER_REJECTED]: 0,
          [ContractCallStatus.NETWORK_ERROR]: 0,
          [ContractCallStatus.VALIDATION_ERROR]: 0,
        },
      };
    }

    // Count by status
    const callsByStatus: Record<ContractCallStatus, number> = {
      [ContractCallStatus.SUCCESS]: 0,
      [ContractCallStatus.FAILURE]: 0,
      [ContractCallStatus.TIMEOUT]: 0,
      [ContractCallStatus.USER_REJECTED]: 0,
      [ContractCallStatus.NETWORK_ERROR]: 0,
      [ContractCallStatus.VALIDATION_ERROR]: 0,
    };

    const errorsByCategory: Record<string, number> = {};
    const latencies: number[] = [];

    for (const metric of this.metrics) {
      callsByStatus[metric.status]++;
      latencies.push(metric.durationMs);

      if (metric.errorCategory) {
        errorsByCategory[metric.errorCategory] =
          (errorsByCategory[metric.errorCategory] || 0) + 1;
      }
    }

    // Calculate latency percentiles
    const sortedLatencies = latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);

    const successfulCalls = callsByStatus[ContractCallStatus.SUCCESS];
    const failedCalls = total - successfulCalls;

    return {
      totalCalls: total,
      successfulCalls,
      failedCalls,
      successRate: (successfulCalls / total) * 100,
      averageLatencyMs: latencies.reduce((a, b) => a + b, 0) / total,
      p95LatencyMs: sortedLatencies[p95Index] || 0,
      p99LatencyMs: sortedLatencies[p99Index] || 0,
      errorsByCategory,
      callsByStatus,
    };
  }

  /**
   * Get aggregated metrics for a specific call type
   */
  getAggregateForType(type: ContractCallType): ContractMetricsAggregate {
    const typeMetrics = this.getMetricsForType(type);
    const total = typeMetrics.length;

    if (total === 0) {
      return {
        totalCalls: 0,
        successfulCalls: 0,
        failedCalls: 0,
        successRate: 0,
        averageLatencyMs: 0,
        p95LatencyMs: 0,
        p99LatencyMs: 0,
        errorsByCategory: {},
        callsByStatus: {
          [ContractCallStatus.SUCCESS]: 0,
          [ContractCallStatus.FAILURE]: 0,
          [ContractCallStatus.TIMEOUT]: 0,
          [ContractCallStatus.USER_REJECTED]: 0,
          [ContractCallStatus.NETWORK_ERROR]: 0,
          [ContractCallStatus.VALIDATION_ERROR]: 0,
        },
      };
    }

    // Count by status
    const callsByStatus: Record<ContractCallStatus, number> = {
      [ContractCallStatus.SUCCESS]: 0,
      [ContractCallStatus.FAILURE]: 0,
      [ContractCallStatus.TIMEOUT]: 0,
      [ContractCallStatus.USER_REJECTED]: 0,
      [ContractCallStatus.NETWORK_ERROR]: 0,
      [ContractCallStatus.VALIDATION_ERROR]: 0,
    };

    const errorsByCategory: Record<string, number> = {};
    const latencies: number[] = [];

    for (const metric of typeMetrics) {
      callsByStatus[metric.status]++;
      latencies.push(metric.durationMs);

      if (metric.errorCategory) {
        errorsByCategory[metric.errorCategory] =
          (errorsByCategory[metric.errorCategory] || 0) + 1;
      }
    }

    // Calculate latency percentiles
    const sortedLatencies = latencies.sort((a, b) => a - b);
    const p95Index = Math.floor(sortedLatencies.length * 0.95);
    const p99Index = Math.floor(sortedLatencies.length * 0.99);

    const successfulCalls = callsByStatus[ContractCallStatus.SUCCESS];
    const failedCalls = total - successfulCalls;

    return {
      totalCalls: total,
      successfulCalls,
      failedCalls,
      successRate: (successfulCalls / total) * 100,
      averageLatencyMs: latencies.reduce((a, b) => a + b, 0) / total,
      p95LatencyMs: sortedLatencies[p95Index] || 0,
      p99LatencyMs: sortedLatencies[p99Index] || 0,
      errorsByCategory,
      callsByStatus,
    };
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics = [];
  }

  /**
   * Export metrics as JSON
   */
  export(): string {
    return JSON.stringify({
      metrics: this.metrics,
      aggregate: this.getAggregate(),
      timestamp: new Date().toISOString(),
    });
  }
}

// ─── Singleton Instance ────────────────────────────────────────────────────────

let metricsCollector: ContractMetricsCollector | null = null;

/**
 * Get metrics collector instance (singleton)
 */
export function getMetricsCollector(): ContractMetricsCollector {
  if (!metricsCollector) {
    metricsCollector = new ContractMetricsCollector();
  }
  return metricsCollector;
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a contract call metric
 */
export function recordContractCall(metric: ContractCallMetrics): void {
  getMetricsCollector().recordCall(metric);
}

/**
 * Get all recorded metrics
 */
export function getContractMetrics(): ContractCallMetrics[] {
  return getMetricsCollector().getMetrics();
}

/**
 * Get aggregated metrics
 */
export function getContractMetricsAggregate(): ContractMetricsAggregate {
  return getMetricsCollector().getAggregate();
}

/**
 * Get aggregated metrics for specific call type
 */
export function getContractMetricsForType(
  type: ContractCallType,
): ContractMetricsAggregate {
  return getMetricsCollector().getAggregateForType(type);
}

/**
 * Clear all metrics (useful for testing)
 */
export function clearContractMetrics(): void {
  getMetricsCollector().clear();
}

/**
 * Export metrics as JSON string
 */
export function exportContractMetrics(): string {
  return getMetricsCollector().export();
}

// ─── Helper: Measure function execution ────────────────────────────────────────

/**
 * Decorator/helper to measure contract call execution time and record metrics
 */
export async function measureContractCall<T>(
  type: ContractCallType,
  fn: () => Promise<T>,
  options?: {
    rpcEndpoint?: string;
    retries?: number;
  },
): Promise<T> {
  const startedAt = Date.now();

  try {
    const result = await fn();

    recordContractCall({
      type,
      status: ContractCallStatus.SUCCESS,
      durationMs: Date.now() - startedAt,
      startedAt,
      rpcEndpoint: options?.rpcEndpoint,
      retries: options?.retries,
    });

    return result;
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message.toLowerCase();

    // Classify error
    let status = ContractCallStatus.FAILURE;
    let errorCategory = "unknown";

    if (message.includes("timeout")) {
      status = ContractCallStatus.TIMEOUT;
      errorCategory = "timeout";
    } else if (message.includes("rejected") || message.includes("denied")) {
      status = ContractCallStatus.USER_REJECTED;
      errorCategory = "user_action";
    } else if (message.includes("network") || message.includes("offline")) {
      status = ContractCallStatus.NETWORK_ERROR;
      errorCategory = "network";
    } else if (message.includes("invalid") || message.includes("validation")) {
      status = ContractCallStatus.VALIDATION_ERROR;
      errorCategory = "validation";
    }

    recordContractCall({
      type,
      status,
      durationMs: Date.now() - startedAt,
      startedAt,
      errorMessage: err.message,
      errorCategory,
      rpcEndpoint: options?.rpcEndpoint,
      retries: options?.retries,
    });

    throw error;
  }
}
