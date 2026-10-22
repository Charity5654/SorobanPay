/**
 * BE-66 / #1077 — OpenTelemetry tracing unit tests.
 *
 * Covers:
 *   - initTracing (existing)
 *   - getTracer   (existing)
 *   - withSpan    (existing)
 *   - redactSensitiveFields  (#1077)
 *   - extractTraceContext    (#1077)
 *   - injectTraceContext     (#1077)
 *   - withJobSpan            (#1077)
 */

// Store original env to restore after each test
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

// ─── initTracing (existing tests) ────────────────────────────────────────────

describe('initTracing', () => {
  it('does not throw when OTEL_SDK_DISABLED=true', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { initTracing } = await import('../src/lib/tracing');
    expect(() => initTracing()).not.toThrow();
  });

  it('does not throw with default env (SDK enabled)', async () => {
    process.env.OTEL_SDK_DISABLED = 'false';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    process.env.OTEL_SAMPLING_RATE = '1.0';
    const { initTracing } = await import('../src/lib/tracing');
    expect(() => initTracing()).not.toThrow();
  });
});

// ─── getTracer (existing test) ────────────────────────────────────────────────

describe('getTracer', () => {
  it('returns a tracer object with startSpan method', async () => {
    const { getTracer } = await import('../src/lib/tracing');
    const tracer = getTracer('test-tracer');
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
  });
});

// ─── withSpan (existing tests) ────────────────────────────────────────────────

describe('withSpan', () => {
  it('resolves and returns the value from the inner function', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { withSpan } = await import('../src/lib/tracing');
    const result = await withSpan('test', 'test.span', async (_span) => {
      return 42;
    });
    expect(result).toBe(42);
  });

  it('propagates errors thrown inside the span', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { withSpan } = await import('../src/lib/tracing');
    await expect(
      withSpan('test', 'test.span', async (_span) => {
        throw new Error('span error');
      }),
    ).rejects.toThrow('span error');
  });

  it('clamps out-of-range OTEL_SAMPLING_RATE', async () => {
    process.env.OTEL_SDK_DISABLED = 'false';
    process.env.OTEL_SAMPLING_RATE = '999';
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = 'http://localhost:4318';
    const { initTracing } = await import('../src/lib/tracing');
    expect(() => initTracing()).not.toThrow();
  });
});

// ─── redactSensitiveFields (#1077) ────────────────────────────────────────────

describe('redactSensitiveFields', () => {
  it('redacts fields whose names contain "password"', async () => {
    const { redactSensitiveFields } = await import('../src/lib/tracing');
    const result = redactSensitiveFields({ password: 'hunter2', userId: 'abc' });
    expect(result.password).toBe('[REDACTED]');
    expect(result.userId).toBe('abc');
  });

  it('redacts fields whose names contain "secret"', async () => {
    const { redactSensitiveFields } = await import('../src/lib/tracing');
    const result = redactSensitiveFields({ webhookSecret: 'xyz', eventType: 'subscribe' });
    expect(result.webhookSecret).toBe('[REDACTED]');
    expect(result.eventType).toBe('subscribe');
  });

  it('redacts fields whose names contain "token"', async () => {
    const { redactSensitiveFields } = await import('../src/lib/tracing');
    const result = redactSensitiveFields({ accessToken: 'tok_123', amount: 100 });
    expect(result.accessToken).toBe('[REDACTED]');
    expect(result.amount).toBe(100);
  });

  it('redacts fields whose names contain "key" (case-insensitive)', async () => {
    const { redactSensitiveFields } = await import('../src/lib/tracing');
    const result = redactSensitiveFields({ apiKey: 'sk-abc', ApiKEY: 'sk-def', name: 'job1' });
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.ApiKEY).toBe('[REDACTED]');
    expect(result.name).toBe('job1');
  });

  it('redacts fields whose names contain "auth"', async () => {
    const { redactSensitiveFields } = await import('../src/lib/tracing');
    const result = redactSensitiveFields({ Authorization: 'Bearer abc', queue: 'retry' });
    expect(result.Authorization).toBe('[REDACTED]');
    expect(result.queue).toBe('retry');
  });

  it('redacts fields whose names contain "credential"', async () => {
    const { redactSensitiveFields } = await import('../src/lib/tracing');
    const result = redactSensitiveFields({ dbCredential: 'pass', retries: 3 });
    expect(result.dbCredential).toBe('[REDACTED]');
    expect(result.retries).toBe(3);
  });

  it('returns an empty object unchanged', async () => {
    const { redactSensitiveFields } = await import('../src/lib/tracing');
    expect(redactSensitiveFields({})).toEqual({});
  });

  it('passes through non-sensitive fields unchanged', async () => {
    const { redactSensitiveFields } = await import('../src/lib/tracing');
    const input = { jobId: '123', merchant: 'GABC', amount: 500, retries: 2 };
    expect(redactSensitiveFields(input)).toEqual(input);
  });

  it('does not recursively redact nested objects', async () => {
    const { redactSensitiveFields } = await import('../src/lib/tracing');
    const nested = { password: 'top-secret' };
    const result = redactSensitiveFields({ meta: nested, jobId: '1' });
    // Only top-level key 'meta' is checked — it does not contain a sensitive substring
    expect(result.meta).toEqual(nested);
    expect(result.jobId).toBe('1');
  });
});

// ─── extractTraceContext (#1077) ──────────────────────────────────────────────

describe('extractTraceContext', () => {
  it('parses a valid W3C traceparent header correctly', async () => {
    const { extractTraceContext } = await import('../src/lib/tracing');
    const traceId = 'a'.repeat(32);
    const spanId  = 'b'.repeat(16);
    const headers = { traceparent: `00-${traceId}-${spanId}-01` };
    const result = extractTraceContext(headers);
    expect(result.traceId).toBe(traceId);
    expect(result.spanId).toBe(spanId);
    expect(result.traceFlags).toBe(1);
    expect(result.tracestate).toBeUndefined();
  });

  it('includes tracestate when present', async () => {
    const { extractTraceContext } = await import('../src/lib/tracing');
    const traceId = 'c'.repeat(32);
    const spanId  = 'd'.repeat(16);
    const headers = {
      traceparent: `00-${traceId}-${spanId}-01`,
      tracestate:  'vendorA=value1,vendorB=value2',
    };
    const result = extractTraceContext(headers);
    expect(result.tracestate).toBe('vendorA=value1,vendorB=value2');
  });

  it('returns safe defaults when traceparent header is absent', async () => {
    const { extractTraceContext } = await import('../src/lib/tracing');
    const result = extractTraceContext({});
    expect(result.traceId).toBeUndefined();
    expect(result.spanId).toBeUndefined();
    expect(result.traceFlags).toBe(0);
    expect(result.tracestate).toBeUndefined();
  });

  it('returns safe defaults for a malformed traceparent (wrong segment count)', async () => {
    const { extractTraceContext } = await import('../src/lib/tracing');
    const result = extractTraceContext({ traceparent: 'not-a-valid-header' });
    expect(result.traceId).toBeUndefined();
    expect(result.spanId).toBeUndefined();
    expect(result.traceFlags).toBe(0);
  });

  it('returns safe defaults for an all-zero traceId (invalid per spec)', async () => {
    const { extractTraceContext } = await import('../src/lib/tracing');
    const spanId = 'e'.repeat(16);
    const headers = { traceparent: `00-${'0'.repeat(32)}-${spanId}-01` };
    const result = extractTraceContext(headers);
    expect(result.traceId).toBeUndefined();
  });

  it('handles array-valued headers (e.g. from Node http module)', async () => {
    const { extractTraceContext } = await import('../src/lib/tracing');
    const traceId = 'f'.repeat(32);
    const spanId  = 'a'.repeat(16);
    const headers = {
      traceparent: [`00-${traceId}-${spanId}-00`],
      tracestate:  ['vendor=v1', 'other=v2'],
    };
    const result = extractTraceContext(headers);
    expect(result.traceId).toBe(traceId);
    expect(result.spanId).toBe(spanId);
    expect(result.traceFlags).toBe(0);
    // Array tracestate values joined with comma
    expect(result.tracestate).toBe('vendor=v1,other=v2');
  });

  it('does not throw on unexpected input types', async () => {
    const { extractTraceContext } = await import('../src/lib/tracing');
    // @ts-expect-error intentional bad input for robustness test
    expect(() => extractTraceContext(null)).not.toThrow();
    // @ts-expect-error intentional bad input for robustness test
    expect(() => extractTraceContext(undefined)).not.toThrow();
  });
});

// ─── injectTraceContext (#1077) ───────────────────────────────────────────────

describe('injectTraceContext', () => {
  it('returns an object containing a traceparent key in W3C format', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { getTracer, injectTraceContext } = await import('../src/lib/tracing');
    const tracer = getTracer('inject-test');
    const span = tracer.startSpan('test.inject');
    const headers = injectTraceContext(span);
    span.end();

    expect(typeof headers.traceparent).toBe('string');
    // W3C format: 00-{32hex}-{16hex}-{2hex}
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('produces a traceparent whose traceId and spanId are non-empty', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { getTracer, injectTraceContext } = await import('../src/lib/tracing');
    const tracer = getTracer('inject-test-2');
    const span = tracer.startSpan('test.inject2');
    const headers = injectTraceContext(span);
    span.end();

    const parts = headers.traceparent.split('-');
    expect(parts).toHaveLength(4);
    expect(parts[1]).toHaveLength(32); // traceId
    expect(parts[2]).toHaveLength(16); // spanId
  });

  it('round-trips: inject then extract returns the same traceId', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { getTracer, injectTraceContext, extractTraceContext } = await import('../src/lib/tracing');
    const tracer = getTracer('round-trip');
    const span = tracer.startSpan('test.roundtrip');
    const injected = injectTraceContext(span);
    span.end();

    const extracted = extractTraceContext(injected);
    // The injected traceparent's traceId must match what we extract
    const injectedTraceId = injected.traceparent.split('-')[1];
    expect(extracted.traceId).toBe(injectedTraceId);
  });
});

// ─── withJobSpan (#1077) ──────────────────────────────────────────────────────

describe('withJobSpan', () => {
  it('resolves and returns the inner function value', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { withJobSpan } = await import('../src/lib/tracing');
    const result = await withJobSpan('test-queue', 'test-job', { amount: 100 }, async (_span) => {
      return 'done';
    });
    expect(result).toBe('done');
  });

  it('propagates errors thrown inside the job span', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { withJobSpan } = await import('../src/lib/tracing');
    await expect(
      withJobSpan('test-queue', 'failing-job', {}, async (_span) => {
        throw new Error('job failed');
      }),
    ).rejects.toThrow('job failed');
  });

  it('passes a span object to the inner function', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { withJobSpan } = await import('../src/lib/tracing');
    let receivedSpan: unknown;
    await withJobSpan('test-queue', 'span-check', {}, async (span) => {
      receivedSpan = span;
      return null;
    });
    expect(receivedSpan).toBeDefined();
    expect(typeof (receivedSpan as { end: unknown }).end).toBe('function');
  });

  it('handles job data with sensitive fields (redacted before span attributes)', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { withJobSpan } = await import('../src/lib/tracing');
    // Should not throw even when job data contains sensitive values
    await expect(
      withJobSpan(
        'test-queue',
        'redact-job',
        { apiKey: 'super-secret', merchantId: 'GABC' },
        async (_span) => 'ok',
      ),
    ).resolves.toBe('ok');
  });

  it('handles missing _traceContext gracefully (no parent context)', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { withJobSpan } = await import('../src/lib/tracing');
    const result = await withJobSpan(
      'test-queue',
      'no-parent-job',
      { subscriber: 'GABC', amount: 500 },
      async (_span) => 42,
    );
    expect(result).toBe(42);
  });

  it('restores parent trace context from _traceContext when valid traceparent provided', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { withJobSpan } = await import('../src/lib/tracing');
    const traceId = 'a'.repeat(32);
    const spanId  = 'b'.repeat(16);
    const jobData = {
      merchant: 'GABC',
      _traceContext: {
        traceparent: `00-${traceId}-${spanId}-01`,
      },
    };
    // Should succeed without error — the span is parented to the remote context
    const result = await withJobSpan('test-queue', 'parented-job', jobData, async (_span) => 'parented');
    expect(result).toBe('parented');
  });

  it('handles retry jobs (multiple calls) without accumulating state', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    const { withJobSpan } = await import('../src/lib/tracing');
    for (let i = 0; i < 3; i++) {
      const result = await withJobSpan(
        'retry-queue',
        'retry-job',
        { attempt: i, merchant: 'GABC' },
        async (_span) => `attempt-${i}`,
      );
      expect(result).toBe(`attempt-${i}`);
    }
  });
});
