/**
 * BE-59 — Input validation helpers using Zod.
 *
 * Provides:
 *  - validateQuery(schema) — middleware factory that validates req.query
 *  - validateBody(schema)  — middleware factory that validates req.body
 *  - Common Zod schemas for shared query parameters
 *
 * NOTE: Express 5 makes `req.query` a read-only getter backed by a parsed
 * querystring. We cannot reassign it, so validated query params are stored
 * on `req.validatedQuery`. Route handlers should read from there.
 */

import { Request, Response, NextFunction } from 'express';
import { z, ZodSchema } from 'zod';

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * Returns Express middleware that validates req.query against the given Zod
 * schema. On failure it responds with 400 and a list of field errors.
 * On success it stores the parsed (coerced) result on `req.validatedQuery`.
 *
 * Express 5 makes `req.query` a read-only getter, so we cannot overwrite it.
 * Use `(req as any).validatedQuery` in handlers downstream.
 */
export function validateQuery<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid query parameters',
        details: result.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }
    (req as any).validatedQuery = result.data;
    next();
  };
}

/**
 * Returns Express middleware that validates req.body against the given Zod
 * schema. On failure it responds with 400 and a list of field errors.
 */
export function validateBody<T>(schema: ZodSchema<T>) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      res.status(400).json({
        error: 'Invalid request body',
        details: result.error.errors.map((e) => ({
          field: e.path.join('.'),
          message: e.message,
        })),
      });
      return;
    }
    req.body = result.data;
    next();
  };
}

// ---------------------------------------------------------------------------
// Common schemas
// ---------------------------------------------------------------------------

/** ISO 8601 date string (YYYY-MM-DD or full datetime). */
export const isoDateString = z.string().datetime({ offset: true }).or(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format'),
);

/** Pagination query parameters. */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(1000).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

/** Payment report query parameters (BE-58). */
export const reportQuerySchema = z.object({
  merchant: z.string().min(1, 'merchant is required'),
  from: isoDateString.optional(),
  to: isoDateString.optional(),
  format: z.enum(['json', 'csv']).default('json'),
  status: z.enum(['all', 'success', 'failed']).default('all'),
  limit: z.coerce.number().int().min(1).max(100_000).default(10_000),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ReportQuery = z.infer<typeof reportQuerySchema>;
