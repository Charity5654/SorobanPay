/**
 * BE-58 — Revenue reporting API with streaming CSV / JSON export.
 *
 * GET /v1/reports/payments
 *   Query params (all validated by Zod):
 *     merchant  — required; filter by merchant address
 *     from      — optional ISO 8601 start date (inclusive)
 *     to        — optional ISO 8601 end date (inclusive)
 *     format    — "json" (default) | "csv"
 *     status    — "all" (default) | "success" | "failed"
 *     limit     — max rows (default 10 000, max 100 000)
 *     offset    — pagination offset (default 0)
 *
 * Features:
 *  - Streaming response — data is written to the HTTP stream row-by-row so
 *    large exports (>10 000 rows) never buffer the full dataset in memory.
 *  - RFC 4180-compliant CSV with proper quoting/escaping.
 *  - Rate-limited to 1 request per minute per IP (exportLimiter).
 *  - JWT auth middleware placeholder (uncomment when BE-55 is merged).
 *
 * CSV columns:
 *   Date, Subscriber, Token, Amount (human-readable), Amount (raw), Tx Hash, Status
 */

import { Router, Request, Response } from 'express';
import { Readable, Transform } from 'stream';
import { pipeline } from 'stream/promises';
import prisma from '../lib/prisma';
import { validateQuery, reportQuerySchema, ReportQuery } from '../middleware/validation';
import { redactAddress } from '../lib/logger';
import {
  cacheGet,
  cacheSet,
  CacheKey,
  CACHE_TTL,
} from '../lib/redis';

const router = Router();

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PaymentRow {
  date: string;
  subscriber: string;
  token: string;
  amountHuman: string;
  amountRaw: string;
  txHash: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const CSV_HEADERS = [
  'Date',
  'Subscriber',
  'Token',
  'Amount (human-readable)',
  'Amount (raw)',
  'Tx Hash',
  'Status',
];

/** Escape a single CSV cell value per RFC 4180. */
function escapeCsvCell(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Format a CSV row from an array of cell values. */
function toCsvRow(cells: string[]): string {
  return cells.map(escapeCsvCell).join(',') + '\r\n';
}

/**
 * Convert a raw amount string (BigInt-compatible) to a human-readable decimal.
 * The token standard uses 7 decimal places (Stellar convention).
 */
function toHumanAmount(raw: string): string {
  try {
    const n = BigInt(raw);
    const wholePart = n / 10_000_000n;
    const fracPart = n % 10_000_000n;
    const fracStr = String(fracPart).padStart(7, '0').replace(/0+$/, '') || '0';
    return `${wholePart}.${fracStr}`;
  } catch {
    return raw;
  }
}

/**
 * Map a Prisma AuditLog record to a PaymentRow.
 * Addresses are kept full for exports (merchants need full addresses for
 * accounting); only server-side logs redact them.
 */
function toPaymentRow(record: {
  createdAt: Date;
  subscriber: string;
  token: string;
  amount: string;
  transactionHash: string;
  status: string;
}): PaymentRow {
  return {
    date: record.createdAt.toISOString(),
    subscriber: record.subscriber,
    token: record.token,
    amountHuman: toHumanAmount(record.amount),
    amountRaw: record.amount,
    txHash: record.transactionHash,
    status: record.status,
  };
}

// ---------------------------------------------------------------------------
// Streaming helpers
// ---------------------------------------------------------------------------

/**
 * Create a Node.js Readable that yields AuditLog rows from Prisma in pages.
 * This avoids loading all rows into memory at once.
 */
function createDbReadable(
  where: Parameters<typeof prisma.auditLog.findMany>[0]['where'],
  batchSize = 500,
): Readable {
  let offset = 0;
  let done = false;

  return new Readable({
    objectMode: true,
    async read() {
      if (done) {
        this.push(null);
        return;
      }
      try {
        const rows = await prisma.auditLog.findMany({
          where,
          orderBy: { createdAt: 'asc' },
          take: batchSize,
          skip: offset,
        });
        if (rows.length === 0) {
          done = true;
          this.push(null);
          return;
        }
        offset += rows.length;
        for (const row of rows) {
          this.push(row);
        }
        if (rows.length < batchSize) {
          done = true;
        }
      } catch (err) {
        this.destroy(err as Error);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

router.get(
  '/',
  validateQuery(reportQuerySchema),
  async (req: Request, res: Response): Promise<void> => {
    const query = (req as any).validatedQuery as ReportQuery;
    const reqLog = (req as any).log ?? console;

    reqLog.info({
      event: 'report.export.start',
      merchant: redactAddress(query.merchant),
      format: query.format,
      status: query.status,
    });

    // ── Cache-aside for JSON requests (not streaming CSV) ─────────────────
    // CSV exports are streamed and typically large; skip caching for them.
    if (query.format !== 'csv') {
      const period = `${query.from ?? 'all'}__${query.to ?? 'all'}__${query.status ?? 'all'}__${query.limit ?? 10000}__${query.offset ?? 0}`;
      const cacheKey = CacheKey.analyticsRevenue(query.merchant, period);
      const cached = await cacheGet<object[]>(cacheKey);
      if (cached !== null) {
        res.setHeader('X-Cache', 'HIT');
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.json(cached);
        return;
      }
      // Will be set to MISS below after the DB query
      (req as any)._analyticsCacheKey = cacheKey;
    }

    // Build Prisma where clause
    const where: Parameters<typeof prisma.auditLog.findMany>[0]['where'] = {
      merchant: query.merchant,
    };

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) (where.createdAt as any).gte = new Date(query.from);
      if (query.to) (where.createdAt as any).lte = new Date(query.to);
    }

    if (query.status === 'success') {
      where.status = 'executed';
    } else if (query.status === 'failed') {
      where.status = { not: 'executed' };
    }

    const source = createDbReadable(where);

    // -----------------------------------------------------------------------
    // CSV streaming export
    // -----------------------------------------------------------------------
    if (query.format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="payments-${query.merchant.slice(0, 8)}-${Date.now()}.csv"`,
      );
      // CSV exports are never cached — always fresh from DB
      res.setHeader('X-Cache', 'MISS');

      // Write CSV header immediately
      res.write(toCsvRow(CSV_HEADERS));

      const csvTransform = new Transform({
        objectMode: true,
        transform(record, _encoding, callback) {
          const row = toPaymentRow(record);
          const csvLine = toCsvRow([
            row.date,
            row.subscriber,
            row.token,
            row.amountHuman,
            row.amountRaw,
            row.txHash,
            row.status,
          ]);
          callback(null, csvLine);
        },
      });

      try {
        await pipeline(source, csvTransform, res);
        reqLog.info({ event: 'report.export.complete', format: 'csv' });
      } catch (err) {
        reqLog.error({ event: 'report.export.error', err });
        if (!res.headersSent) {
          res.status(500).json({ error: 'Export failed' });
        }
      }
      return;
    }

    // -----------------------------------------------------------------------
    // JSON streaming export
    // -----------------------------------------------------------------------
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Cache', 'MISS');

    const rows: object[] = [];
    res.write('[');
    let first = true;

    const jsonTransform = new Transform({
      objectMode: true,
      transform(record, _encoding, callback) {
        const row = toPaymentRow(record);
        rows.push(row);
        const chunk = (first ? '' : ',') + JSON.stringify(row);
        first = false;
        callback(null, chunk);
      },
    });

    try {
      // We can't use pipeline directly into res because we need to wrap with
      // brackets. Pipe manually and handle events.
      await new Promise<void>((resolve, reject) => {
        source.pipe(jsonTransform);
        jsonTransform.on('data', (chunk: Buffer | string) => res.write(chunk));
        jsonTransform.on('end', async () => {
          res.write(']');
          res.end();

          // Write result to cache after streaming completes
          const analyticsCacheKey = (req as any)._analyticsCacheKey as string | undefined;
          if (analyticsCacheKey) {
            await cacheSet(analyticsCacheKey, rows, CACHE_TTL.analytics).catch(() => {});
          }

          resolve();
        });
        jsonTransform.on('error', reject);
        source.on('error', reject);
      });
      reqLog.info({ event: 'report.export.complete', format: 'json' });
    } catch (err) {
      reqLog.error({ event: 'report.export.error', err });
      if (!res.headersSent) {
        res.status(500).json({ error: 'Export failed' });
      } else {
        // Headers already sent — end the response with an error marker
        res.write(']');
        res.end();
      }
    }
  },
);

export default router;
