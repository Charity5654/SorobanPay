/**
 * Tests for #732 — SMS notification service.
 */

import { parseCsv } from '../src/services/dataImportService'; // import isolation check
import {
  smsTemplates,
} from '../src/services/smsService';

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------
jest.mock('../src/lib/prisma', () => {
  const smsLogs: Record<number, unknown> = {};
  const optOuts: Record<string, unknown> = {};
  let nextId = 1;

  return {
    __esModule: true,
    default: {
      smsLog: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const id = nextId++;
          smsLogs[id] = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
          return smsLogs[id];
        }),
        update: jest.fn(async ({ where, data }: { where: { id: number }; data: Record<string, unknown> }) => {
          smsLogs[where.id] = { ...smsLogs[where.id] as object, ...data, updatedAt: new Date() };
          return smsLogs[where.id];
        }),
        updateMany: jest.fn(async ({ where, data }: { where: { messageId: string }; data: Record<string, unknown> }) => {
          Object.values(smsLogs).forEach((log: unknown) => {
            const l = log as Record<string, unknown>;
            if (l.messageId === where.messageId) Object.assign(l, data);
          });
        }),
        findUnique: jest.fn(async ({ where }: { where: { id: number } }) => smsLogs[where.id] ?? null),
        findMany: jest.fn(async () => Object.values(smsLogs)),
      },
      smsOptOut: {
        findUnique: jest.fn(async ({ where }: { where: { phoneNumber: string } }) => optOuts[where.phoneNumber] ?? null),
        upsert: jest.fn(async ({ where, create }: { where: { phoneNumber: string }; create: Record<string, unknown> }) => {
          optOuts[where.phoneNumber] = create;
          return create;
        }),
        deleteMany: jest.fn(async ({ where }: { where: { phoneNumber: string } }) => {
          delete optOuts[where.phoneNumber];
        }),
      },
    },
  };
});

// ---------------------------------------------------------------------------
// Re-import after mock
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-require-imports
const {
  sendSms,
  isOptedOut,
  recordOptOut,
  removeOptOut,
} = require('../src/services/smsService');

describe('SMS Service — #732', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SMS_DRY_RUN = 'true';
  });

  // -------------------------------------------------------------------------
  // Templates
  // -------------------------------------------------------------------------
  describe('SMS Templates', () => {
    it('includes all required templates', () => {
      expect(smsTemplates).toHaveProperty('payment_success');
      expect(smsTemplates).toHaveProperty('payment_failure');
      expect(smsTemplates).toHaveProperty('subscription_created');
      expect(smsTemplates).toHaveProperty('subscription_cancelled');
      expect(smsTemplates).toHaveProperty('payment_due_reminder');
    });

    it('templates have id and body', () => {
      for (const tpl of Object.values(smsTemplates)) {
        expect(typeof (tpl as { id: string }).id).toBe('string');
        expect(typeof (tpl as { body: string }).body).toBe('string');
        expect((tpl as { body: string }).body.length).toBeGreaterThan(0);
      }
    });

    it('template body contains placeholders', () => {
      const tpl = smsTemplates['payment_success'];
      expect(tpl.body).toMatch(/\{\{amount\}\}/);
      expect(tpl.body).toMatch(/\{\{merchant\}\}/);
    });
  });

  // -------------------------------------------------------------------------
  // Opt-out
  // -------------------------------------------------------------------------
  describe('Opt-out (STOP compliance)', () => {
    it('isOptedOut returns false for unknown number', async () => {
      const result = await isOptedOut('+14155550000');
      expect(result).toBe(false);
    });

    it('recordOptOut then isOptedOut returns true', async () => {
      await recordOptOut('+14155551111');
      const result = await isOptedOut('+14155551111');
      expect(result).toBe(true);
    });

    it('removeOptOut removes the opt-out', async () => {
      await recordOptOut('+14155552222');
      await removeOptOut('+14155552222');
      const prisma = require('../src/lib/prisma').default;
      expect(prisma.smsOptOut.deleteMany).toHaveBeenCalledWith({ where: { phoneNumber: '+14155552222' } });
    });
  });

  // -------------------------------------------------------------------------
  // sendSms — dry-run mode
  // -------------------------------------------------------------------------
  describe('sendSms (dry-run)', () => {
    it('succeeds with a valid templateId in dry-run mode', async () => {
      const result = await sendSms({
        to: '+14155553333',
        userId: 'user-1',
        templateId: 'payment_success',
        variables: { amount: '100', token: 'USDC', merchant: 'G123', txHash: 'abc' },
      });

      expect(result.success).toBe(true);
      expect(result.messageId).toBe('dry-run');
      expect(typeof result.logId).toBe('number');
    });

    it('succeeds with raw body', async () => {
      const result = await sendSms({
        to: '+14155554444',
        userId: 'user-2',
        body: 'Test SMS message',
      });

      expect(result.success).toBe(true);
    });

    it('returns error for unknown template', async () => {
      const result = await sendSms({
        to: '+14155555555',
        userId: 'user-3',
        templateId: 'nonexistent_template',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/Unknown template/);
    });

    it('returns error when neither templateId nor body is provided', async () => {
      const result = await sendSms({
        to: '+14155556666',
        userId: 'user-4',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/templateId or body/);
    });

    it('blocks opted-out recipients', async () => {
      const prisma = require('../src/lib/prisma').default;
      // Make findUnique return an opt-out record for this number
      prisma.smsOptOut.findUnique.mockResolvedValueOnce({ phoneNumber: '+14155557777' });

      const result = await sendSms({
        to: '+14155557777',
        userId: 'user-5',
        body: 'Test',
      });

      expect(result.success).toBe(false);
      expect(result.error).toMatch(/opted out/i);
    });
  });

  // -------------------------------------------------------------------------
  // Rate limiting
  // -------------------------------------------------------------------------
  describe('Rate limiting', () => {
    it('blocks after 5 SMS in the same hour for the same user', async () => {
      const userId = `rate-limit-test-${Date.now()}`;
      const opts = { to: '+14155558888', userId, body: 'Test' };

      // First 5 should succeed (dry-run)
      for (let i = 0; i < 5; i++) {
        const r = await sendSms(opts);
        expect(r.success).toBe(true);
      }

      // 6th should be blocked
      const blocked = await sendSms(opts);
      expect(blocked.success).toBe(false);
      expect(blocked.error).toMatch(/Rate limit/);
    });

    it('allows different users independently', async () => {
      const userId1 = `rl-user-a-${Date.now()}`;
      const userId2 = `rl-user-b-${Date.now()}`;

      // Max out user1
      for (let i = 0; i < 5; i++) {
        await sendSms({ to: '+14155559999', userId: userId1, body: 'x' });
      }
      const blockedA = await sendSms({ to: '+14155559999', userId: userId1, body: 'x' });
      expect(blockedA.success).toBe(false);

      // user2 should still be allowed
      const allowedB = await sendSms({ to: '+14155559999', userId: userId2, body: 'x' });
      expect(allowedB.success).toBe(true);
    });
  });
});
