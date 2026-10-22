/**
 * Tests for #735 — Analytics and event tracking service.
 */

// ---------------------------------------------------------------------------
// Mock prisma
// ---------------------------------------------------------------------------

const analyticsEvents: Record<number, unknown> = {};
const consentRecords: Record<number, unknown> = {};
let nextEventId = 1;
let nextConsentId = 1;

jest.mock('../src/lib/prisma', () => {
  return {
    __esModule: true,
    default: {
      analyticsEvent: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const id = nextEventId++;
          analyticsEvents[id] = { id, ...data, createdAt: new Date() };
          return analyticsEvents[id];
        }),
        count: jest.fn(async () => Object.keys(analyticsEvents).length),
        groupBy: jest.fn(async () => []),
        findMany: jest.fn(async () => Object.values(analyticsEvents)),
        $queryRaw: jest.fn(async () => []),
      },
      consentRecord: {
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          const id = nextConsentId++;
          consentRecords[id] = { id, ...data, createdAt: new Date(), updatedAt: new Date() };
          return consentRecords[id];
        }),
        findFirst: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
          const all = Object.values(consentRecords) as Array<Record<string, unknown>>;
          return all.find(r =>
            (where.userId ? r.userId === where.userId : true) ||
            (where.anonymousId ? r.anonymousId === where.anonymousId : true)
          ) ?? null;
        }),
      },
      $queryRaw: jest.fn(async () => []),
    },
  };
});

// ---------------------------------------------------------------------------
// Import after mock
// ---------------------------------------------------------------------------

import {
  trackEvent,
  trackPageView,
  recordConsent,
  getConsent,
  hasAnalyticsConsent,
} from '../src/services/analyticsService';

describe('Analytics Service — #735', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // -------------------------------------------------------------------------
  // trackEvent
  // -------------------------------------------------------------------------
  describe('trackEvent', () => {
    it('creates an analytics event record and returns an id', async () => {
      const id = await trackEvent({
        eventName: 'wallet_connected',
        userId: 'user-abc',
        properties: { walletType: 'freighter' },
        consentGiven: true,
      });

      expect(typeof id).toBe('number');
      expect(id).toBeGreaterThan(0);

      const prisma = require('../src/lib/prisma').default;
      expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventName: 'wallet_connected',
            userId: 'user-abc',
            consentGiven: true,
          }),
        })
      );
    });

    it('strips PII from properties when consent is not given', async () => {
      const prisma = require('../src/lib/prisma').default;
      // Ensure no consent record exists
      prisma.consentRecord.findFirst.mockResolvedValueOnce(null);

      await trackEvent({
        eventName: 'form_submitted',
        userId: 'user-xyz',
        properties: {
          email: 'alice@example.com', // PII — should be stripped
          amount: '100',              // non-PII — should be kept
          token: 'USDC',
        },
        consentGiven: false,
      });

      const callArg = (prisma.analyticsEvent.create as jest.Mock).mock.calls[0][0];
      const props = JSON.parse(callArg.data.properties);

      expect(props.email).toBeUndefined();   // PII stripped
      expect(props.amount).toBe('100');       // retained
      expect(props.token).toBe('USDC');       // retained
    });

    it('keeps all properties when consent is given', async () => {
      const prisma = require('../src/lib/prisma').default;

      await trackEvent({
        eventName: 'user_registered',
        userId: 'user-consent',
        properties: { email: 'bob@example.com', name: 'Bob', amount: '50' },
        consentGiven: true,
      });

      const callArg = (prisma.analyticsEvent.create as jest.Mock).mock.calls[0][0];
      const props = JSON.parse(callArg.data.properties);

      expect(props.email).toBe('bob@example.com');
      expect(props.name).toBe('Bob');
    });

    it('stores IP hash, not raw IP', async () => {
      const prisma = require('../src/lib/prisma').default;
      prisma.consentRecord.findFirst.mockResolvedValueOnce(null);

      await trackEvent({
        eventName: 'test_event',
        anonymousId: 'anon-1',
        ip: '192.168.1.1',
        consentGiven: false,
      });

      const callArg = (prisma.analyticsEvent.create as jest.Mock).mock.calls[0][0];
      expect(callArg.data.ipHash).toBeDefined();
      expect(callArg.data.ipHash).not.toBe('192.168.1.1'); // must be hashed
      expect(callArg.data.ipHash.length).toBeGreaterThan(8);
    });
  });

  // -------------------------------------------------------------------------
  // trackPageView
  // -------------------------------------------------------------------------
  describe('trackPageView', () => {
    it('creates a page_view event', async () => {
      const prisma = require('../src/lib/prisma').default;

      await trackPageView({
        page: '/dashboard',
        userId: 'user-1',
        referrer: 'https://google.com',
      });

      expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            eventName: 'page_view',
            page: '/dashboard',
            referrer: 'https://google.com',
          }),
        })
      );
    });
  });

  // -------------------------------------------------------------------------
  // Consent (GDPR)
  // -------------------------------------------------------------------------
  describe('recordConsent / getConsent', () => {
    it('records consent and returns an id', async () => {
      const id = await recordConsent({
        userId: 'user-consent-1',
        analytics: true,
        marketing: false,
      });

      expect(typeof id).toBe('number');
    });

    it('getConsent returns null when no record exists', async () => {
      const prisma = require('../src/lib/prisma').default;
      prisma.consentRecord.findFirst.mockResolvedValueOnce(null);

      const record = await getConsent('unknown-user');
      expect(record).toBeNull();
    });

    it('getConsent returns the stored record', async () => {
      const prisma = require('../src/lib/prisma').default;
      prisma.consentRecord.findFirst.mockResolvedValueOnce({
        id: 1,
        userId: 'user-abc',
        analytics: true,
        marketing: false,
        functional: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const record = await getConsent('user-abc');
      expect(record?.analytics).toBe(true);
      expect(record?.marketing).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // hasAnalyticsConsent
  // -------------------------------------------------------------------------
  describe('hasAnalyticsConsent', () => {
    it('returns false when no consent record', async () => {
      const prisma = require('../src/lib/prisma').default;
      prisma.consentRecord.findFirst.mockResolvedValueOnce(null);

      const result = await hasAnalyticsConsent('no-consent-user');
      expect(result).toBe(false);
    });

    it('returns true when analytics consent is granted', async () => {
      const prisma = require('../src/lib/prisma').default;
      prisma.consentRecord.findFirst.mockResolvedValueOnce({ analytics: true });

      const result = await hasAnalyticsConsent('consented-user');
      expect(result).toBe(true);
    });

    it('returns false when analytics consent is denied', async () => {
      const prisma = require('../src/lib/prisma').default;
      prisma.consentRecord.findFirst.mockResolvedValueOnce({ analytics: false });

      const result = await hasAnalyticsConsent('denied-user');
      expect(result).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Business event helpers
  // -------------------------------------------------------------------------
  describe('Business event helpers', () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      trackSubscriptionCreated,
      trackPaymentExecuted,
      trackPaymentFailed,
      trackSubscriptionCancelled,
      trackWalletConnected,
    } = require('../src/services/analyticsService');

    it('trackSubscriptionCreated emits correct event', async () => {
      const prisma = require('../src/lib/prisma').default;
      await trackSubscriptionCreated('u1', 'G_MERCHANT', '100', 'USDC');

      expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventName: 'subscription_created' }),
        })
      );
    });

    it('trackPaymentExecuted emits correct event', async () => {
      const prisma = require('../src/lib/prisma').default;
      await trackPaymentExecuted('u1', 'G_MERCHANT', '100', 'txhash123');

      expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventName: 'payment_executed' }),
        })
      );
    });

    it('trackWalletConnected works without userId', async () => {
      const prisma = require('../src/lib/prisma').default;
      await trackWalletConnected(undefined, 'anon-123', 'freighter');

      expect(prisma.analyticsEvent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ eventName: 'wallet_connected', anonymousId: 'anon-123' }),
        })
      );
    });
  });
});
