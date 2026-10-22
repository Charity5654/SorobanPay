/**
 * logger.ts
 *
 * Simple browser-compatible logging utility for the SorobanPay frontend.
 *
 * Features:
 *   - Console output with log levels (debug, info, warn, error)
 *   - Redacts sensitive Stellar addresses (keeps first-8 + last-8 chars)
 *   - DEBUG_MODE environment variable controls verbosity
 *   - Structured logging with timestamps and context
 *   - Works in both browser console and server-side environments
 *
 * Usage:
 *   import { logger } from './logger';
 *   logger.debug('[subscribe] Building transaction', { subscriber, amount });
 *   logger.info('[subscribe] Transaction submitted', { txHash });
 *   logger.warn('[subscribe] Retry attempt 2/5');
 *   logger.error('[subscribe] Failed to prepare', { error: err.message });
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  [key: string]: unknown;
}

/**
 * Redact a Stellar address to first-8 + last-8 chars to protect privacy.
 * Useful for logging without exposing full addresses.
 */
function redactAddress(address: string): string {
  if (!address || address.length <= 16) return address;
  const prefix = address.slice(0, 8);
  const suffix = address.slice(-8);
  return `${prefix}...${suffix}`;
}

/**
 * Sanitize context object for logging by redacting addresses and sensitive data.
 */
function sanitizeContext(context: LogContext): LogContext {
  const sanitized: LogContext = {};

  for (const [key, value] of Object.entries(context)) {
    // Redact address fields
    if (
      key.toLowerCase().includes('address') ||
      key.toLowerCase().includes('subscriber') ||
      key.toLowerCase().includes('merchant') ||
      key.toLowerCase().includes('account') ||
      key.toLowerCase().includes('publickey')
    ) {
      if (typeof value === 'string') {
        sanitized[key] = redactAddress(value);
      } else {
        sanitized[key] = value;
      }
    } else if (key === 'error' && value instanceof Error) {
      // Extract error message and stack
      sanitized[key] = {
        message: value.message,
        stack: value.stack,
      };
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Format a log entry as a readable string with timestamp.
 */
function formatLogEntry(
  level: LogLevel,
  message: string,
  context?: LogContext,
): string {
  const timestamp = new Date().toISOString();
  const levelUpper = level.toUpperCase().padEnd(5);
  const contextStr = context && Object.keys(context).length > 0
    ? ` ${JSON.stringify(context)}`
    : '';
  return `[${timestamp}] ${levelUpper} ${message}${contextStr}`;
}

/**
 * Get the console method for a given log level.
 */
function getConsoleMethod(level: LogLevel): (...args: unknown[]) => void {
  switch (level) {
    case 'debug':
      return console.log;
    case 'info':
      return console.log;
    case 'warn':
      return console.warn;
    case 'error':
      return console.error;
    default:
      return console.log;
  }
}

/**
 * Check if debug mode is enabled via environment or query parameter.
 */
function isDebugMode(): boolean {
  // Check environment variable (used in Node.js or build-time)
  if (typeof process !== 'undefined' && process.env) {
    if (
      process.env.DEBUG_MODE === 'true' ||
      process.env.NEXT_PUBLIC_DEBUG_MODE === 'true'
    ) {
      return true;
    }
  }

  // Check browser query parameter (e.g., ?debug=true)
  if (typeof window !== 'undefined') {
    const params = new URLSearchParams(window.location.search);
    if (params.get('debug') === 'true') {
      return true;
    }
  }

  return false;
}

/**
 * Main logger interface with methods for each log level.
 */
export const logger = {
  /**
   * Log a debug message (only shown when DEBUG_MODE is enabled).
   * Use for detailed diagnostic information during development.
   *
   * @param message - Log message with optional context prefix (e.g., "[subscribe]")
   * @param context - Optional object with additional context
   */
  debug: (message: string, context?: LogContext): void => {
    if (!isDebugMode()) return;

    const sanitized = context ? sanitizeContext(context) : undefined;
    const formatted = formatLogEntry('debug', message, sanitized);
    getConsoleMethod('debug')(formatted);
  },

  /**
   * Log an info message (always shown).
   * Use for important transaction milestones (submit, confirm, etc.).
   *
   * @param message - Log message with optional context prefix
   * @param context - Optional object with additional context
   */
  info: (message: string, context?: LogContext): void => {
    const sanitized = context ? sanitizeContext(context) : undefined;
    const formatted = formatLogEntry('info', message, sanitized);
    getConsoleMethod('info')(formatted);
  },

  /**
   * Log a warning message.
   * Use for transient failures that will be retried.
   *
   * @param message - Log message with optional context prefix
   * @param context - Optional object with additional context
   */
  warn: (message: string, context?: LogContext): void => {
    const sanitized = context ? sanitizeContext(context) : undefined;
    const formatted = formatLogEntry('warn', message, sanitized);
    getConsoleMethod('warn')(formatted);
  },

  /**
   * Log an error message.
   * Use for unexpected failures or exceptions.
   *
   * @param message - Log message with optional context prefix
   * @param context - Optional object with additional context or error
   */
  error: (message: string, context?: LogContext): void => {
    const sanitized = context ? sanitizeContext(context) : undefined;
    const formatted = formatLogEntry('error', message, sanitized);
    getConsoleMethod('error')(formatted);
  },

  /**
   * Create a child logger with a consistent prefix.
   * Useful for logging all messages from a specific operation.
   *
   * @param prefix - Prefix for all messages (e.g., "[subscribe]")
   * @returns Object with same methods as logger, but with prefix prepended
   */
  child: (prefix: string) => ({
    debug: (msg: string, ctx?: LogContext) =>
      logger.debug(`${prefix} ${msg}`, ctx),
    info: (msg: string, ctx?: LogContext) =>
      logger.info(`${prefix} ${msg}`, ctx),
    warn: (msg: string, ctx?: LogContext) =>
      logger.warn(`${prefix} ${msg}`, ctx),
    error: (msg: string, ctx?: LogContext) =>
      logger.error(`${prefix} ${msg}`, ctx),
  }),

  /**
   * Check if debug mode is currently enabled.
   */
  isDebug: (): boolean => isDebugMode(),
};

/**
 * Utility function to create a timer for measuring operation duration.
 * Useful for performance logging.
 *
 * @param label - Operation name for logging
 * @returns Function to call when operation completes; logs duration
 *
 * @example
 *   const timer = createTimer('prepareTransaction');
 *   await server.prepareTransaction(tx);
 *   timer(); // Logs: "[prepareTransaction] completed in 234ms"
 */
export function createTimer(label: string): () => void {
  const startTime = performance.now();

  return () => {
    const duration = Math.round(performance.now() - startTime);
    logger.debug(`[${label}] completed in ${duration}ms`);
  };
}
