import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

/**
 * POST /api/v1/webhooks/endpoints
 * Register a webhook endpoint for a merchant.
 * Body: { merchant: string; url: string; secret?: string }
 */
router.post('/endpoints', async (req: Request, res: Response) => {
  const { merchant, url, secret } = req.body ?? {};
  if (!merchant || !url) {
    return res.status(400).json({ error: 'merchant and url are required' });
  }
  try {
    new URL(url); // validate URL format
  } catch {
    return res.status(400).json({ error: 'url is not a valid URL' });
  }

  try {
    const endpoint = await prisma.webhookEndpoint.upsert({
      where: { merchant_url: { merchant, url } },
      update: { active: true, ...(secret !== undefined && { secret }) },
      create: { merchant, url, active: true, secret: secret ?? null },
    });
    // Never return the secret in the response
    const { secret: _secret, ...safeEndpoint } = endpoint as typeof endpoint & { secret?: string };
    res.status(201).json(safeEndpoint);
  } catch (err) {
    res.status(500).json({ error: 'Failed to register endpoint' });
  }
});

/**
 * DELETE /api/v1/webhooks/endpoints
 * Deactivate a webhook endpoint.
 * Body: { merchant: string; url: string }
 */
router.delete('/endpoints', async (req: Request, res: Response) => {
  const { merchant, url } = req.body ?? {};
  if (!merchant || !url) {
    return res.status(400).json({ error: 'merchant and url are required' });
  }
  try {
    await prisma.webhookEndpoint.updateMany({
      where: { merchant, url },
      data: { active: false },
    });
    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: 'Failed to deactivate endpoint' });
  }
});

/**
 * GET /api/v1/webhooks/deliveries/:merchant
 * Return recent delivery log for a merchant (last 100 entries).
 *
 * Response includes both `eventId` (stable idempotency key) and
 * `deliveryId` (unique per attempt) for each delivery record.
 */
router.get('/deliveries/:merchant', async (req: Request, res: Response) => {
  try {
    const deliveries = await prisma.webhookDelivery.findMany({
      where: { merchant: req.params.merchant },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        eventId: true,
        deliveryId: true,
        url: true,
        merchant: true,
        event: true,
        statusCode: true,
        attempt: true,
        success: true,
        error: true,
        createdAt: true,
        // Omit raw payload from listing to keep responses compact
      },
    });
    res.json(deliveries);
  } catch {
    res.status(500).json({ error: 'Failed to fetch deliveries' });
  }
});

/**
 * GET /api/v1/webhooks/:id/deliveries
 * Return all delivery attempts for a specific webhook endpoint.
 *
 * `:id` is the WebhookEndpoint.id (integer).
 *
 * Query params:
 *   limit  — max records to return (default 50, max 200)
 *   offset — pagination offset (default 0)
 *
 * Each record includes:
 *   eventId    — stable identifier for the on-chain event (idempotency key)
 *   deliveryId — unique UUID per delivery attempt
 *   attempt    — retry attempt number (1 = first try)
 *   success    — whether the merchant endpoint returned 2xx
 */
router.get('/:id/deliveries', async (req: Request, res: Response) => {
  const endpointId = parseInt(req.params.id, 10);
  if (isNaN(endpointId)) {
    return res.status(400).json({ error: 'id must be an integer' });
  }

  const limit  = Math.min(parseInt((req.query.limit  as string) ?? '50', 10), 200);
  const offset = Math.max(parseInt((req.query.offset as string) ?? '0',  10), 0);

  try {
    const [deliveries, total] = await prisma.$transaction([
      prisma.webhookDelivery.findMany({
        where: { endpointId },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        select: {
          id: true,
          eventId: true,
          deliveryId: true,
          url: true,
          merchant: true,
          event: true,
          statusCode: true,
          attempt: true,
          success: true,
          error: true,
          createdAt: true,
        },
      }),
      prisma.webhookDelivery.count({ where: { endpointId } }),
    ]);

    res.json({
      data: deliveries,
      meta: { total, limit, offset },
    });
  } catch {
    res.status(500).json({ error: 'Failed to fetch delivery history' });
  }
});

export default router;
