import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getSubscriptionStatus } from '../services/subscriptionStateService';

const router = Router();

// GET /merchant/:merchantAddress
// Returns one subscription object per unique (subscriber, merchant, token) pair.
// interval and nextPaymentDue are not stored in the Event table (only available
// from on-chain state), so they are returned as null.
router.get('/merchant/:merchantAddress', async (req: Request, res: Response) => {
  try {
    const merchantAddress = req.params.merchantAddress as string;
    const tokenFilter = req.query.token;
    const token = Array.isArray(tokenFilter) ? tokenFilter[0] : tokenFilter;

    const where: Record<string, unknown> = { merchant: merchantAddress, type: 'subscribe' };
    if (token) {
      where.token = token;
    }

    // Fetch all subscribe events for this merchant, latest first
    const subscribeEvents = await prisma.event.findMany({
      where,
      orderBy: { ledgerTimestamp: 'desc' },
    });

    // Deduplicate by (subscriber, token): keep the latest subscribe event per pair
    const seen = new Map<string, (typeof subscribeEvents)[0]>();
    for (const event of subscribeEvents) {
      const key = `${event.subscriber}:${event.token}`;
      if (!seen.has(key)) {
        seen.set(key, event);
      }
    }

    // For each unique pair, find the latest executed event and current status
    const subscriptions = await Promise.all(
      Array.from(seen.values()).map(async (sub) => {
        const [lastExecuted, status] = await Promise.all([
          prisma.event.findFirst({
            where: {
              merchant: merchantAddress,
              subscriber: sub.subscriber,
              token: sub.token,
              type: 'executed',
            },
            orderBy: { ledgerTimestamp: 'desc' },
          }),
          getSubscriptionStatus(sub.subscriber, merchantAddress),
        ]);

        return {
          subscriber: sub.subscriber,
          merchant: sub.merchant,
          token: sub.token,
          amount: sub.amount,
          status: status ?? 'ACTIVE',   // BE-67: lifecycle state
          interval: null,               // not stored in Event table; retrieve from on-chain state
          nextPaymentDue: null,         // not computable from Event table alone
          lastPaymentAt: lastExecuted?.ledgerTimestamp ?? null,
        };
      })
    );

    res.json(subscriptions);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// GET /merchant/:merchantAddress/payments
// Returns all executed (payment) events for the merchant, newest first.
// Supports ?limit= and ?offset= for pagination (default limit 50).
router.get('/merchant/:merchantAddress/payments', async (req: Request, res: Response) => {
  try {
    const merchantAddress = req.params.merchantAddress as string;
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const payments = await prisma.event.findMany({
      where: { merchant: merchantAddress, type: 'executed' },
      orderBy: { ledgerTimestamp: 'desc' },
      take: limit,
      skip: offset,
    });

    res.json(payments);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch payments' });
  }
});

export default router;
