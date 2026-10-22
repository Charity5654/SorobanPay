/**
 * Tests for #733 — Push notification service.
 */

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------

const pushTokens: Record<string, unknown> = {};
const pushNotifications: Record<number, unknown> = {};
const pushDeliveries: Record<number, unknown> = {};
const segments: Record<string, unknown> = {};
let nextNotifId = 1;
let nextDeliveryId = 1;

jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    pushToken: {
      upsert: jest.fn(async ({ where, create, update }: { where: { userId_token: { userId: string; token: string } }; create: Record<string, unknown>; update: Record<string, unknown> }) => {
        const key = `${where.userId_token.userId}:${where.userId_token.token}`;
        const existing = pushTokens[key] as Record<string, unknown> | undefined;
        if (existing) {
          Object.assign(existing, update);
          return existing;
        }
        pushTokens[key] = { id: Object.keys(pushTokens).length + 1, ...create };
        return pushTokens[key];
      }),
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        return Object.values(pushTokens).filter((t: unknown) => {
          const token = t as Record<string, unknown>;
          if (where.userId && token.userId !== where.userId) return false;
          if (where.active !== undefined && token.active !== where.active) return false;
          return true;
        });
      }),
      updateMany: jest.fn(async ({ where, data }: { where: { token: string }; data: Record<string, unknown> }) => {
        Object.values(pushTokens).forEach((t: unknown) => {
          const token = t as Record<string, unknown>;
          if (token.token === where.token) Object.assign(token, data);
        });
      }),
    },
    userSegment: {
      upsert: jest.fn(async ({ where, create }: { where: { name: string }; create: Record<string, unknown> }) => {
        segments[where.name] = create;
        return create;
      }),
      findUnique: jest.fn(async ({ where }: { where: { name: string } }) => segments[where.name] ?? null),
      findMany: jest.fn(async () => Object.values(segments)),
    },
    pushNotification: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextNotifId++;
        pushNotifications[id] = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
        return pushNotifications[id];
      }),
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        pushNotifications[where.id] = { ...pushNotifications[where.id] as object, ...data, updatedAt: new Date() };
        return pushNotifications[where.id];
      }),
      findUnique: jest.fn(async ({ where }: { where: { id: number } }) => pushNotifications[where.id] ?? null),
      findMany: jest.fn(async () => Object.values(pushNotifications)),
    },
    pushDelivery: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const id = nextDeliveryId++;
        pushDeliveries[id] = { id, ...data, createdAt: new Date() };
        return pushDeliveries[id];
      }),
      update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
        pushDeliveries[where.id] = { ...pushDeliveries[where.id] as object, ...data };
        return pushDeliveries[where.id];
      }),
      findMany: jest.fn(async ({ where }: { where: { notificationId: number } }) => {
        return Object.values(pushDeliveries).filter((d: unknown) => (d as Record<string, unknown>).notificationId === where.notificationId);
      }),
    },
  },
}));

import {
  registerPushToken,
  deactivatePushToken,
  getPushTokensForUser,
  sendPushNotification,
  getNotificationStats,
  upsertSegment,
} from '../src/services/pushNotificationService';

describe('Push Notification Service — #733', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.PUSH_DRY_RUN = 'true';
  });

  // -------------------------------------------------------------------------
  // Token management
  // -------------------------------------------------------------------------
  describe('Token management', () => {
    it('registers a push token', async () => {
      const prisma = require('../src/lib/prisma').default;
      await registerPushToken('user-1', 'token-abc', 'android');

      expect(prisma.pushToken.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ userId: 'user-1', token: 'token-abc', platform: 'android' }),
        })
      );
    });

    it('deactivates a push token', async () => {
      const prisma = require('../src/lib/prisma').default;
      await deactivatePushToken('token-abc');

      expect(prisma.pushToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { token: 'token-abc' }, data: { active: false } })
      );
    });

    it('getPushTokensForUser filters by userId and active', async () => {
      const prisma = require('../src/lib/prisma').default;
      await getPushTokensForUser('user-1');

      expect(prisma.pushToken.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1', active: true } })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Segment management
  // -------------------------------------------------------------------------
  describe('Segment management', () => {
    it('upserts a segment', async () => {
      const prisma = require('../src/lib/prisma').default;
      await upsertSegment('premium-users', { platform: 'ios' }, 'iOS premium subscribers');

      expect(prisma.userSegment.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { name: 'premium-users' },
          create: expect.objectContaining({
            name: 'premium-users',
            filter: JSON.stringify({ platform: 'ios' }),
          }),
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // sendPushNotification — dry run
  // -------------------------------------------------------------------------
  describe('sendPushNotification (dry-run)', () => {
    it('sends to a single user and returns stats', async () => {
      const prisma = require('../src/lib/prisma').default;
      // Mock getPushTokensForUser to return tokens
      prisma.pushToken.findMany.mockResolvedValueOnce([
        { userId: 'user-1', token: 'fcm-token-123', platform: 'android', active: true },
      ]);

      const result = await sendPushNotification({
        payload: {
          title: 'Payment received',
          body: 'Your payment of 100 USDC was received',
          deepLink: '/dashboard/payments',
        },
        userId: 'user-1',
      });

      expect(result.notificationId).toBeDefined();
      expect(result.sent).toBe(1);
      expect(result.failed).toBe(0);
    });

    it('handles scheduled notifications by setting pending status', async () => {
      const futureDate = new Date(Date.now() + 3600_000); // 1 hour from now
      const result = await sendPushNotification({
        payload: { title: 'Scheduled', body: 'Future notification' },
        userId: 'user-sched',
        scheduledAt: futureDate,
      });

      // Should be stored but not sent yet
      expect(result.sent).toBe(0);
      expect(result.notificationId).toBeDefined();

      const prisma = require('../src/lib/prisma').default;
      const createCall = prisma.pushNotification.create.mock.calls[0][0];
      expect(createCall.data.status).toBe('pending');
    });

    it('returns zero sent when no tokens found', async () => {
      const prisma = require('../src/lib/prisma').default;
      prisma.pushToken.findMany.mockResolvedValueOnce([]);

      const result = await sendPushNotification({
        payload: { title: 'Test', body: 'No tokens' },
        userId: 'user-no-tokens',
      });

      expect(result.sent).toBe(0);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('creates a PushNotification record with correct fields', async () => {
      const prisma = require('../src/lib/prisma').default;
      prisma.pushToken.findMany.mockResolvedValueOnce([
        { userId: 'u1', token: 't1', platform: 'ios', active: true },
      ]);

      await sendPushNotification({
        payload: {
          title: 'Rich notification',
          body: 'With image and deeplink',
          imageUrl: 'https://example.com/img.jpg',
          deepLink: '/subscriptions',
          data: { subscriptionId: '42' },
        },
        userId: 'u1',
      });

      const createCall = prisma.pushNotification.create.mock.calls[0][0];
      expect(createCall.data.title).toBe('Rich notification');
      expect(createCall.data.imageUrl).toBe('https://example.com/img.jpg');
      expect(createCall.data.deepLink).toBe('/subscriptions');
    });
  });

  // -------------------------------------------------------------------------
  // Delivery stats
  // -------------------------------------------------------------------------
  describe('getNotificationStats', () => {
    it('returns stats with correct counts', async () => {
      const prisma = require('../src/lib/prisma').default;
      prisma.pushDelivery.findMany.mockResolvedValueOnce([
        { status: 'delivered' },
        { status: 'delivered' },
        { status: 'failed' },
        { status: 'pending' },
      ]);

      const stats = await getNotificationStats(1);

      expect(stats.total).toBe(4);
      expect(stats.delivered).toBe(2);
      expect(stats.failed).toBe(1);
      expect(stats.pending).toBe(1);
    });
  });
});
