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

// ─── BE-52: GET /v1/subscriptions?merchant={address} ─────────────────────────
// List all active subscriptions for a merchant via query param.
// This mirrors /merchant/:merchantAddress but follows the ?merchant= convention
// specified in the BE-52 OpenAPI spec.
router.get('/', async (req: Request, res: Response) => {
  const merchantAddress = req.query.merchant as string | undefined;
  if (!merchantAddress) {
    return res.status(400).json({ error: 'merchant query parameter is required' });
  }

  try {
    const subscribeEvents = await prisma.event.findMany({
      where: { merchant: merchantAddress, type: 'subscribe' },
      orderBy: { ledgerTimestamp: 'desc' },
    });

    const seen = new Map<string, (typeof subscribeEvents)[0]>();
    for (const event of subscribeEvents) {
      const key = `${event.subscriber}:${event.token}`;
      if (!seen.has(key)) seen.set(key, event);
    }

    const subscriptions = await Promise.all(
      Array.from(seen.values()).map(async (sub) => {
        const [lastExecuted, status] = await Promise.all([
          prisma.event.findFirst({
            where: { merchant: merchantAddress, subscriber: sub.subscriber, token: sub.token, type: 'executed' },
            orderBy: { ledgerTimestamp: 'desc' },
          }),
          getSubscriptionStatus(sub.subscriber, merchantAddress),
        ]);
        return {
          subscriber: sub.subscriber,
          merchant: sub.merchant,
          token: sub.token,
          amount: sub.amount,
          status: status ?? 'ACTIVE',
          interval: null,
          nextPaymentDue: null,
          lastPaymentAt: lastExecuted?.ledgerTimestamp?.toString() ?? null,
        };
      }),
    );

    return res.json(subscriptions);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch subscriptions' });
  }
});

// ─── BE-52: GET /v1/subscriptions/:subscriber/:merchant ───────────────────────
// Single subscription detail for a (subscriber, merchant) pair.
router.get('/:subscriber/:merchant', async (req: Request, res: Response) => {
  // Skip if this looks like a retry sub-path (handled by later routes)
  if (req.params.merchant === 'retries') {
    return res.status(400).json({ error: 'Invalid path — did you mean /:subscriber/:merchant/retries?' });
  }

  const { subscriber, merchant } = req.params;
  try {
    const [subEvent, lastExecuted, status] = await Promise.all([
      prisma.event.findFirst({
        where: { subscriber, merchant, type: 'subscribe' },
        orderBy: { ledgerTimestamp: 'desc' },
      }),
      prisma.event.findFirst({
        where: { subscriber, merchant, type: 'executed' },
        orderBy: { ledgerTimestamp: 'desc' },
      }),
      getSubscriptionStatus(subscriber, merchant),
    ]);

    if (!subEvent) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    return res.json({
      subscriber: subEvent.subscriber,
      merchant: subEvent.merchant,
      token: subEvent.token,
      amount: subEvent.amount,
      status: status ?? 'ACTIVE',
      interval: null,
      nextPaymentDue: null,
      lastPaymentAt: lastExecuted?.ledgerTimestamp?.toString() ?? null,
      createdAt: subEvent.ledgerTimestamp.toString(),
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch subscription' });
  }
});

// ─── BE-52: GET /v1/payments?merchant=&from=&to= ─────────────────────────────
// Payment history with optional date-range filtering.
// Query params:
//   merchant {string}  — required
//   from     {string}  — ISO 8601 date, optional lower bound (inclusive)
//   to       {string}  — ISO 8601 date, optional upper bound (inclusive)
//   limit    {number}  — default 50
//   offset   {number}  — default 0
router.get('/payments', async (req: Request, res: Response) => {
  const merchantAddress = req.query.merchant as string | undefined;
  if (!merchantAddress) {
    return res.status(400).json({ error: 'merchant query parameter is required' });
  }

  const fromParam = req.query.from as string | undefined;
  const toParam = req.query.to as string | undefined;
  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
  const offset = Math.max(parseInt((req.query.offset as string) ?? '0', 10), 0);

  // Build ledger timestamp filter from ISO date strings
  const ledgerFilter: Record<string, bigint> = {};
  if (fromParam) {
    const fromDate = new Date(fromParam);
    if (isNaN(fromDate.getTime())) {
      return res.status(400).json({ error: 'from must be a valid ISO 8601 date' });
    }
    ledgerFilter.gte = BigInt(Math.floor(fromDate.getTime() / 1000));
  }
  if (toParam) {
    const toDate = new Date(toParam);
    if (isNaN(toDate.getTime())) {
      return res.status(400).json({ error: 'to must be a valid ISO 8601 date' });
    }
    toDate.setHours(23, 59, 59, 999);
    ledgerFilter.lte = BigInt(Math.floor(toDate.getTime() / 1000));
  }

  try {
    const [payments, total] = await prisma.$transaction([
      prisma.event.findMany({
        where: {
          merchant: merchantAddress,
          type: 'executed',
          ...(Object.keys(ledgerFilter).length > 0 && { ledgerTimestamp: ledgerFilter }),
        },
        orderBy: { ledgerTimestamp: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.event.count({
        where: {
          merchant: merchantAddress,
          type: 'executed',
          ...(Object.keys(ledgerFilter).length > 0 && { ledgerTimestamp: ledgerFilter }),
        },
      }),
    ]);

    return res.json({
      data: payments.map((p) => ({
        ...p,
        ledgerTimestamp: p.ledgerTimestamp.toString(),
      })),
      meta: { total, limit, offset },
    });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch payment history' });
  }
});

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
