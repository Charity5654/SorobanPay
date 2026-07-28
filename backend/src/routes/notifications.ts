/**
 * BE-68 — Email notification preferences API.
 *
 * Routes:
 *   GET  /api/v1/notifications/unsubscribe?token=:token  — honour opt-out
 *   POST /api/v1/notifications/preferences              — create/update prefs
 *   GET  /api/v1/notifications/preferences/:email       — fetch prefs
 */

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';

const router = Router();

/**
 * GET /unsubscribe?token=:token
 * Marks the notification preference as opted-out.
 * CAN-SPAM / GDPR: must be honoured within 24 hours.
 */
router.get('/unsubscribe', async (req: Request, res: Response) => {
  const { token } = req.query;
  if (!token || typeof token !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid unsubscribe token' });
  }

  try {
    const pref = await prisma.notificationPreference.findUnique({
      where: { unsubToken: token },
    });

    if (!pref) {
      return res.status(404).json({ error: 'Unsubscribe token not found' });
    }

    if (!pref.emailEnabled) {
      // Already opted out — idempotent
      return res.json({ message: 'You are already unsubscribed from SorobanPay emails.' });
    }

    await prisma.notificationPreference.update({
      where: { unsubToken: token },
      data: { emailEnabled: false },
    });

    return res.json({
      message: 'You have been successfully unsubscribed from SorobanPay emails.',
    });
  } catch (err) {
    console.error('[notifications] Unsubscribe error:', err);
    return res.status(500).json({ error: 'Failed to process unsubscribe request' });
  }
});

/**
 * POST /preferences
 * Create or update notification preferences for an email address.
 * Body: { email: string; subscriber?: string; merchant?: string; emailEnabled?: boolean }
 */
router.post('/preferences', async (req: Request, res: Response) => {
  const { email, subscriber, merchant, emailEnabled } = req.body ?? {};

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'email is required' });
  }

  // Basic email format validation
  const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRe.test(email)) {
    return res.status(400).json({ error: 'email must be a valid email address' });
  }

  try {
    const pref = await prisma.notificationPreference.upsert({
      where: { email },
      create: {
        email,
        subscriber: subscriber ?? null,
        merchant: merchant ?? null,
        emailEnabled: emailEnabled ?? true,
      },
      update: {
        ...(subscriber !== undefined ? { subscriber } : {}),
        ...(merchant !== undefined ? { merchant } : {}),
        ...(emailEnabled !== undefined ? { emailEnabled } : {}),
      },
    });

    return res.status(201).json({
      id: pref.id,
      email: pref.email,
      subscriber: pref.subscriber,
      merchant: pref.merchant,
      emailEnabled: pref.emailEnabled,
      unsubscribeUrl: `${process.env.API_BASE_URL ?? 'http://localhost:3001'}/api/v1/notifications/unsubscribe?token=${pref.unsubToken}`,
    });
  } catch (err) {
    console.error('[notifications] Preferences upsert error:', err);
    return res.status(500).json({ error: 'Failed to save preferences' });
  }
});

/**
 * GET /preferences/:email
 * Retrieve notification preferences for an email address.
 */
router.get('/preferences/:email', async (req: Request, res: Response) => {
  const { email } = req.params;

  try {
    const pref = await prisma.notificationPreference.findUnique({
      where: { email },
    });

    if (!pref) {
      return res.status(404).json({ error: 'No preferences found for this email' });
    }

    return res.json({
      id: pref.id,
      email: pref.email,
      subscriber: pref.subscriber,
      merchant: pref.merchant,
      emailEnabled: pref.emailEnabled,
    });
  } catch (err) {
    console.error('[notifications] Preferences fetch error:', err);
    return res.status(500).json({ error: 'Failed to fetch preferences' });
  }
});

export default router;
