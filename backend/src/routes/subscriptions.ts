import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { getSubscriptionStatus } from '../services/subscriptionStateService';
import { getRawRetries, cancelRetries } from '../services/retryQueue';
import {
  cacheGet,
  cacheSet,
  CacheKey,
  CACHE_TTL,
} from '../lib/redis';

const router = Router();

// GET /merchant/:merchantAddress
// Returns one subscription object per unique (subscriber, merchant, token) pair.
// interval and nextPaymentDue are not stored in the Event table (only available
// from on-chain state), so they are returned as null.
//
// Cache: subscriptions:merchant:{address}  TTL = CACHE_TTL.subscriptions (60 s)
// Header: X-Cache: HIT | MISS
router.get('/merchant/:merchantAddress', async (req: Request, res: Response) => {
  try {
    const merchantAddress = req.params.merchantAddress as string;
    const tokenFilter = req.query.token;
    const token = Array.isArray(tokenFilter) ? tokenFilter[0] : (tokenFilter as string | undefined);

    // Build a deterministic cache key that includes any query parameters
    const cacheKey = token
      ? `${CacheKey.merchantSubscriptions(merchantAddress)}:token:${token}`
      : CacheKey.merchantSubscriptions(merchantAddress);

    // ── Cache-aside: try Redis first ──────────────────────────────────────
    const cached = await cacheGet<object[]>(cacheKey);
    if (cached !== null) {
      res.setHeader('X-Cache', 'HIT');
      res.json(cached);
      return;
    }

    // ── Cache miss: query PostgreSQL ──────────────────────────────────────
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

    // ── Write result to cache ─────────────────────────────────────────────
    await cacheSet(cacheKey, subscriptions, CACHE_TTL.subscriptions);

    res.setHeader('X-Cache', 'MISS');
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

// ─── Retry endpoints ──────────────────────────────────────────────────────────

/**
 * GET /v1/subscriptions/:subscriber/:merchant/retries
 *
 * Returns all payment retry records for the given subscription pair,
 * ordered by attempt_number ascending.
 *
 * Response 200:
 *   [
 *     {
 *       id: number,
 *       subscriber: string,
 *       merchant: string,
 *       amount: string,
 *       token: string,
 *       attemptNumber: number,
 *       status: "pending" | "succeeded" | "failed" | "cancelled",
 *       scheduledAt: ISO string,
 *       attemptedAt: ISO string | null,
 *       error: string | null,
 *       createdAt: ISO string,
 *     }
 *   ]
 *
 * Response 400: missing subscriber or merchant param
 * Response 500: database error
 */
router.get('/:subscriber/:merchant/retries', async (req: Request, res: Response) => {
  const subscriber = req.params.subscriber as string;
  const merchant = req.params.merchant as string;

  if (!subscriber || !merchant) {
    res.status(400).json({ error: 'subscriber and merchant path parameters are required' });
    return;
  }

  try {
    const retries = await getRawRetries(subscriber, merchant);
    res.json(
      retries.map((r) => ({
        id: r.id,
        subscriber: r.subscriber,
        merchant: r.merchant,
        amount: r.amount,
        token: r.token,
        attemptNumber: r.attemptNumber,
        status: r.status,
        scheduledAt: r.scheduledAt,
        attemptedAt: r.attemptedAt ?? null,
        error: r.error ?? null,
        createdAt: r.createdAt,
      })),
    );
  } catch (error) {
    console.error('[retries GET] failed to fetch retries:', error);
    res.status(500).json({ error: 'Failed to fetch retry records' });
  }
});

/**
 * DELETE /v1/subscriptions/:subscriber/:merchant/retries
 *
 * Cancels all pending retry jobs for the given subscription pair.
 * Already-executed or already-cancelled retries are left unchanged.
 *
 * Response 200: { cancelled: number }   — count of retries cancelled
 * Response 400: missing params
 * Response 500: cancellation error
 */
router.delete('/:subscriber/:merchant/retries', async (req: Request, res: Response) => {
  const subscriber = req.params.subscriber as string;
  const merchant = req.params.merchant as string;

  if (!subscriber || !merchant) {
    res.status(400).json({ error: 'subscriber and merchant path parameters are required' });
    return;
  }

  try {
    // Count pending before cancelling so we can report back how many were affected
    const before = await getRawRetries(subscriber, merchant);
    const pendingBefore = before.filter((r) => r.status === 'pending').length;

    await cancelRetries(subscriber, merchant);

    res.json({ cancelled: pendingBefore });
  } catch (error) {
    console.error('[retries DELETE] failed to cancel retries:', error);
    res.status(500).json({ error: 'Failed to cancel retry records' });
  }
});

export default router;
