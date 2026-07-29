/**
 * Webhooks router — BE-53
 *
 * Endpoints:
 *   POST   /api/v1/webhooks              — register a new webhook endpoint
 *   GET    /api/v1/webhooks?merchant=    — list endpoints for a merchant
 *   PATCH  /api/v1/webhooks/:id          — update endpoint (url, secret, events, active)
 *   DELETE /api/v1/webhooks/:id          — permanently delete an endpoint
 *
 * Legacy endpoints (kept for backward compatibility):
 *   POST   /api/v1/webhooks/endpoints    — register (mirrors POST /)
 *   DELETE /api/v1/webhooks/endpoints    — deactivate (mirrors DELETE /:id)
 *
 *   GET    /api/v1/webhooks/deliveries/:merchant  — recent deliveries for merchant
 *   GET    /api/v1/webhooks/:id/deliveries        — deliveries for specific endpoint
 *
 * Security:
 *   - Webhook URLs must be HTTPS when NODE_ENV === 'production'
 *   - Secrets are never returned in responses
 *   - HMAC-SHA256 signature included on all deliveries (X-SorobanPay-Signature)
 */

import { Router, Request, Response } from 'express';
import { randomBytes } from 'crypto';
import prisma from '../lib/prisma';

const router = Router();

const IS_PRODUCTION = process.env.NODE_ENV === 'production';

/** Valid event types that can be subscribed to. */
const VALID_EVENT_TYPES = new Set([
  'payment.executed',
  'payment.failed',
  'subscription.cancelled',
]);

function validateUrl(url: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'url is not a valid URL' };
  }
  if (IS_PRODUCTION && parsed.protocol !== 'https:') {
    return { valid: false, error: 'Webhook URLs must use HTTPS in production' };
  }
  return { valid: true };
}

function validateEvents(events: unknown): { valid: boolean; error?: string; value: string } {
  if (!events) return { valid: true, value: 'payment.executed,payment.failed' };
  const arr = Array.isArray(events) ? events : [events];
  const invalid = arr.filter((e) => !VALID_EVENT_TYPES.has(String(e)));
  if (invalid.length > 0) {
    return {
      valid: false,
      error: `Invalid event types: ${invalid.join(', ')}. Valid: ${Array.from(VALID_EVENT_TYPES).join(', ')}`,
      value: '',
    };
  }
  return { valid: true, value: arr.join(',') };
}

// ─── POST /api/v1/webhooks — register endpoint ────────────────────────────────

router.post('/', async (req: Request, res: Response) => {
  const { merchant, url, secret, events } = req.body ?? {};

  if (!merchant || !url) {
    return res.status(400).json({ error: 'merchant and url are required' });
  }

  const urlCheck = validateUrl(url);
  if (!urlCheck.valid) return res.status(400).json({ error: urlCheck.error });

  const eventsCheck = validateEvents(events);
  if (!eventsCheck.valid) return res.status(400).json({ error: eventsCheck.error });

  // Generate a signing secret if not provided
  const signingSecret: string = secret ?? randomBytes(32).toString('hex');

  try {
    const endpoint = await prisma.webhookEndpoint.upsert({
      where: { merchant_url: { merchant, url } },
      update: {
        active: true,
        ...(secret !== undefined && { secret: signingSecret }),
        events: eventsCheck.value,
      },
      create: {
        merchant,
        url,
        active: true,
        secret: signingSecret,
        events: eventsCheck.value,
      },
    });

    // Never expose the secret in responses
    const { secret: _s, ...safe } = endpoint as typeof endpoint & { secret?: string };
    return res.status(201).json(safe);
  } catch (err) {
    return res.status(500).json({ error: 'Failed to register webhook endpoint' });
  }
});

// ─── GET /api/v1/webhooks?merchant= — list endpoints ─────────────────────────

router.get('/', async (req: Request, res: Response) => {
  const merchant = req.query.merchant as string | undefined;
  if (!merchant) {
    return res.status(400).json({ error: 'merchant query parameter is required' });
  }

  try {
    const endpoints = await prisma.webhookEndpoint.findMany({
      where: { merchant },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        merchant: true,
        url: true,
        active: true,
        events: true,
        createdAt: true,
        // secret intentionally omitted
      },
    });
    return res.json(endpoints);
  } catch {
    return res.status(500).json({ error: 'Failed to list webhook endpoints' });
  }
});

// ─── PATCH /api/v1/webhooks/:id — update endpoint ────────────────────────────

router.patch('/:id', async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: 'id must be an integer' });

  const { url, secret, events, active } = req.body ?? {};

  const updates: Record<string, unknown> = {};

  if (url !== undefined) {
    const check = validateUrl(url);
    if (!check.valid) return res.status(400).json({ error: check.error });
    updates.url = url;
  }

  if (secret !== undefined) updates.secret = secret;

  if (events !== undefined) {
    const check = validateEvents(events);
    if (!check.valid) return res.status(400).json({ error: check.error });
    updates.events = check.value;
  }

  if (active !== undefined) updates.active = Boolean(active);

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No update fields provided' });
  }

  try {
    const updated = await prisma.webhookEndpoint.update({
      where: { id },
      data: updates,
    });
    const { secret: _s, ...safe } = updated as typeof updated & { secret?: string };
    return res.json(safe);
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2025') return res.status(404).json({ error: 'Endpoint not found' });
    return res.status(500).json({ error: 'Failed to update webhook endpoint' });
  }
});

// ─── DELETE /api/v1/webhooks/:id — delete endpoint ───────────────────────────

router.delete('/:id', async (req: Request, res: Response) => {
  // Only process numeric :id here; body-based delete is handled by /endpoints below
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) {
    // Fall-through to next handler (legacy /endpoints delete)
    return res.status(400).json({ error: 'id must be an integer' });
  }

  try {
    await prisma.webhookEndpoint.delete({ where: { id } });
    return res.json({ ok: true });
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === 'P2025') return res.status(404).json({ error: 'Endpoint not found' });
    return res.status(500).json({ error: 'Failed to delete webhook endpoint' });
  }
});

// ─── Legacy: POST /endpoints ──────────────────────────────────────────────────

router.post('/endpoints', async (req: Request, res: Response) => {
  const { merchant, url, secret } = req.body ?? {};
  if (!merchant || !url) {
    return res.status(400).json({ error: 'merchant and url are required' });
  }

  const urlCheck = validateUrl(url);
  if (!urlCheck.valid) return res.status(400).json({ error: urlCheck.error });

  const signingSecret: string = secret ?? randomBytes(32).toString('hex');

  try {
    const endpoint = await prisma.webhookEndpoint.upsert({
      where: { merchant_url: { merchant, url } },
      update: { active: true, ...(secret !== undefined && { secret: signingSecret }) },
      create: { merchant, url, active: true, secret: signingSecret },
    });
    const { secret: _s, ...safe } = endpoint as typeof endpoint & { secret?: string };
    return res.status(201).json(safe);
  } catch {
    return res.status(500).json({ error: 'Failed to register endpoint' });
  }
});

// ─── Legacy: DELETE /endpoints ────────────────────────────────────────────────

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
    return res.json({ ok: true });
  } catch {
    return res.status(500).json({ error: 'Failed to deactivate endpoint' });
  }
});

// ─── GET /deliveries/:merchant — recent delivery log ─────────────────────────

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
      },
    });
    return res.json(deliveries);
  } catch {
    return res.status(500).json({ error: 'Failed to fetch deliveries' });
  }
});

// ─── GET /:id/deliveries — paginated delivery log for an endpoint ─────────────

router.get('/:id/deliveries', async (req: Request, res: Response) => {
  const endpointId = parseInt(req.params.id, 10);
  if (isNaN(endpointId)) {
    return res.status(400).json({ error: 'id must be an integer' });
  }

  const limit = Math.min(parseInt((req.query.limit as string) ?? '50', 10), 200);
  const offset = Math.max(parseInt((req.query.offset as string) ?? '0', 10), 0);

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

    return res.json({ data: deliveries, meta: { total, limit, offset } });
  } catch {
    return res.status(500).json({ error: 'Failed to fetch delivery history' });
  }
});

export default router;
