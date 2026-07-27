/**
 * BE-60 — Structured logging with Pino and correlation IDs.
 *
 * Features:
 *  - JSON output to stdout (Pino)
 *  - LOG_LEVEL configurable via env var (default: "info")
 *  - Sensitive Stellar addresses redacted to first-8 + last-8 chars
 *  - pino-pretty transport in development (NODE_ENV !== "production")
 */

import pino from 'pino';

/** Redact a Stellar address: keep first 8 and last 8 chars, mask the middle. */
export function redactAddress(address: string): string {
  if (!address || address.length <= 16) return address;
  const prefix = address.slice(0, 8);
  const suffix = address.slice(-8);
  return `${prefix}...${suffix}`;
}

const isDev = process.env.NODE_ENV !== 'production';
const logLevel = process.env.LOG_LEVEL ?? 'info';

const transport = isDev
  ? (() => {
      try {
        return pino.transport({
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname',
          },
        });
      } catch (error) {
        if (process.env.NODE_ENV !== 'test' && !process.env.JEST_WORKER_ID) {
          console.warn('[logger] pino-pretty transport unavailable, falling back to default logger');
        }
        return undefined;
      }
    })()
  : undefined;

export const logger = pino(
  {
    level: logLevel,
    base: { service: 'soroban-pay-backend' },
    timestamp: pino.stdTimeFunctions.isoTime,
    serializers: {
      err: pino.stdSerializers.err,
      error: pino.stdSerializers.err,
    },
  },
  transport,
);

export default logger;
