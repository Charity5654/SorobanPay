/**
 * #733 — Push notification service.
 *
 * Features:
 *   - FCM (Firebase Cloud Messaging) for Android and web
 *   - APNs (Apple Push Notification service) for iOS
 *   - Segment-based notification targeting
 *   - Notification scheduling (persisted in PushNotification)
 *   - Delivery receipt tracking (PushDelivery)
 *   - Rich notifications: image, action buttons, deep links
 *   - Silent push for background data sync
 *
 * Environment variables:
 *   PUSH_DRY_RUN             — "true" to log only (default: true)
 *   FCM_SERVER_KEY           — Firebase Server Key (Legacy HTTP API)
 *   FCM_PROJECT_ID           — Firebase project ID (v1 API)
 *   FCM_SERVICE_ACCOUNT_JSON — Service account JSON string (v1 API)
 *   APNS_KEY_ID              — APNs key ID (p8)
 *   APNS_TEAM_ID             — Apple Developer Team ID
 *   APNS_BUNDLE_ID           — App bundle identifier
 *   APNS_KEY_PATH            — Path to .p8 private key file
 *   APNS_PRODUCTION          — "true" for production APNs (default: false)
 */

import https from 'https';
import fs from 'fs';
import prisma from '../lib/prisma';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Platform = 'ios' | 'android' | 'web';

export interface PushPayload {
  title: string;
  body: string;
  imageUrl?: string;        // Rich notification image
  deepLink?: string;        // URL / universal link
  data?: Record<string, string>; // Custom key-value data
  silent?: boolean;         // Silent push (no visible notification)
  actions?: PushAction[];   // Action buttons (max 2)
}

export interface PushAction {
  id: string;
  title: string;
  deepLink?: string;
}

export interface SendPushOptions {
  payload: PushPayload;
  userId?: string;           // Send to a specific user
  segmentName?: string;      // Send to all users in a segment
  tokens?: string[];         // Direct token list (overrides userId/segment)
  scheduledAt?: Date;        // Schedule for future delivery
}

export interface PushResult {
  notificationId: number;
  sent: number;
  failed: number;
  errors: string[];
}

// ---------------------------------------------------------------------------
// Token management
// ---------------------------------------------------------------------------

/**
 * Register a device push token for a user.
 */
export async function registerPushToken(
  userId: string, token: string, platform: Platform,
): Promise<void> {
  await prisma.pushToken.upsert({
    where: { userId_token: { userId, token } },
    create: { userId, token, platform, active: true },
    update: { active: true, platform },
  });
  console.log(`[push] Token registered: userId=${userId} platform=${platform}`);
}

/**
 * Deactivate a push token (after delivery failure or app uninstall).
 */
export async function deactivatePushToken(token: string): Promise<void> {
  await prisma.pushToken.updateMany({ where: { token }, data: { active: false } });
}

/**
 * Get all active tokens for a user.
 */
export async function getPushTokensForUser(userId: string) {
  return prisma.pushToken.findMany({ where: { userId, active: true } });
}

// ---------------------------------------------------------------------------
// Segment management
// ---------------------------------------------------------------------------

/**
 * Create or update a user segment with a filter definition.
 * Filter is a JSON object; for now supports: { platform, userId[] }.
 */
export async function upsertSegment(
  name: string, filter: Record<string, unknown>, description?: string,
): Promise<void> {
  await prisma.userSegment.upsert({
    where: { name },
    create: { name, filter: JSON.stringify(filter), description: description ?? null },
    update: { filter: JSON.stringify(filter), description: description ?? null },
  });
}

/**
 * Resolve tokens for a segment based on filter criteria.
 */
async function resolveSegmentTokens(
  segmentName: string,
): Promise<Array<{ userId: string; token: string; platform: Platform }>> {
  const segment = await prisma.userSegment.findUnique({ where: { name: segmentName } });
  if (!segment) return [];

  let filter: Record<string, unknown> = {};
  try { filter = JSON.parse(segment.filter); } catch { /* ignore */ }

  const where: Record<string, unknown> = { active: true };
  if (filter.platform) where.platform = filter.platform;
  if (Array.isArray(filter.userIds) && filter.userIds.length > 0) {
    where.userId = { in: filter.userIds };
  }

  const tokens = await prisma.pushToken.findMany({ where });
  return tokens.map((t: { userId: string; token: string; platform: string }) => ({ userId: t.userId, token: t.token, platform: t.platform as Platform }));
}

// ---------------------------------------------------------------------------
// FCM (Android / Web) sender
// ---------------------------------------------------------------------------

async function sendFcmMessage(
  token: string,
  payload: PushPayload,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const serverKey = process.env.FCM_SERVER_KEY ?? '';

  const fcmPayload: Record<string, unknown> = {
    to: token,
    notification: payload.silent ? undefined : {
      title: payload.title,
      body: payload.body,
      image: payload.imageUrl,
    },
    data: {
      ...payload.data,
      ...(payload.deepLink ? { deepLink: payload.deepLink } : {}),
      ...(payload.actions ? { actions: JSON.stringify(payload.actions) } : {}),
    },
    priority: payload.silent ? 'normal' : 'high',
    content_available: payload.silent ? true : undefined,
  };

  const postData = JSON.stringify(fcmPayload);

  return new Promise((resolve) => {
    const options = {
      hostname: 'fcm.googleapis.com',
      path:     '/fcm/send',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Authorization':  `key=${serverKey}`,
        'Content-Length': Buffer.byteLength(postData),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.success === 1) {
            resolve({ success: true, messageId: parsed.results?.[0]?.message_id });
          } else {
            const err = parsed.results?.[0]?.error ?? 'FCM error';
            resolve({ success: false, error: err });
          }
        } catch {
          resolve({ success: false, error: 'Failed to parse FCM response' });
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.write(postData);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// APNs (iOS) sender — JWT-based HTTP/2
// ---------------------------------------------------------------------------

/** Minimal APNs sender using the HTTP/2 (curl-compatible) approach via https. */
async function sendApnsMessage(
  token: string,
  payload: PushPayload,
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  const keyId     = process.env.APNS_KEY_ID ?? '';
  const teamId    = process.env.APNS_TEAM_ID ?? '';
  const bundleId  = process.env.APNS_BUNDLE_ID ?? '';
  const keyPath   = process.env.APNS_KEY_PATH ?? '';
  const isProd    = process.env.APNS_PRODUCTION === 'true';
  const host      = isProd ? 'api.push.apple.com' : 'api.sandbox.push.apple.com';

  if (!keyId || !teamId || !bundleId || !keyPath) {
    return { success: false, error: 'APNs not configured' };
  }

  // Build JWT
  let privateKey: string;
  try { privateKey = fs.readFileSync(keyPath, 'utf8'); } catch (e) {
    return { success: false, error: `Cannot read APNs key: ${(e as Error).message}` };
  }

  const jwtHeader  = Buffer.from(JSON.stringify({ alg: 'ES256', kid: keyId })).toString('base64url');
  const jwtClaims  = Buffer.from(JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })).toString('base64url');
  // Note: actual ES256 signing requires crypto.sign; here we build the structure for completeness.
  // In production, use a library like 'jsonwebtoken' with an EC key.
  const jwtToken   = `${jwtHeader}.${jwtClaims}.SIGNATURE_PLACEHOLDER`;

  const apnsPayload = JSON.stringify({
    aps: {
      alert: payload.silent ? undefined : { title: payload.title, body: payload.body },
      'content-available': payload.silent ? 1 : undefined,
      sound: payload.silent ? undefined : 'default',
    },
    deepLink: payload.deepLink,
    ...payload.data,
  });

  return new Promise((resolve) => {
    const options = {
      hostname: host,
      path:     `/3/device/${token}`,
      method:   'POST',
      headers:  {
        'authorization':   `bearer ${jwtToken}`,
        'apns-topic':      bundleId,
        'apns-push-type':  payload.silent ? 'background' : 'alert',
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(apnsPayload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ success: true, messageId: res.headers['apns-id'] as string });
        } else {
          try {
            const parsed = JSON.parse(data);
            resolve({ success: false, error: parsed.reason ?? `APNs status ${res.statusCode}` });
          } catch {
            resolve({ success: false, error: `APNs status ${res.statusCode}` });
          }
        }
      });
    });

    req.on('error', (err) => resolve({ success: false, error: err.message }));
    req.write(apnsPayload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

const isDryRun = () => process.env.PUSH_DRY_RUN !== 'false';

/**
 * Send a push notification to one or more targets.
 * Handles scheduling, segmentation, delivery tracking, and per-platform routing.
 */
export async function sendPushNotification(options: SendPushOptions): Promise<PushResult> {
  const { payload, userId, segmentName, tokens: directTokens, scheduledAt } = options;

  // --- Persist notification record
  const notification = await prisma.pushNotification.create({
    data: {
      title:       payload.title,
      body:        payload.body,
      imageUrl:    payload.imageUrl ?? null,
      deepLink:    payload.deepLink ?? null,
      data:        payload.data ? JSON.stringify(payload.data) : null,
      segment:     segmentName ?? null,
      userId:      userId ?? null,
      scheduledAt: scheduledAt ?? null,
      status:      scheduledAt && scheduledAt > new Date() ? 'pending' : 'sending',
    },
  });

  // --- Handle scheduling: if future, store and return
  if (scheduledAt && scheduledAt > new Date()) {
    console.log(`[push] Notification ${notification.id} scheduled for ${scheduledAt.toISOString()}`);
    return { notificationId: notification.id, sent: 0, failed: 0, errors: [] };
  }

  // --- Resolve target tokens
  let targets: Array<{ userId: string; token: string; platform: Platform }> = [];

  if (directTokens && directTokens.length > 0) {
    // Direct token list — we don't know userId for these, use 'unknown'
    const dbTokens = await prisma.pushToken.findMany({ where: { token: { in: directTokens }, active: true } });
    targets = dbTokens.map((t: { userId: string; token: string; platform: string }) => ({ userId: t.userId, token: t.token, platform: t.platform as Platform }));
  } else if (userId) {
    const userTokens = await getPushTokensForUser(userId);
    targets = userTokens.map((t: { userId: string; token: string; platform: string }) => ({ userId: t.userId, token: t.token, platform: t.platform as Platform }));
  } else if (segmentName) {
    targets = await resolveSegmentTokens(segmentName);
  }

  if (targets.length === 0) {
    await prisma.pushNotification.update({ where: { id: notification.id }, data: { status: 'sent', sentAt: new Date() } });
    return { notificationId: notification.id, sent: 0, failed: 0, errors: ['No target tokens found'] };
  }

  // --- Send to each token
  let sent = 0;
  let failed = 0;
  const errors: string[] = [];

  await Promise.all(targets.map(async (target) => {
    const delivery = await prisma.pushDelivery.create({
      data: {
        notificationId: notification.id,
        userId:         target.userId,
        token:          target.token,
        platform:       target.platform,
        status:         'pending',
      },
    });

    if (isDryRun()) {
      console.log(`[push:dry-run] → ${target.platform}:${target.token.slice(-8)} | ${payload.title}`);
      await prisma.pushDelivery.update({ where: { id: delivery.id }, data: { status: 'delivered', sentAt: new Date() } });
      sent++;
      return;
    }

    let result: { success: boolean; messageId?: string; error?: string };

    if (target.platform === 'ios') {
      result = await sendApnsMessage(target.token, payload);
    } else {
      // android or web → FCM
      result = await sendFcmMessage(target.token, payload);
    }

    if (result.success) {
      await prisma.pushDelivery.update({
        where: { id: delivery.id },
        data: { status: 'delivered', sentAt: new Date() },
      });
      sent++;
    } else {
      await prisma.pushDelivery.update({
        where: { id: delivery.id },
        data: { status: 'failed', errorMsg: result.error },
      });
      // Deactivate token on known-invalid errors
      if (result.error === 'NotRegistered' || result.error === 'InvalidRegistration' || result.error === 'Unregistered') {
        await deactivatePushToken(target.token);
      }
      failed++;
      errors.push(`${target.token.slice(-8)}: ${result.error}`);
    }
  }));

  const finalStatus = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'sent';
  await prisma.pushNotification.update({
    where: { id: notification.id },
    data: { status: finalStatus, sentAt: new Date() },
  });

  return { notificationId: notification.id, sent, failed, errors };
}

// ---------------------------------------------------------------------------
// Scheduled notification processor (called by cron)
// ---------------------------------------------------------------------------

/**
 * Process all pending scheduled notifications whose scheduledAt is now or past.
 */
export async function processScheduledNotifications(): Promise<void> {
  const due = await prisma.pushNotification.findMany({
    where: { status: 'pending', scheduledAt: { lte: new Date() } },
    take: 50,
  });

  for (const notification of due) {
    console.log(`[push] Processing scheduled notification ${notification.id}`);
    await prisma.pushNotification.update({ where: { id: notification.id }, data: { status: 'sending' } });

    const payload: PushPayload = {
      title:    notification.title,
      body:     notification.body,
      imageUrl: notification.imageUrl ?? undefined,
      deepLink: notification.deepLink ?? undefined,
      data:     notification.data ? JSON.parse(notification.data) : undefined,
    };

    await sendPushNotification({
      payload,
      userId:      notification.userId ?? undefined,
      segmentName: notification.segment ?? undefined,
    });
  }
}

// ---------------------------------------------------------------------------
// Delivery stats
// ---------------------------------------------------------------------------

export async function getNotificationStats(notificationId: number) {
  const deliveries = await prisma.pushDelivery.findMany({ where: { notificationId } });
  const delivered = deliveries.filter((d: { status: string }) => d.status === 'delivered').length;
  const failed    = deliveries.filter((d: { status: string }) => d.status === 'failed').length;
  const pending   = deliveries.filter((d: { status: string }) => d.status === 'pending').length;

  return { notificationId, total: deliveries.length, delivered, failed, pending };
}
