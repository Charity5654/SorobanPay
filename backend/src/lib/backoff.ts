/**
 * withBackoff — BE-51
 *
 * Exponential backoff utility for retrying async operations that may fail
 * transiently (RPC timeouts, network errors, etc.).
 *
 * Features:
 *   - Configurable max retries, base delay, and max delay cap
 *   - Jitter added to avoid thundering-herd on distributed restarts
 *   - onRetry callback for logging / telemetry
 *   - TypeScript generic return type
 *
 * Usage:
 *   const events = await withBackoff(
 *     () => rpcServer.getEvents(request),
 *     { maxRetries: 5, baseDelayMs: 1_000, maxDelayMs: 60_000 },
 *   );
 */

export interface BackoffOptions {
  /** Number of retry attempts after the first failure. Default: 5 */
  maxRetries?: number;
  /** Base delay in milliseconds. Default: 1000 */
  baseDelayMs?: number;
  /** Maximum delay cap in milliseconds. Default: 60_000 */
  maxDelayMs?: number;
  /** Fraction of delay to randomise as jitter (0–1). Default: 0.2 */
  jitterFactor?: number;
  /** Called before each retry with the attempt number and error. */
  onRetry?: (attempt: number, error: unknown) => void;
  /** If provided, only retry when this predicate returns true. */
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
  // Exponential: 1s, 2s, 4s, 8s, 16s …
  const exponential = baseDelayMs * Math.pow(2, attempt);
  const capped = Math.min(exponential, maxDelayMs);
  // Add ±jitterFactor * capped random jitter
  const jitter = (Math.random() * 2 - 1) * jitterFactor * capped;
  return Math.max(0, Math.round(capped + jitter));
}

export async function withBackoff<T>(
  fn: () => Promise<T>,
  options: BackoffOptions = {},
): Promise<T> {
  const {
    maxRetries = 5,
    baseDelayMs = 1_000,
    maxDelayMs = 60_000,
    jitterFactor = 0.2,
    onRetry,
    isRetryable,
  } = options;

  let lastError: unknown;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      // Check if we should retry this error type
      if (isRetryable && !isRetryable(err)) {
        throw err;
      }

      // No more retries
      if (attempt === maxRetries) break;

      const delay = computeDelay(attempt, baseDelayMs, maxDelayMs, jitterFactor);
      onRetry?.(attempt + 1, err);
      await sleep(delay);
    }
  }

  throw lastError;
}

/** Default isRetryable predicate for RPC/network errors. */
export function isRpcRetryable(err: unknown): boolean {
  const msg = ((err as Error)?.message ?? String(err)).toLowerCase();
  return (
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('econnreset') ||
    msg.includes('network') ||
    msg.includes('socket') ||
    msg.includes('rate limit') ||
    msg.includes('too many requests') ||
    msg.includes('503') ||
    msg.includes('502') ||
    msg.includes('429') ||
    msg.includes('unavailable')
  );
}
