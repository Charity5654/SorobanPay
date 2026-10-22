/**
 * errorHandler.ts — Structured API error envelope middleware (#1074)
 *
 * Transforms thrown errors into a stable, machine-readable ApiError envelope:
 *   { error: string, code: ApiErrorCode, correlationId: string, details?: object }
 *
 * Safe messages: never leak stack traces, env vars, or internal state.
 * Correlation IDs: sourced from X-Correlation-ID request header or auto-generated.
 */
import { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'RATE_LIMITED'
  | 'INTERNAL_ERROR'
  | 'DEPENDENCY_UNAVAILABLE'
  | 'IDEMPOTENCY_CONFLICT';

export interface ApiError {
  error: string;
  code: ApiErrorCode;
  correlationId: string;
  details?: Record<string, unknown> | null;
}

// ── AppError class ────────────────────────────────────────────────────────────

/**
 * Throw AppError anywhere in a route handler to produce a structured response.
 *
 * @example
 * throw new AppError(400, 'VALIDATION_ERROR', 'Merchant address is missing');
 * throw new AppError(429, 'RATE_LIMITED', 'Too many requests', { retryAfter: 60 });
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: ApiErrorCode,
    message: string,
    public readonly details?: Record<string, unknown> | null,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Returns false if `message` contains patterns that indicate internal details
 * (stack frames, node_modules paths, secret env var names).
 */
export function isSafeMessage(message: string): boolean {
  const dangerous = [
    /at \w+ \(/,
    /node_modules/i,
    /DATABASE_URL/i,
    /SECRET/i,
    /PASSWORD/i,
  ];
  return !dangerous.some((pattern) => pattern.test(message));
}

/**
 * Derives a correlation ID from the request header or generates one.
 * The generated ID is intentionally simple and not cryptographically random —
 * it only needs to be unique enough to correlate a single request in logs.
 */
function getCorrelationId(req: Request): string {
  const header = req.headers['x-correlation-id'];
  if (typeof header === 'string' && header.trim()) return header.trim();
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

// ── Middleware ────────────────────────────────────────────────────────────────

/**
 * Express error-handling middleware.
 * Mount AFTER all routes: `app.use(errorHandler)`.
 */
export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  const correlationId = getCorrelationId(req);

  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      correlationId,
      details: err.details ?? null,
    } satisfies ApiError);
    return;
  }

  // Unknown / unhandled errors — never leak internals
  const statusCode =
    (err as { status?: number })?.status ??
    (err as { statusCode?: number })?.statusCode ??
    500;

  res.status(statusCode).json({
    error: 'An internal error occurred',
    code: 'INTERNAL_ERROR' as ApiErrorCode,
    correlationId,
    details: null,
  } satisfies ApiError);
};

/**
 * Catch-all 404 handler.
 * Mount AFTER all routes but BEFORE errorHandler: `app.use(notFoundHandler)`.
 */
export function notFoundHandler(req: Request, res: Response): void {
  const correlationId = getCorrelationId(req);
  res.status(404).json({
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND' as ApiErrorCode,
    correlationId,
    details: null,
  } satisfies ApiError);
}
