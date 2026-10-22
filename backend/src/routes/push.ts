/**
 * #733 — Push notification API routes.
 *
 * Routes:
 *   POST  /api/v1/push/tokens              — Register a device push token
 *   DELETE /api/v1/push/tokens/:token      — Deactivate a token
 *   GET   /api/v1/push/tokens/:userId      — Get all tokens for a user
 *   POST  /api/v1/push/send                — Send push notification
 *   GET   /api/v1/push/notifications/:id   — Get notification + delivery stats
 *   POST  /api/v1/push/segments            — Create/update a user segment
 *   GET   /api/v1/push/segments            — List all segments
 */

import { Router, Request, Response } from 'express';
import {
  registerPushToken,
  deactivatePushToken,
  getPushTokensForUser,
  sendPushNotification,
  getNotificationStats,
  upsertSegment,
  Platform,
} from '../services/pushNotificationService';
import prisma from '../lib/prisma';

const router = Router();

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/**
 * POST /tokens
 * Body: { userId, token, platform: "ios"|"android"|"web" }
 */
router.post('/tokens', async (req: Request, res: Response) => {
  const { userId, token, platform } = req.body ?? {};

  if (!userId || !token || !platform) {
    return res.status(400).json({ error: 'userId, token, and platform are required' });
  }

  const validPlatforms: Platform[] = ['ios', 'android', 'web'];
  if (!validPlatforms.includes(platform)) {
    return res.status(400).json({ error: `platform must be one of: ${validPlatforms.join(', ')}` });
  }

  try {
    await registerPushToken(userId, token, platform as Platform);
    return res.status(201).json({ success: true, message: 'Push token registered' });
  } catch (err) {
    console.error('[push route] token register error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /tokens/:token
 * Deactivate a device token.
 */
router.delete('/tokens/:token', async (req: Request, res: Response) => {
  const { token } = req.params;
  const tokenStr = String(token);

  try {
    await deactivatePushToken(tokenStr);
    return res.json({ success: true, message: 'Token deactivated' });
  } catch (err) {
    console.error('[push route] token deactivate error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /tokens/:userId
 */
router.get('/tokens/:userId', async (req: Request, res: Response) => {
  const userId = String(req.params.userId);

  try {
    const tokens = await getPushTokensForUser(userId);
    return res.json({ userId, count: tokens.length, tokens });
  } catch (err) {
    console.error('[push route] token list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Send notification
// ---------------------------------------------------------------------------

/**
 * POST /send
 * Body: {
 *   title, body, imageUrl?, deepLink?, data?, silent?,
 *   actions?: [{ id, title, deepLink? }],
 *   userId?, segmentName?, scheduledAt?
 * }
 */
router.post('/send', async (req: Request, res: Response) => {
  const {
    title, body, imageUrl, deepLink, data, silent, actions,
    userId, segmentName, scheduledAt,
  } = req.body ?? {};

  if (!title || !body) {
    return res.status(400).json({ error: 'title and body are required' });
  }

  if (!userId && !segmentName) {
    return res.status(400).json({ error: 'Either userId or segmentName must be provided' });
  }

  try {
    const result = await sendPushNotification({
      payload: { title, body, imageUrl, deepLink, data, silent: Boolean(silent), actions },
      userId,
      segmentName,
      scheduledAt: scheduledAt ? new Date(scheduledAt) : undefined,
    });

    return res.status(202).json(result);
  } catch (err) {
    console.error('[push route] send error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Notification stats
// ---------------------------------------------------------------------------

/**
 * GET /notifications/:id
 */
router.get('/notifications/:id', async (req: Request, res: Response) => {
  const notificationId = parseInt(String(req.params.id), 10);
  if (isNaN(notificationId)) return res.status(400).json({ error: 'Invalid notification id' });

  try {
    const notification = await prisma.pushNotification.findUnique({ where: { id: notificationId } });
    if (!notification) return res.status(404).json({ error: 'Notification not found' });

    const stats = await getNotificationStats(notificationId);

    return res.json({ ...notification, deliveryStats: stats });
  } catch (err) {
    console.error('[push route] notification stats error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Segment management
// ---------------------------------------------------------------------------

/**
 * POST /segments
 * Body: { name, filter: { platform?, userIds? }, description? }
 */
router.post('/segments', async (req: Request, res: Response) => {
  const { name, filter, description } = req.body ?? {};

  if (!name || !filter || typeof filter !== 'object') {
    return res.status(400).json({ error: 'name and filter (object) are required' });
  }

  try {
    await upsertSegment(name, filter, description);
    return res.status(201).json({ success: true, message: `Segment '${name}' saved` });
  } catch (err) {
    console.error('[push route] segment upsert error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /segments
 */
router.get('/segments', async (_req: Request, res: Response) => {
  try {
    const segments = await prisma.userSegment.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return res.json({ count: segments.length, segments });
  } catch (err) {
    console.error('[push route] segment list error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
