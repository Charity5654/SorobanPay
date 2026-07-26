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

// Re-export the tracer factory so services can get a named tracer.
export function getTracer(name: string) {
  return trace.getTracer(name, '1.0.0');
}

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

/**
 * Wrap an async function in an OTel span.
 * Usage:
 *   await withSpan('my.operation', async (span) => { ... });
 */
export async function withSpan<T>(
  tracerName: string,
  spanName: string,
  fn: (span: ReturnType<ReturnType<typeof trace.getTracer>['startSpan']>) => Promise<T>,
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
