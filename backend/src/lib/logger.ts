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

/** Redact sensitive Stellar secret seed or private token */
export function redactSecret(secret: string): string {
  if (!secret) return secret;
  if (/^S[A-Z0-9]{55}$/.test(secret)) {
    return `${secret.slice(0, 4)}...[REDACTED_SEED]`;
  }
  if (secret.length > 8) {
    return `${secret.slice(0, 4)}...[REDACTED]`;
  }
  return '[REDACTED]';
}

const SENSITIVE_KEY_PATTERN = /^(password|secret|seed|authorization|token|apikey|privatekey|webhooksecret)$/i;

/** Recursively redact sensitive fields from telemetry or log payload objects */
export function redactTelemetryPayload<T>(payload: T): T {
  if (payload === null || payload === undefined) return payload;
  if (typeof payload === 'string') {
    if (/^S[A-Z0-9]{55}$/.test(payload)) {
      return redactSecret(payload) as unknown as T;
    }
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => redactTelemetryPayload(item)) as unknown as T;
  }
  if (typeof payload === 'object') {
    const output: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        output[key] = '[REDACTED]';
      } else if (key.toLowerCase().includes('address') && typeof value === 'string') {
        output[key] = redactAddress(value);
      } else {
        output[key] = redactTelemetryPayload(value);
      }
    }
    return output as T;
  }
  return payload;
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
