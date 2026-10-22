/**
 * GET /payments/:merchant
 *
 * Returns paginated payment history for a merchant address.
 * Supports filtering by event type, date range, and subscriber.
 * Supports CSV export via Accept: text/csv header.
 *
 * Issue: #1374
 *
 * Query parameters:
 *   event_type  — filter: executed | failure | cancel
 *   subscriber  — filter by subscriber address
 *   from        — ISO date string (inclusive lower bound on occurred_at)
 *   to          — ISO date string (inclusive upper bound on occurred_at)
 *   page        — 1-based page number (default: 1)
 *   pageSize    — records per page, max 100 (default: 20)
 *
 * Response:
 *   JSON (default)  — { data: Payment[], pagination: PaginationMeta }
 *   CSV             — when Accept: text/csv is sent
 *
 * OpenAPI spec: see /docs endpoint served by the main app.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { getPool } from '../db/pool';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Payment {
  id: number;
  tx_hash: string;
  event_type: 'executed' | 'failure' | 'cancel';
  subscriber: string;
  merchant: string;
  amount: string;
  payment_nonce: string | null;
  ledger_seq: number | null;
  occurred_at: string;
}

export interface PaginationMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface PaymentsResponse {
  data: Payment[];
  pagination: PaginationMeta;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const VALID_EVENT_TYPES = new Set(['executed', 'failure', 'cancel']);

function parsePositiveInt(value: unknown, fallback: number, max?: number): number {
  const n = parseInt(String(value), 10);
  if (Number.isNaN(n) || n < 1) return fallback;
  if (max !== undefined && n > max) return max;
  return n;
}

function isValidDate(value: string): boolean {
  const d = new Date(value);
  return !Number.isNaN(d.getTime());
}

/**
 * Convert an array of Payment rows to a CSV string.
 */
function toCSV(rows: Payment[]): string {
  const headers = [
    'id',
    'tx_hash',
    'event_type',
    'subscriber',
    'merchant',
    'amount',
    'payment_nonce',
    'ledger_seq',
    'occurred_at',
  ];

  const escape = (val: unknown): string => {
    if (val === null || val === undefined) return '';
    const s = String(val);
    // RFC 4180: wrap in quotes if value contains comma, quote, or newline
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };

  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(
      headers.map((h) => escape(row[h as keyof Payment])).join(','),
    );
  }
  return lines.join('\r\n');
}

// ---------------------------------------------------------------------------
// Route factory — accepts an optional pool for testing
// ---------------------------------------------------------------------------

export function createPaymentsRouter(pool?: Pool): Router {
  const router = Router();
  const db = pool ?? getPool();

  /**
   * @openapi
   * /payments/{merchant}:
   *   get:
   *     summary: List payment history for a merchant
   *     tags: [Payments]
   *     parameters:
   *       - in: path
   *         name: merchant
   *         required: true
   *         schema:
   *           type: string
   *         description: Merchant Stellar address
   *       - in: query
   *         name: event_type
   *         schema:
   *           type: string
   *           enum: [executed, failure, cancel]
   *         description: Filter by payment event type
   *       - in: query
   *         name: subscriber
   *         schema:
   *           type: string
   *         description: Filter by subscriber address
   *       - in: query
   *         name: from
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Lower bound for occurred_at (inclusive)
   *       - in: query
   *         name: to
   *         schema:
   *           type: string
   *           format: date-time
   *         description: Upper bound for occurred_at (inclusive)
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *       - in: query
   *         name: pageSize
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *     responses:
   *       200:
   *         description: Payment history
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/PaymentsResponse'
   *           text/csv:
   *             schema:
   *               type: string
   *       400:
   *         description: Invalid query parameters
   *       500:
   *         description: Internal server error
   */
  router.get(
    '/payments/:merchant',
    async (req: Request, res: Response, next: NextFunction): Promise<void> => {
      try {
        const { merchant } = req.params;
        const {
          event_type,
          subscriber,
          from,
          to,
        } = req.query;

        // --- Validate filters ---
        if (event_type !== undefined && !VALID_EVENT_TYPES.has(String(event_type))) {
          res.status(400).json({
            error: `Invalid event_type. Must be one of: ${[...VALID_EVENT_TYPES].join(', ')}`,
          });
          return;
        }

        if (from !== undefined && !isValidDate(String(from))) {
          res.status(400).json({ error: 'Invalid "from" date.' });
          return;
        }

        if (to !== undefined && !isValidDate(String(to))) {
          res.status(400).json({ error: 'Invalid "to" date.' });
          return;
        }

        const page = parsePositiveInt(req.query.page, 1);
        const pageSize = parsePositiveInt(req.query.pageSize, 20, 100);
        const offset = (page - 1) * pageSize;

        // --- Build WHERE clause ---
        const conditions: string[] = ['merchant = $1'];
        const params: unknown[] = [merchant];
        let paramIdx = 2;

        if (event_type) {
          conditions.push(`event_type = $${paramIdx++}`);
          params.push(String(event_type));
        }

        if (subscriber) {
          conditions.push(`subscriber = $${paramIdx++}`);
          params.push(String(subscriber));
        }

        if (from) {
          conditions.push(`occurred_at >= $${paramIdx++}`);
          params.push(new Date(String(from)));
        }

        if (to) {
          conditions.push(`occurred_at <= $${paramIdx++}`);
          params.push(new Date(String(to)));
        }

        const whereClause = conditions.join(' AND ');

        // --- Count total ---
        const countResult = await db.query<{ count: string }>(
          `SELECT COUNT(*) AS count FROM payments WHERE ${whereClause}`,
          params,
        );
        const total = parseInt(countResult.rows[0]?.count ?? '0', 10);

        // --- Determine whether to paginate (CSV exports all matching rows) ---
        const wantsCSV =
          req.headers.accept?.toLowerCase().includes('text/csv') ?? false;

        let dataResult: { rows: Payment[] };

        if (wantsCSV) {
          // For CSV we return all matching rows (no pagination)
          dataResult = await db.query<Payment>(
            `SELECT
               id, tx_hash, event_type, subscriber, merchant,
               amount::text AS amount,
               payment_nonce,
               ledger_seq,
               occurred_at
             FROM payments
             WHERE ${whereClause}
             ORDER BY occurred_at DESC`,
            params,
          );
        } else {
          dataResult = await db.query<Payment>(
            `SELECT
               id, tx_hash, event_type, subscriber, merchant,
               amount::text AS amount,
               payment_nonce,
               ledger_seq,
               occurred_at
             FROM payments
             WHERE ${whereClause}
             ORDER BY occurred_at DESC
             LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`,
            [...params, pageSize, offset],
          );
        }

        // --- Respond ---
        if (wantsCSV) {
          const csv = toCSV(dataResult.rows);
          const filename = `payments_${merchant}_${Date.now()}.csv`;
          res.setHeader('Content-Type', 'text/csv');
          res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
          res.send(csv);
          return;
        }

        const response: PaymentsResponse = {
          data: dataResult.rows,
          pagination: {
            page,
            pageSize,
            total,
            totalPages: Math.ceil(total / pageSize),
          },
        };

        res.json(response);
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
}
