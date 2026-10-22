/**
 * backoff.ts
 *
 * Exponential backoff utility for retrying async operations that may fail
 * transiently (RPC timeouts, network errors, mempool congestion, etc.).
 *
 * Features:
 *   - Configurable max retries, base delay, and max delay cap
 *   - Jitter added to avoid thundering-herd on distributed restarts
 *   - onRetry callback for logging / telemetry
 *   - TypeScript generic return type
 *   - Predicate-based retry filtering (retry only specific error types)
 *
 * Usage:
 *   const account = await withBackoff(
 *     () => server.getAccount(publicKey),
 *     { maxRetries: 5, baseDelayMs: 500, maxDelayMs: 30_000 },
 *   );
 */

export interface BackoffOptions {
  /** Number of retry attempts after the first failure. Default: 5 */
  maxRetries?: number;
  /** Base delay in milliseconds. Default: 500 */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 30_000 */
  maxDelayMs?: number;
  /** Fraction of delay to randomise as jitter (0–1). Default: 0.2 */
  jitterFactor?: number;
  /** Called before each retry with the attempt number and error. */
  onRetry?: (attempt: number, error: unknown, delayMs: number) => void;
  /** If provided, only retry when this predicate returns true. Default: isRpcRetryable */
  isRetryable?: (error: unknown) => boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function computeDelay(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterFactor: number,
): number {
  // Exponential: 0.5s, 1s, 2s, 4s, 8s …
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelayMs);
  // Add ±jitterFactor * capped random jitter
  const jitter = (Math.random() * 2 - 1) * jitterFactor * capped;
  return Math.max(0, Math.round(capped + jitter));
}

/**
 * Retry an async operation with exponential backoff.
 *
 * @param fn - The async function to retry
 * @param options - Retry configuration
 * @returns The result of fn if it succeeds
 * @throws The last error encountered if all retries are exhausted
 */
export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const {
    maxRetries = 5,
    baseDelayMs = 500,
    maxDelayMs = 30_000,
    jitterFactor = 0.2,
    onRetry,
    isRetryable = isRpcRetryable,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Check if we should retry this error type
      if (!isRetryable(err)) {
        throw err;
      }

      // No more retries
      if (attempt === maxRetries) break;

      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs, jitterFactor);
      onRetry?.(attempt + 1, err, delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

/**
 * Classifies an error to determine if it's a transient RPC/network error worth retrying.
 *
 * Retryable errors:
 *   - Timeout errors (transaction not yet confirmed)
 *   - Connection refused / reset (temporary network issues)
 *   - Rate limit errors (429, 503, 502)
 *   - "Not found" on getTransaction (still in mempool)
 *
 * Non-retryable errors:
 *   - Invalid addresses (malformed)
 *   - Signing rejection (user declined)
 *   - Contract errors (amount out of range, auth failed)
 *   - Insufficient balance (persistent client-side issue)
 */
export function isRpcRetryable(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? String(err)).toLowerCase();

  // Transient errors worth retrying
  const retryable =
    msg.includes('timeout') ||
    msg.includes('timed out') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('network') ||
    msg.includes('socket') ||
    msg.includes('429') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('503') ||
    msg.includes('service unavailable') ||
    msg.includes('502') ||
    msg.includes('bad gateway') ||
    msg.includes('504') ||
    msg.includes('gateway timeout') ||
    msg.includes('fetch failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('not found') || // Still in mempool
    msg.includes('temporarily unavailable') ||
    msg.includes('nonce') || // Concurrent tx issue
    msg.includes('mempool') ||
    msg.includes('sequence') || // Stale sequence number
    msg.includes('ledger');  // Ledger closed before tx submitted

  // Non-retryable errors (explicit blacklist)
  const nonRetryable =
    msg.includes('invalid') ||
    msg.includes('user declined') ||
    msg.includes('user rejected') ||
    msg.includes('rejected') ||
    msg.includes('signing') ||
    msg.includes('error(contract') || // Contract-side error
    msg.includes('insufficient balance') ||
    msg.includes('not enough') ||
    msg.includes('underfunded') ||
    msg.includes('unauthorized') ||
    msg.includes('permission denied');

  // If explicitly non-retryable, don't retry even if it matches a retryable pattern
  if (nonRetryable) {
    return false;
  }

  return retryable;
}

/**
 * Extract the error message from various error types.
 */
export function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  if (typeof err === 'object' && err !== null && 'message' in err) {
    return String((err as any).message);
  }
  return String(err);
}
