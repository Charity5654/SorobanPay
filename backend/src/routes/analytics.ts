import { Router, Request, Response } from 'express';
import { z } from 'zod';
import prisma from '../lib/prisma';
import {
  getPaginatedEvents,
  getTenantAggregates,
} from '../services/analyticsService';
import { tenantAuthMiddleware, requireTenant, TenantRequest } from '../middleware/tenantAuth';
import { validateQuery } from '../middleware/validation';

/**
 * Analytics router — BE-52 / FE-50
 *
 * GET /api/v1/analytics/revenue
 *   Query params:
 *     merchant {string} — required merchant Stellar address
 *     period   {string} — '30d' | '90d' | 'all'  (default: '30d')
 *
 * Response:
 * {
 *   period: string,
 *   merchant: string,
 *   mrr: { month: string, label: string, revenue: string, paymentCount: number }[],
 *   activeSubscribers: number,
 *   totalRevenue: string,
 *   successRate: number,    // 0-100
 *   executedCount: number,
 *   failureCount: number,
 *   events: Event[]        // raw events for client-side computation
 * }
 *
 * GET /api/v1/analytics/events   (#1070)
 *   Cursor-paginated list of analytics events for the authenticated tenant.
 *   Query params: cursor, limit (1-200), direction ('forward'|'backward')
 *   Requires tenant context (X-Tenant-ID header or JWT claim).
 *
 * GET /api/v1/analytics/aggregates   (#1070)
 *   Tenant-scoped aggregate statistics.
 *   Query params: startDate (ISO 8601), endDate (ISO 8601)
 *   Requires tenant context.
 */

const router = Router();

/** Returns a Date representing `days` ago from now, or null for 'all'. */
function cutoffDate(period: string): Date | null {
  if (period === 'all') return null;
  const days = period === '90d' ? 90 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/**
 * Format a ledger Unix timestamp (seconds, BigInt) to "YYYY-MM" month key.
 */
function ledgerToMonthKey(ledgerTs: bigint): string {
  const d = new Date(Number(ledgerTs) * 1000);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/**
 * Format a "YYYY-MM" key to a short label like "Jan 24".
 */
function monthKeyToLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  const d = new Date(year, month - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

// GET /v1/analytics/revenue?merchant=...&period=30d|90d|all
router.get('/revenue', async (req: Request, res: Response) => {
  const merchant = req.query.merchant as string | undefined;
  const period = (req.query.period as string) || '30d';

  if (!merchant) {
    return res.status(400).json({ error: 'merchant query parameter is required' });
  }

  const validPeriods = ['30d', '90d', 'all'];
  if (!validPeriods.includes(period)) {
    return res
      .status(400)
      .json({ error: `period must be one of: ${validPeriods.join(', ')}` });
  }

  try {
    const cutoff = cutoffDate(period);

    // ── Build WHERE clause ─────────────────────────────────────────────────
    const dateFilter =
      cutoff !== null
        ? { ledgerTimestamp: { gte: BigInt(Math.floor(cutoff.getTime() / 1000)) } }
        : {};

    // Fetch all relevant events for this merchant
    const events = await prisma.event.findMany({
      where: {
        merchant,
        ...dateFilter,
      },
      orderBy: { ledgerTimestamp: 'asc' },
    });

    // ── MRR by month ───────────────────────────────────────────────────────
    const mrrMap = new Map<
      string,
      { revenue: bigint; paymentCount: number }
    >();

    for (const e of events) {
      if (e.type !== 'executed') continue;
      const key = ledgerToMonthKey(e.ledgerTimestamp);
      const existing = mrrMap.get(key) ?? { revenue: 0n, paymentCount: 0 };
      mrrMap.set(key, {
        revenue: existing.revenue + BigInt(e.amount || '0'),
        paymentCount: existing.paymentCount + 1,
      });
    }

    const mrr = Array.from(mrrMap.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => ({
        month: key,
        label: monthKeyToLabel(key),
        revenue: val.revenue.toString(),
        paymentCount: val.paymentCount,
      }));

    // ── Total revenue ──────────────────────────────────────────────────────
    const totalRevenue = events
      .filter((e) => e.type === 'executed')
      .reduce((sum, e) => sum + BigInt(e.amount || '0'), 0n)
      .toString();

    // ── Active subscribers ─────────────────────────────────────────────────
    const subscriberSet = new Set<string>();
    for (const e of events) {
      if (e.type === 'subscribe') subscriberSet.add(e.subscriber);
    }
    const activeSubscribers = subscriberSet.size;

    // ── Success rate ───────────────────────────────────────────────────────
    const executedCount = events.filter((e) => e.type === 'executed').length;
    const failureCount = events.filter(
      (e) => e.type === 'payment_transfer_failure',
    ).length;
    const total = executedCount + failureCount;
    const successRate =
      total > 0 ? Math.round((executedCount / total) * 100) : 100;

    // Serialize BigInt fields for JSON
    const serializedEvents = events.map((e) => ({
      ...e,
      ledgerTimestamp: e.ledgerTimestamp.toString(),
    }));

    return res.json({
      period,
      merchant,
      mrr,
      activeSubscribers,
      totalRevenue,
      successRate,
      executedCount,
      failureCount,
      events: serializedEvents,
    });
  } catch (error) {
    console.error('[analytics] Failed to compute revenue metrics:', error);
    return res.status(500).json({ error: 'Failed to compute analytics data' });
  }
});

// ─── Cursor pagination schemas (#1070) ───────────────────────────────────────

const eventsQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  direction: z.enum(['forward', 'backward']).default('forward'),
});

const aggregatesQuerySchema = z.object({
  startDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
  endDate: z
    .string()
    .datetime({ offset: true })
    .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
    .optional(),
});

// ─── GET /events ──────────────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/events
 *
 * Returns a cursor-paginated list of analytics events for the authenticated
 * tenant (scoped by tenant ID).
 *
 * Query params:
 *   cursor    — opaque continuation token from a previous response
 *   limit     — items per page (1–200, default 50)
 *   direction — 'forward' (default) or 'backward'
 *
 * Requires X-Tenant-ID header or JWT with tenant_id claim.
 */
router.get(
  '/events',
  tenantAuthMiddleware,
  requireTenant,
  validateQuery(eventsQuerySchema),
  async (req: TenantRequest, res: Response) => {
    const query = (req as any).validatedQuery as z.infer<typeof eventsQuerySchema>;

    try {
      const page = await getPaginatedEvents(req.tenantId!, {
        cursor: query.cursor,
        limit: query.limit,
        direction: query.direction,
      });

      return res.json(page);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      if (message === 'Invalid cursor') {
        return res.status(400).json({ error: 'Invalid cursor' });
      }
      console.error('[analytics] getPaginatedEvents error:', err);
      return res.status(500).json({ error: 'Failed to retrieve events' });
    }
  },
);

// ─── GET /aggregates ──────────────────────────────────────────────────────────

/**
 * GET /api/v1/analytics/aggregates
 *
 * Returns tenant-scoped aggregate statistics.
 *
 * Query params:
 *   startDate — optional ISO 8601 start (inclusive)
 *   endDate   — optional ISO 8601 end (inclusive)
 *
 * Requires X-Tenant-ID header or JWT with tenant_id claim.
 */
router.get(
  '/aggregates',
  tenantAuthMiddleware,
  requireTenant,
  validateQuery(aggregatesQuerySchema),
  async (req: TenantRequest, res: Response) => {
    const query = (req as any).validatedQuery as z.infer<typeof aggregatesQuerySchema>;

    try {
      const aggregates = await getTenantAggregates(
        req.tenantId!,
        query.startDate ? new Date(query.startDate) : undefined,
        query.endDate ? new Date(query.endDate) : undefined,
      );

      return res.json(aggregates);
    } catch (err) {
      console.error('[analytics] getTenantAggregates error:', err);
      return res.status(500).json({ error: 'Failed to retrieve aggregates' });
    }
  },
);

export default router;
