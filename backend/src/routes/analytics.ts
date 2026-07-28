import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

/**
 * Analytics router — BE-52 / FE-50
 *
 * GET /api/v1/analytics/revenue
 *   Query params:
 *     merchant {string} — required merchant Stellar address
 *     period   {string} — '30d' | '90d' | 'all'  (default: '30d')
 */

const router = Router();

function cutoffDate(period: string): Date | null {
  if (period === 'all') return null;
  const days = period === '90d' ? 90 : 30;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

function ledgerToMonthKey(ledgerTs: bigint): string {
  const d = new Date(Number(ledgerTs) * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthKeyToLabel(key: string): string {
  const [year, month] = key.split('-').map(Number);
  return new Date(year, month - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
    year: '2-digit',
  });
}

router.get('/revenue', async (req: Request, res: Response) => {
  const merchant = req.query.merchant as string | undefined;
  const period = (req.query.period as string) || '30d';

  if (!merchant) {
    return res.status(400).json({ error: 'merchant query parameter is required' });
  }
  if (!['30d', '90d', 'all'].includes(period)) {
    return res.status(400).json({ error: 'period must be 30d, 90d, or all' });
  }

  try {
    const cutoff = cutoffDate(period);
    const dateFilter =
      cutoff !== null
        ? { ledgerTimestamp: { gte: BigInt(Math.floor(cutoff.getTime() / 1000)) } }
        : {};

    const events = await prisma.event.findMany({
      where: { merchant, ...dateFilter },
      orderBy: { ledgerTimestamp: 'asc' },
    });

    // MRR by month
    const mrrMap = new Map<string, { revenue: bigint; paymentCount: number }>();
    for (const e of events) {
      if (e.type !== 'executed') continue;
      const key = ledgerToMonthKey(e.ledgerTimestamp);
      const cur = mrrMap.get(key) ?? { revenue: 0n, paymentCount: 0 };
      mrrMap.set(key, {
        revenue: cur.revenue + BigInt(e.amount || '0'),
        paymentCount: cur.paymentCount + 1,
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

    const totalRevenue = events
      .filter((e) => e.type === 'executed')
      .reduce((s, e) => s + BigInt(e.amount || '0'), 0n)
      .toString();

    const subscriberSet = new Set(
      events.filter((e) => e.type === 'subscribe').map((e) => e.subscriber),
    );

    const executedCount = events.filter((e) => e.type === 'executed').length;
    const failureCount = events.filter((e) => e.type === 'payment_transfer_failure').length;
    const total = executedCount + failureCount;
    const successRate = total > 0 ? Math.round((executedCount / total) * 100) : 100;

    return res.json({
      period,
      merchant,
      mrr,
      activeSubscribers: subscriberSet.size,
      totalRevenue,
      successRate,
      executedCount,
      failureCount,
      events: events.map((e) => ({ ...e, ledgerTimestamp: e.ledgerTimestamp.toString() })),
    });
  } catch (err) {
    console.error('[analytics] revenue error:', err);
    return res.status(500).json({ error: 'Failed to compute analytics data' });
  }
});

export default router;
