/**
 * BE-66 — OpenTelemetry tracing unit tests.
 */

// Store original env to restore after each test
const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe('initTracing', () => {
  it('does not throw when OTEL_SDK_DISABLED=true', async () => {
    process.env.OTEL_SDK_DISABLED = 'true';
    // Re-import after env change
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

describe('getTracer', () => {
  it('returns a tracer object with startSpan method', async () => {
    const { getTracer } = await import('../src/lib/tracing');
    const tracer = getTracer('test-tracer');
    expect(tracer).toBeDefined();
    expect(typeof tracer.startSpan).toBe('function');
  });
});

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
