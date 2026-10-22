/**
 * BE-66 — OpenTelemetry distributed tracing.
 *
 * Must be imported BEFORE any other module in src/index.ts so that
 * auto-instrumentations can patch Express, http, and Prisma clients.
 *
 * Environment variables:
 *   OTEL_SDK_DISABLED=true          — disables tracing entirely (zero overhead)
 *   OTEL_SAMPLING_RATE=0.0-1.0      — fraction of traces sampled (default 1.0)
 *   OTEL_EXPORTER_OTLP_ENDPOINT     — OTLP HTTP endpoint (default http://localhost:4318)
 *   OTEL_SERVICE_NAME               — service name override (default sorobanpay-backend)
 *
 * Issue #1077 additions:
 *   - TraceContext interface and Span type alias
 *   - extractTraceContext  — parse W3C traceparent/tracestate from HTTP headers
 *   - injectTraceContext   — serialise an active span into W3C propagation headers
 *   - withJobSpan          — wrap BullMQ job processors with a parented OTel span
 *   - redactSensitiveFields — mask sensitive attributes before they appear in spans
 */

import { NodeSDK } from '@opentelemetry/sdk-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-base';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { trace, context, SpanStatusCode, SpanKind } from '@opentelemetry/api';

export { trace, context, SpanStatusCode, SpanKind };

// ─── Public type aliases ──────────────────────────────────────────────────────

/**
 * Convenience alias for an OTel span instance.
 * Used so callers do not need to import from @opentelemetry/api directly.
 */
export type Span = ReturnType<ReturnType<typeof trace.getTracer>['startSpan']>;

/**
 * Parsed W3C Trace Context extracted from HTTP / job-data headers.
 *
 * @see https://www.w3.org/TR/trace-context/
 */
export interface TraceContext {
  /** 32 hex-char trace ID, or undefined when the header was absent/malformed. */
  traceId: string | undefined;
  /** 16 hex-char span ID, or undefined when the header was absent/malformed. */
  spanId: string | undefined;
  /** Trace-flags byte (bit 0 = sampled). 0 when absent/malformed. */
  traceFlags: number;
  /** Raw tracestate header value, or undefined when absent. */
  tracestate: string | undefined;
}

// ─── Tracer factory ───────────────────────────────────────────────────────────

// Re-export the tracer factory so services can get a named tracer.
export function getTracer(name: string) {
  return trace.getTracer(name, '1.0.0');
}

// ─── SDK lifecycle ────────────────────────────────────────────────────────────

let sdk: NodeSDK | null = null;

/**
 * Initialise and start the OpenTelemetry SDK.
 * Called once at process startup (top of index.ts).
 */
export function initTracing(): void {
  // Honour the standard OTEL_SDK_DISABLED env var.
  if (process.env.OTEL_SDK_DISABLED === 'true') {
    console.log('[tracing] OpenTelemetry SDK disabled (OTEL_SDK_DISABLED=true)');
    return;
  }

  const serviceName = process.env.OTEL_SERVICE_NAME ?? 'sorobanpay-backend';

  const samplingRate = parseFloat(process.env.OTEL_SAMPLING_RATE ?? '1.0');
  const clampedRate = Math.min(1.0, Math.max(0.0, isNaN(samplingRate) ? 1.0 : samplingRate));

  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://localhost:4318';

  const exporter = new OTLPTraceExporter({
    url: `${otlpEndpoint}/v1/traces`,
  });

  sdk = new NodeSDK({
    resource: new Resource({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: '1.0.0',
    }),
    sampler: new ParentBasedSampler({
      root: new TraceIdRatioBasedSampler(clampedRate),
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy fs instrumentation
        '@opentelemetry/instrumentation-fs': { enabled: false },
      }),
    ],
  });

  sdk.start();
  console.log(
    `[tracing] OpenTelemetry started — service: ${serviceName}, sampling: ${clampedRate}, endpoint: ${otlpEndpoint}`,
  );

  // Graceful shutdown on SIGTERM / SIGINT
  const shutdown = async (signal: string) => {
    if (!sdk) return;
    try {
      await sdk.shutdown();
      console.log(`[tracing] SDK shut down cleanly on ${signal}`);
    } catch (err) {
      console.error('[tracing] SDK shutdown error:', err);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

// ─── withSpan helper (original) ───────────────────────────────────────────────

/**
 * Wrap an async function in an OTel span.
 * Usage:
 *   await withSpan('my.operation', async (span) => { ... });
 */
export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  fn: (span: Span) => Promise<T>,
  options?: { kind?: SpanKind; attributes?: Record<string, string | number | boolean> },
): Promise<T> {
  const tracer = getTracer(tracerName);
  const span = tracer.startSpan(spanName, {
    kind: options?.kind ?? SpanKind.INTERNAL,
    attributes: options?.attributes,
  });

  try {
    const result = await context.with(trace.setSpan(context.active(), span), () => fn(span));
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    span.recordException(err as Error);
    throw err;
  } finally {
    span.end();
  }
}

// ─── Issue #1077: W3C Trace Context propagation ───────────────────────────────

/**
 * Sensitive field name substrings used by redactSensitiveFields.
 * Case-insensitive substring match is applied against each key name.
 */
const SENSITIVE_SUBSTRINGS = [
  'password',
  'secret',
  'token',
  'key',
  'auth',
  'credential',
] as const;

/**
 * Return a shallow copy of `obj` with sensitive field values replaced by
 * `"[REDACTED]"`.
 *
 * A field is considered sensitive when its lowercased name **contains** any of
 * the substrings in SENSITIVE_SUBSTRINGS.  Only top-level keys are inspected;
 * nested objects are not traversed.
 *
 * @example
 * redactSensitiveFields({ apiKey: 'abc', userId: '123' })
 * // → { apiKey: '[REDACTED]', userId: '123' }
 */
export function redactSensitiveFields(
  obj: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    const lower = k.toLowerCase();
    const sensitive = SENSITIVE_SUBSTRINGS.some((sub) => lower.includes(sub));
    result[k] = sensitive ? '[REDACTED]' : v;
  }
  return result;
}

/**
 * Parse a W3C `traceparent` header and optional `tracestate` header into a
 * {@link TraceContext} object.
 *
 * W3C traceparent format: `{version}-{traceId}-{parentId}-{traceFlags}`
 *   - version:    2 hex chars (always "00" for current spec)
 *   - traceId:   32 hex chars
 *   - parentId:  16 hex chars (the span ID of the upstream caller)
 *   - traceFlags: 2 hex chars (bit 0 = sampled)
 *
 * Returns safe defaults (all undefined, flags = 0) when the header is absent
 * or malformed — never throws.
 *
 * @param headers  HTTP request headers or BullMQ job-data propagation headers.
 */
export function extractTraceContext(
  headers: Record<string, string | string[] | undefined>,
): TraceContext {
  const empty: TraceContext = {
    traceId:    undefined,
    spanId:     undefined,
    traceFlags: 0,
    tracestate: undefined,
  };

  try {
    const rawTraceparent = headers['traceparent'];
    const traceparent = Array.isArray(rawTraceparent)
      ? rawTraceparent[0]
      : rawTraceparent;

    if (!traceparent) return empty;

    const parts = traceparent.split('-');
    // Must have exactly 4 segments
    if (parts.length !== 4) return empty;

    const [_version, traceId, spanId, flagsHex] = parts;

    // Validate lengths per the W3C spec
    if (
      typeof traceId !== 'string' || traceId.length !== 32 ||
      typeof spanId !== 'string' || spanId.length !== 16 ||
      typeof flagsHex !== 'string' || flagsHex.length !== 2
    ) {
      return empty;
    }

    // All-zero traceId is invalid per the spec
    if (/^0{32}$/.test(traceId)) return empty;

    const traceFlags = parseInt(flagsHex, 16);
    if (isNaN(traceFlags)) return empty;

    const rawTracestate = headers['tracestate'];
    const tracestate = Array.isArray(rawTracestate)
      ? rawTracestate.join(',')
      : rawTracestate;

    return {
      traceId,
      spanId,
      traceFlags,
      tracestate: tracestate || undefined,
    };
  } catch {
    return empty;
  }
}

/**
 * Serialise an active OTel span's context into W3C `traceparent` (and
 * optionally `tracestate`) propagation headers.
 *
 * The returned object can be:
 *   - Attached to BullMQ job data under `_traceContext` for downstream jobs.
 *   - Forwarded as HTTP headers to outbound webhook requests.
 *
 * @param span  An active OTel span (e.g. obtained from `withSpan` or `withJobSpan`).
 * @returns     An object with at least a `traceparent` key.
 */
export function injectTraceContext(span: Span): Record<string, string> {
  const ctx = span.spanContext();
  // Format: 00-{32-char traceId}-{16-char spanId}-{2-char flags}
  const flags = ctx.traceFlags.toString(16).padStart(2, '0');
  const traceparent = `00-${ctx.traceId}-${ctx.spanId}-${flags}`;

  const headers: Record<string, string> = { traceparent };

  // Include tracestate when present (vendor-specific propagation data)
  if (ctx.traceState) {
    const serialised = ctx.traceState.serialize();
    if (serialised) {
      headers['tracestate'] = serialised;
    }
  }

  return headers;
}

/**
 * Wrap a BullMQ job processor function in an OTel span, restoring the
 * upstream trace context carried in `jobData._traceContext` so that the job
 * span is correctly parented to the producer span.
 *
 * Sensitive fields in `jobData` are automatically redacted before they are
 * recorded as span attributes (see {@link redactSensitiveFields}).
 *
 * ## Usage
 * ```ts
 * // In your BullMQ worker processor:
 * async processor(job: Job) {
 *   return withJobSpan('retry-queue', job.name, job.data, async (span) => {
 *     // ... your job logic here, span is active in context ...
 *   });
 * }
 * ```
 *
 * ## Trace context propagation
 * When the BullMQ producer calls {@link injectTraceContext} and stores the
 * result in `job.data._traceContext`, this function reads those headers and
 * re-creates the parent context so the job span appears as a child of the
 * producer span in your tracing backend (Jaeger, Zipkin, Honeycomb, etc.).
 *
 * @param queueName  Name of the BullMQ queue (used as OTel tracer name).
 * @param jobName    Name of the job (used as OTel span name).
 * @param jobData    Arbitrary job data; `_traceContext` key is reserved for
 *                   W3C propagation headers.
 * @param fn         Async function that performs the job work.
 */
export async function withJobSpan<T>(
  queueName: string,
  jobName: string,
  jobData: Record<string, unknown>,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer(queueName);

  // Extract and redact job data attributes (excluding the internal _traceContext key)
  const { _traceContext, ...publicData } = jobData as Record<string, unknown> & {
    _traceContext?: Record<string, string | string[] | undefined>;
  };
  const safeAttributes = redactSensitiveFields(
    Object.fromEntries(
      Object.entries(publicData).map(([k, v]) => [
        k,
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
          ? v
          : JSON.stringify(v),
      ]),
    ) as Record<string, unknown>,
  ) as Record<string, string | number | boolean>;

  // Restore parent context from _traceContext headers when present.
  // We reconstruct a remote SpanContext so the job span is correctly parented
  // to the producer span in the tracing backend.
  let parentContext = context.active();
  if (_traceContext && typeof _traceContext === 'object') {
    const parsed = extractTraceContext(
      _traceContext as Record<string, string | string[] | undefined>,
    );
    if (parsed.traceId && parsed.spanId) {
      const remoteSpanCtx = {
        traceId:    parsed.traceId,
        spanId:     parsed.spanId,
        traceFlags: parsed.traceFlags,
        isRemote:   true,
      };
      parentContext = trace.setSpanContext(context.active(), remoteSpanCtx);
    }
  }

  const span = tracer.startSpan(
    `job.${jobName}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        'messaging.system': 'bullmq',
        'messaging.destination': queueName,
        'messaging.operation': 'process',
        ...safeAttributes,
      },
    },
    parentContext,
  );

  try {
    const result = await context.with(
      trace.setSpan(parentContext, span),
      () => fn(span),
    );
    span.setStatus({ code: SpanStatusCode.OK });
    return result;
  } catch (err) {
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: err instanceof Error ? err.message : String(err),
    });
    span.recordException(err as Error);
    throw err;
  } finally {
    span.end();
  }
}
