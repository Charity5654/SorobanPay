/**
 * logger.test.ts
 *
 * Tests for browser-compatible logging utility with address redaction and debug mode.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { logger, createTimer } from './logger';

describe('logger', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    // Mock console methods
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };

    // Clear environment variables
    delete process.env.DEBUG_MODE;
    delete process.env.NEXT_PUBLIC_DEBUG_MODE;
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
  });

  // ── Debug level ────────────────────────────────────────────────────────────

  describe('debug logging', () => {
    it('does not log when DEBUG_MODE is disabled', () => {
      logger.debug('test message');
      expect(consoleSpy.log).not.toHaveBeenCalled();
    });

    it('logs when DEBUG_MODE environment variable is set', () => {
      process.env.DEBUG_MODE = 'true';
      logger.debug('debug message');
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.log.mock.calls[0][0]).toContain('DEBUG');
      expect(consoleSpy.log.mock.calls[0][0]).toContain('debug message');
    });

    it('logs when NEXT_PUBLIC_DEBUG_MODE environment variable is set', () => {
      process.env.NEXT_PUBLIC_DEBUG_MODE = 'true';
      logger.debug('debug message');
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
    });

    it('includes context object in debug logs', () => {
      process.env.DEBUG_MODE = 'true';
      logger.debug('operation', { key: 'value', count: 42 });
      expect(consoleSpy.log.mock.calls[0][0]).toContain('key');
      expect(consoleSpy.log.mock.calls[0][0]).toContain('value');
      expect(consoleSpy.log.mock.calls[0][0]).toContain('count');
      expect(consoleSpy.log.mock.calls[0][0]).toContain('42');
    });
  });

  // ── Info level ─────────────────────────────────────────────────────────────

  describe('info logging', () => {
    it('logs info messages', () => {
      logger.info('info message');
      expect(consoleSpy.log).toHaveBeenCalledTimes(1);
      expect(consoleSpy.log.mock.calls[0][0]).toContain('INFO');
      expect(consoleSpy.log.mock.calls[0][0]).toContain('info message');
    });

    it('always logs info regardless of DEBUG_MODE', () => {
      delete process.env.DEBUG_MODE;
      logger.info('important info');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('includes timestamp in info logs', () => {
      logger.info('test');
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\]/);
    });

    it('includes context in info logs', () => {
      logger.info('transaction', { txHash: 'abc123', status: 'pending' });
      expect(consoleSpy.log.mock.calls[0][0]).toContain('txHash');
      expect(consoleSpy.log.mock.calls[0][0]).toContain('status');
    });
  });

  // ── Warn level ─────────────────────────────────────────────────────────────

  describe('warn logging', () => {
    it('logs warn messages to console.warn', () => {
      logger.warn('warning message');
      expect(consoleSpy.warn).toHaveBeenCalledTimes(1);
      expect(consoleSpy.warn.mock.calls[0][0]).toContain('WARN');
      expect(consoleSpy.warn.mock.calls[0][0]).toContain('warning message');
    });

    it('includes context in warn logs', () => {
      logger.warn('retry attempt', { attempt: 2, delayMs: 500 });
      expect(consoleSpy.warn.mock.calls[0][0]).toContain('attempt');
      expect(consoleSpy.warn.mock.calls[0][0]).toContain('delayMs');
    });
  });

  // ── Error level ────────────────────────────────────────────────────────────

  describe('error logging', () => {
    it('logs error messages to console.error', () => {
      logger.error('error message');
      expect(consoleSpy.error).toHaveBeenCalledTimes(1);
      expect(consoleSpy.error.mock.calls[0][0]).toContain('ERROR');
      expect(consoleSpy.error.mock.calls[0][0]).toContain('error message');
    });

    it('includes error details in context', () => {
      const err = new Error('something went wrong');
      logger.error('failed', { error: err });
      expect(consoleSpy.error.mock.calls[0][0]).toContain('something went wrong');
    });

    it('extracts message and stack from Error objects', () => {
      const err = new Error('test error');
      logger.error('caught', { error: err });
      const output = consoleSpy.error.mock.calls[0][0];
      expect(output).toContain('test error');
    });
  });

  // ── Address redaction ──────────────────────────────────────────────────────

  describe('address redaction', () => {
    it('redacts subscriber addresses', () => {
      const fullAddress = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      logger.info('test', { subscriber: fullAddress });
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('GAAAAAAA...AWHF');
      expect(output).not.toContain(fullAddress);
    });

    it('redacts merchant addresses', () => {
      const fullAddress = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBQJF';
      logger.info('test', { merchant: fullAddress });
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('GBBBBBB...BBBQJF');
      expect(output).not.toContain(fullAddress);
    });

    it('redacts account addresses', () => {
      const addr = 'GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCGG';
      logger.info('test', { account: addr });
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('GCCCCCC...CCCGG');
    });

    it('redacts publicKey fields', () => {
      const key = 'GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDKJ';
      logger.info('test', { publicKey: key });
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('GDDDDD...DDDKJ');
    });

    it('does not redact addresses shorter than 16 chars', () => {
      const shortAddr = 'SHORT_ADDR_12345';
      logger.info('test', { address: shortAddr });
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain(shortAddr);
    });

    it('does not redact non-string address fields', () => {
      logger.info('test', { subscriber: 123, merchant: null });
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('123');
      expect(output).toContain('null');
    });

    it('redacts multiple addresses in same context', () => {
      const sub = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      const mer = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBQJF';
      logger.info('test', { subscriber: sub, merchant: mer });
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('GAAAAAAA...AWHF');
      expect(output).toContain('GBBBBBB...BBBQJF');
      expect(output).not.toContain(sub);
      expect(output).not.toContain(mer);
    });
  });

  // ── Child logger ───────────────────────────────────────────────────────────

  describe('child logger', () => {
    it('creates a child logger with prefix', () => {
      const childLogger = logger.child('[subscribe]');
      childLogger.info('test message');
      expect(consoleSpy.log.mock.calls[0][0]).toContain('[subscribe] test message');
    });

    it('child logger respects debug mode', () => {
      process.env.DEBUG_MODE = 'true';
      const childLogger = logger.child('[test]');
      childLogger.debug('debug');
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('child logger redacts addresses', () => {
      const childLogger = logger.child('[payment]');
      const addr = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
      childLogger.info('execute', { merchant: addr });
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('[payment]');
      expect(output).toContain('GAAAAAAA...AWHF');
      expect(output).not.toContain(addr);
    });

    it('child logger inherits all log methods', () => {
      const childLogger = logger.child('[test]');
      expect(childLogger.debug).toBeDefined();
      expect(childLogger.info).toBeDefined();
      expect(childLogger.warn).toBeDefined();
      expect(childLogger.error).toBeDefined();
    });
  });

  // ── Log formatting ─────────────────────────────────────────────────────────

  describe('log formatting', () => {
    it('includes timestamp in ISO format', () => {
      logger.info('test');
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    it('pads log level to 5 characters', () => {
      logger.info('test');
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('INFO ');
    });

    it('includes context as JSON when provided', () => {
      logger.info('test', { foo: 'bar', num: 123 });
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toContain('foo');
      expect(output).toContain('bar');
      expect(output).toContain('123');
    });

    it('does not include context when not provided', () => {
      logger.info('test');
      const output = consoleSpy.log.mock.calls[0][0];
      // Should only have timestamp, level, and message
      expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T[\d:\.Z]+\] \w+ test$/);
    });

    it('does not include context when object is empty', () => {
      logger.info('test', {});
      const output = consoleSpy.log.mock.calls[0][0];
      expect(output).toMatch(/\[\d{4}-\d{2}-\d{2}T[\d:\.Z]+\] \w+ test$/);
    });
  });

  // ── isDebug check ──────────────────────────────────────────────────────────

  describe('isDebug utility', () => {
    it('returns false when debug mode is disabled', () => {
      delete process.env.DEBUG_MODE;
      delete process.env.NEXT_PUBLIC_DEBUG_MODE;
      expect(logger.isDebug()).toBe(false);
    });

    it('returns true when DEBUG_MODE is set', () => {
      process.env.DEBUG_MODE = 'true';
      expect(logger.isDebug()).toBe(true);
    });

    it('returns true when NEXT_PUBLIC_DEBUG_MODE is set', () => {
      process.env.NEXT_PUBLIC_DEBUG_MODE = 'true';
      expect(logger.isDebug()).toBe(true);
    });
  });
});

// ── createTimer tests ──────────────────────────────────────────────────────────

describe('createTimer', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    process.env.DEBUG_MODE = 'true';
    vi.useFakeTimers();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    vi.useRealTimers();
    delete process.env.DEBUG_MODE;
  });

  it('creates a timer function', () => {
    const timer = createTimer('test');
    expect(typeof timer).toBe('function');
  });

  it('logs operation duration when timer is called', () => {
    const timer = createTimer('operation');
    vi.advanceTimersByTime(234);
    timer();
    expect(consoleSpy).toHaveBeenCalled();
    expect(consoleSpy.mock.calls[0][0]).toContain('operation');
    expect(consoleSpy.mock.calls[0][0]).toContain('234ms');
  });

  it('measures time accurately', () => {
    const timer = createTimer('test');
    vi.advanceTimersByTime(1000);
    timer();
    expect(consoleSpy.mock.calls[0][0]).toContain('1000ms');
  });

  it('logs at debug level', () => {
    const timer = createTimer('test');
    timer();
    expect(consoleSpy).toHaveBeenCalled();
    // Should use console.log which is used for debug
  });

  it('includes label in the log message', () => {
    const timer = createTimer('myOperation');
    timer();
    expect(consoleSpy.mock.calls[0][0]).toContain('myOperation');
    expect(consoleSpy.mock.calls[0][0]).toContain('completed in');
  });

  it('returns a function that can be called multiple times', () => {
    const timer1 = createTimer('op1');
    const timer2 = createTimer('op2');
    vi.advanceTimersByTime(100);
    timer1();
    vi.advanceTimersByTime(200);
    timer2();
    expect(consoleSpy).toHaveBeenCalledTimes(2);
  });
});

// ── Integration tests ──────────────────────────────────────────────────────────

describe('logger integration', () => {
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    warn: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      warn: vi.spyOn(console, 'warn').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
    process.env.DEBUG_MODE = 'true';
  });

  afterEach(() => {
    consoleSpy.log.mockRestore();
    consoleSpy.warn.mockRestore();
    consoleSpy.error.mockRestore();
    delete process.env.DEBUG_MODE;
  });

  it('logs a complete transaction flow', () => {
    const txLogger = logger.child('[subscribe]');
    const subscriber = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
    const merchant = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBQJF';

    txLogger.debug('Starting transaction', { subscriber, merchant });
    txLogger.debug('Building transaction');
    txLogger.info('Transaction built successfully');
    txLogger.warn('Retry attempt 1/5', { error: 'timeout', delayMs: 500 });
    txLogger.info('Transaction submitted', { txHash: 'abc123' });

    expect(consoleSpy.log).toHaveBeenCalledTimes(4);
    expect(consoleSpy.warn).toHaveBeenCalledTimes(1);

    // Verify addresses are redacted
    const allOutput = [
      ...consoleSpy.log.mock.calls,
      ...consoleSpy.warn.mock.calls,
    ]
      .map(c => c[0])
      .join('\n');

    expect(allOutput).toContain('GAAAAAAA...AWHF');
    expect(allOutput).toContain('GBBBBBB...BBBQJF');
    expect(allOutput).not.toContain(subscriber);
    expect(allOutput).not.toContain(merchant);
  });
});
