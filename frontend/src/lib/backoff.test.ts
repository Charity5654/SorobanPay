/**
 * backoff.test.ts
 *
 * Tests for exponential backoff retry logic with jitter and adaptive error handling.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { withBackoff, isRpcRetryable, getErrorMessage } from './backoff';

describe('withBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── Success cases ──────────────────────────────────────────────────────────

  it('returns immediately on success without retrying', async () => {
    const fn = vi.fn().mockResolvedValue('success');
    const result = await withBackoff(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('succeeds on first attempt when no error occurs', async () => {
    const fn = vi.fn().mockResolvedValue(42);
    const result = await withBackoff(fn);

    expect(result).toBe(42);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  // ── Retry and recovery ─────────────────────────────────────────────────────

  it('retries on transient error and succeeds on third attempt', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce('success');

    const result = await withBackoff(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('calls onRetry callback with attempt number and error', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('success');

    await withBackoff(fn, { onRetry, maxRetries: 3 });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledWith(
      1, // attempt number (1-indexed)
      expect.objectContaining({ message: 'timeout' }),
      expect.any(Number), // delay in ms
    );
  });

  it('passes delay duration to onRetry callback', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('success');

    await withBackoff(fn, {
      onRetry,
      maxRetries: 2,
      baseDelayMs: 100,
      maxDelayMs: 500,
    });

    expect(onRetry).toHaveBeenCalledWith(
      1,
      expect.any(Error),
      expect.any(Number), // Should be between 100 and 500
    );

    const [, , delayMs] = onRetry.mock.calls[0];
    expect(delayMs).toBeGreaterThanOrEqual(75); // 100 - 25% jitter
    expect(delayMs).toBeLessThanOrEqual(125); // 100 + 25% jitter
  });

  // ── Exponential backoff ────────────────────────────────────────────────────

  it('exponentially increases delay between retries', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    try {
      await withBackoff(fn, {
        maxRetries: 4,
        baseDelayMs: 100,
        maxDelayMs: 10000,
        jitterFactor: 0, // Disable jitter for consistent timing
        onRetry,
      });
    } catch {
      // Expected to fail after max retries
    }

    // Should have 4 retry attempts (attempts 1, 2, 3, 4)
    expect(onRetry).toHaveBeenCalledTimes(4);

    const delays = onRetry.mock.calls.map(call => call[2]);
    // Delays should roughly follow: 100, 200, 400, 800 (exponential)
    expect(delays[0]).toBe(100); // 100 * 2^0
    expect(delays[1]).toBe(200); // 100 * 2^1
    expect(delays[2]).toBe(400); // 100 * 2^2
    expect(delays[3]).toBe(800); // 100 * 2^3
  });

  it('caps maximum delay at maxDelayMs', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    try {
      await withBackoff(fn, {
        maxRetries: 6,
        baseDelayMs: 100,
        maxDelayMs: 500, // Cap at 500ms
        jitterFactor: 0, // Disable jitter
        onRetry,
      });
    } catch {
      // Expected to fail after max retries
    }

    const delays = onRetry.mock.calls.map(call => call[2]);
    // After reaching 500ms, should stay at 500ms or below
    expect(delays[4]).toBeLessThanOrEqual(500); // 100 * 2^4 = 1600, capped to 500
    expect(delays[5]).toBeLessThanOrEqual(500); // 100 * 2^5 = 3200, capped to 500
  });

  // ── Jitter ────────────────────────────────────────────────────────────────

  it('adds jitter to delays', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    try {
      await withBackoff(fn, {
        maxRetries: 10,
        baseDelayMs: 1000,
        maxDelayMs: 10000,
        jitterFactor: 0.2, // ±20% jitter
        onRetry,
      });
    } catch {
      // Expected to fail after max retries
    }

    const delays = onRetry.mock.calls.map(call => call[2]);
    // With 20% jitter on 1000ms: 800-1200
    // Verify that not all delays are identical (jitter is applied)
    const uniqueDelays = new Set(delays);
    expect(uniqueDelays.size).toBeGreaterThan(1);
  });

  // ── Error handling ─────────────────────────────────────────────────────────

  it('throws last error after exhausting retries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('persistent error'));

    await expect(
      withBackoff(fn, { maxRetries: 2 }),
    ).rejects.toThrow('persistent error');

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('throws non-retryable errors immediately', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('invalid address'));
    const onRetry = vi.fn();

    await expect(
      withBackoff(fn, {
        maxRetries: 5,
        onRetry,
      }),
    ).rejects.toThrow('invalid address');

    expect(onRetry).not.toHaveBeenCalled(); // Should not retry
    expect(fn).toHaveBeenCalledTimes(1); // Only one attempt
  });

  it('respects isRetryable predicate to filter errors', async () => {
    const onRetry = vi.fn();
    const isRetryable = (err: unknown) => {
      const msg = (err as Error)?.message ?? '';
      return msg.includes('retry-me');
    };

    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('dont-retry-me'))
      .mockResolvedValueOnce('success');

    await expect(
      withBackoff(fn, { maxRetries: 3, onRetry, isRetryable }),
    ).rejects.toThrow('dont-retry-me');

    expect(onRetry).not.toHaveBeenCalled();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('uses default isRetryable when none provided', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('success');

    const result = await withBackoff(fn);

    expect(result).toBe('success');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  // ── Configuration ─────────────────────────────────────────────────────────

  it('respects maxRetries option', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    await expect(
      withBackoff(fn, { maxRetries: 2 }),
    ).rejects.toThrow();

    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
  });

  it('respects baseDelayMs option', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce('success');

    await withBackoff(fn, {
      baseDelayMs: 50,
      maxDelayMs: 100,
      jitterFactor: 0,
      onRetry,
    });

    const [, , delayMs] = onRetry.mock.calls[0];
    expect(delayMs).toBe(50);
  });

  it('respects maxDelayMs option', async () => {
    const onRetry = vi.fn();
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));

    try {
      await withBackoff(fn, {
        maxRetries: 5,
        baseDelayMs: 1000,
        maxDelayMs: 2000,
        jitterFactor: 0,
        onRetry,
      });
    } catch {
      // Expected to fail
    }

    const delays = onRetry.mock.calls.map(call => call[2]);
    delays.forEach(delay => {
      expect(delay).toBeLessThanOrEqual(2000);
    });
  });

  it('handles default options', async () => {
    const fn = vi.fn().mockResolvedValue('result');
    const result = await withBackoff(fn);

    expect(result).toBe('result');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

// ── isRpcRetryable tests ───────────────────────────────────────────────────────

describe('isRpcRetryable', () => {
  // Retryable errors
  describe('retryable errors', () => {
    it('returns true for timeout errors', () => {
      expect(isRpcRetryable(new Error('timeout'))).toBe(true);
      expect(isRpcRetryable(new Error('timed out'))).toBe(true);
    });

    it('returns true for connection errors', () => {
      expect(isRpcRetryable(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRpcRetryable(new Error('ECONNRESET'))).toBe(true);
    });

    it('returns true for network errors', () => {
      expect(isRpcRetryable(new Error('network error'))).toBe(true);
      expect(isRpcRetryable(new Error('socket error'))).toBe(true);
    });

    it('returns true for rate limit errors', () => {
      expect(isRpcRetryable(new Error('429 Too Many Requests'))).toBe(true);
      expect(isRpcRetryable(new Error('rate limit exceeded'))).toBe(true);
      expect(isRpcRetryable(new Error('too many requests'))).toBe(true);
    });

    it('returns true for service unavailable errors', () => {
      expect(isRpcRetryable(new Error('503 Service Unavailable'))).toBe(true);
      expect(isRpcRetryable(new Error('502 Bad Gateway'))).toBe(true);
      expect(isRpcRetryable(new Error('504 Gateway Timeout'))).toBe(true);
    });

    it('returns true for fetch/network errors', () => {
      expect(isRpcRetryable(new Error('fetch failed'))).toBe(true);
      expect(isRpcRetryable(new Error('failed to fetch'))).toBe(true);
    });

    it('returns true for mempool/sequence errors', () => {
      expect(isRpcRetryable(new Error('mempool'))).toBe(true);
      expect(isRpcRetryable(new Error('sequence number'))).toBe(true);
      expect(isRpcRetryable(new Error('not found'))).toBe(true);
    });
  });

  // Non-retryable errors
  describe('non-retryable errors', () => {
    it('returns false for invalid address errors', () => {
      expect(isRpcRetryable(new Error('invalid address'))).toBe(false);
      expect(isRpcRetryable(new Error('invalid contract address'))).toBe(false);
    });

    it('returns false for signing rejection', () => {
      expect(isRpcRetryable(new Error('user declined'))).toBe(false);
      expect(isRpcRetryable(new Error('user rejected'))).toBe(false);
      expect(isRpcRetryable(new Error('signing failed'))).toBe(false);
    });

    it('returns false for contract errors', () => {
      expect(isRpcRetryable(new Error('error(contract, #1)'))).toBe(false);
      expect(isRpcRetryable(new Error('error(contract, #2)'))).toBe(false);
    });

    it('returns false for balance/allowance errors', () => {
      expect(isRpcRetryable(new Error('insufficient balance'))).toBe(false);
      expect(isRpcRetryable(new Error('not enough balance'))).toBe(false);
      expect(isRpcRetryable(new Error('underfunded'))).toBe(false);
    });

    it('returns false for authorization errors', () => {
      expect(isRpcRetryable(new Error('unauthorized'))).toBe(false);
      expect(isRpcRetryable(new Error('permission denied'))).toBe(false);
    });

    it('returns false for rejected errors', () => {
      expect(isRpcRetryable(new Error('rejected'))).toBe(false);
    });
  });

  // Edge cases
  describe('edge cases', () => {
    it('handles case-insensitive matching', () => {
      expect(isRpcRetryable(new Error('TIMEOUT'))).toBe(true);
      expect(isRpcRetryable(new Error('INVALID'))).toBe(false);
    });

    it('handles non-Error types', () => {
      expect(isRpcRetryable('timeout')).toBe(true);
      expect(isRpcRetryable('invalid')).toBe(false);
      expect(isRpcRetryable('some random string')).toBe(false);
    });

    it('handles null/undefined gracefully', () => {
      expect(isRpcRetryable(null)).toBe(false);
      expect(isRpcRetryable(undefined)).toBe(false);
    });

    it('prioritizes non-retryable classification over retryable', () => {
      // If error contains both retryable and non-retryable patterns
      const err = new Error('timeout but also invalid');
      expect(isRpcRetryable(err)).toBe(false); // non-retryable wins
    });
  });
});

// ── getErrorMessage tests ──────────────────────────────────────────────────────

describe('getErrorMessage', () => {
  it('extracts message from Error objects', () => {
    const err = new Error('test error');
    expect(getErrorMessage(err)).toBe('test error');
  });

  it('converts string errors to string', () => {
    expect(getErrorMessage('string error')).toBe('string error');
  });

  it('extracts message from objects with message property', () => {
    expect(getErrorMessage({ message: 'object error' })).toBe('object error');
  });

  it('converts other types to string', () => {
    expect(getErrorMessage(42)).toBe('42');
    expect(getErrorMessage(true)).toBe('true');
  });

  it('handles null and undefined', () => {
    expect(getErrorMessage(null)).toBe('null');
    expect(getErrorMessage(undefined)).toBe('undefined');
  });
});
