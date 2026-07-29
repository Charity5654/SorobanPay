/**
 * BE-60 — Correlation ID middleware.
 *
 * Generates a UUID v4 correlation ID for every incoming request and attaches
 * it to req.id. Also creates a child logger scoped to the request and attaches
 * it to req.log so route handlers can emit structured log lines that include
 * the correlation ID automatically.
 *
 * The correlation ID is echoed in the X-Correlation-Id response header so
 * clients can reference it when reporting issues.
 */

import { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import logger from '../lib/logger';

declare global {
  // Augment Express Request so TypeScript knows about req.id and req.log
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      id: string;
      log: ReturnType<typeof logger.child>;
    }
  }
}

export function correlationIdMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Accept a forwarded correlation ID (e.g., from an API gateway) or mint a new one.
  const correlationId =
    (req.headers['x-correlation-id'] as string | undefined) ?? uuidv4();

  req.id = correlationId;
  req.log = logger.child({ correlationId, method: req.method, path: req.path });

  res.setHeader('X-Correlation-Id', correlationId);

  req.log.info({ event: 'request.received' });

  res.on('finish', () => {
    req.log.info({
      event: 'request.finished',
      statusCode: res.statusCode,
    });
  });

  next();
}
