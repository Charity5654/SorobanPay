/**
 * BE-75 — Prometheus metrics service.
 *
 * Lightweight in-process metrics registry. Exposes:
 *   indexer_lag_seconds            gauge    — seconds behind chain tip
 *   events_processed_total         counter  — total on-chain events indexed
 *   webhook_delivery_total{status} counter  — webhook deliveries by outcome
 *   rpc_poll_total{status}         counter  — RPC poll attempts by outcome
 *   http_requests_total{method,route,status} counter — HTTP request count
 *
 * For production deployments, replace this with the official
 * `prom-client` package for histogram and summary support.
 */

type LabelSet = Record<string, string | number>;

interface Counter {
  type: 'counter';
  help: string;
  values: Map<string, number>;
}

interface Gauge {
  type: 'gauge';
  help: string;
  values: Map<string, number>;
}

type Metric = Counter | Gauge;

const registry = new Map<string, Metric>();

function labelKey(labels?: LabelSet): string {
  if (!labels || Object.keys(labels).length === 0) return '__default__';
  return Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
}

function formatLabels(labels?: LabelSet): string {
  if (!labels || Object.keys(labels).length === 0) return '';
  const pairs = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}="${v}"`)
    .join(',');
  return `{${pairs}}`;
}

// ─── Registration ──────────────────────────────────────────────────────────

function registerCounter(name: string, help: string): Counter {
  if (!registry.has(name)) {
    registry.set(name, { type: 'counter', help, values: new Map() });
  }
  return registry.get(name) as Counter;
}

function registerGauge(name: string, help: string): Gauge {
  if (!registry.has(name)) {
    registry.set(name, { type: 'gauge', help, values: new Map() });
  }
  return registry.get(name) as Gauge;
}

// ─── Pre-register all metrics ──────────────────────────────────────────────

registerGauge(
  'indexer_lag_seconds',
  'Seconds between the last successful RPC poll and now.',
);
registerCounter(
  'events_processed_total',
  'Total number of on-chain contract events indexed.',
);
registerCounter(
  'webhook_delivery_total',
  'Total webhook delivery attempts partitioned by status (success|failure).',
);
registerCounter(
  'rpc_poll_total',
  'Total Soroban RPC poll attempts partitioned by status (success|error).',
);
registerCounter(
  'http_requests_total',
  'Total HTTP requests partitioned by method, route, and status code.',
);

// ─── Public API ────────────────────────────────────────────────────────────

/** Increment a counter by `amount` (default 1). */
export function incrementCounter(
  name: string,
  labels?: LabelSet,
  amount = 1,
): void {
  const metric = registry.get(name) as Counter | undefined;
  if (!metric || metric.type !== 'counter') return;
  const key = labelKey(labels);
  metric.values.set(key, (metric.values.get(key) ?? 0) + amount);
}

/** Set a gauge to an absolute value. */
export function setGauge(name: string, value: number, labels?: LabelSet): void {
  const metric = registry.get(name) as Gauge | undefined;
  if (!metric || metric.type !== 'gauge') return;
  const key = labelKey(labels);
  metric.values.set(key, value);
}

/**
 * Render all metrics in Prometheus text exposition format (v0.0.4).
 * https://prometheus.io/docs/instrumenting/exposition_formats/
 */
export function getPrometheusMetrics(): string {
  const lines: string[] = [];

  for (const [name, metric] of registry.entries()) {
    lines.push(`# HELP ${name} ${metric.help}`);
    lines.push(`# TYPE ${name} ${metric.type}`);

    for (const [key, value] of metric.values.entries()) {
      if (key === '__default__') {
        lines.push(`${name} ${value}`);
      } else {
        lines.push(`${name}{${key}} ${value}`);
      }
    }
  }

  // Always end with a trailing newline
  return lines.join('\n') + '\n';
}

/**
 * Convenience: record an HTTP request.
 * Called from an Express middleware or after-response hook.
 */
export function recordHttpRequest(
  method: string,
  route: string,
  statusCode: number,
): void {
  incrementCounter('http_requests_total', {
    method: method.toUpperCase(),
    route,
    status: String(statusCode),
  });
}
