import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

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

export default router;
