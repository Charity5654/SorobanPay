/**
 * BE-68 — Email service tests.
 *
 * Tests run with EMAIL_DRY_RUN=true (no real SMTP calls).
 * Prisma is mocked so DB is not required.
 */

// Mock Prisma client
jest.mock('../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    notificationPreference: {
      upsert: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
    },
  },
}));

// Mock nodemailer
jest.mock('nodemailer', () => ({
  createTransport: jest.fn().mockReturnValue({
    sendMail: jest.fn().mockResolvedValue({ messageId: 'test-id' }),
  }),
}));

import prisma from '../src/lib/prisma';
import {
  sendPaymentFailureEmail,
  sendPaymentSuccessEmail,
  sendCancellationEmail,
} from '../src/services/emailService';

const mockedPrisma = prisma as jest.Mocked<typeof prisma>;

const SUBSCRIBER = 'GABC123';
const MERCHANT = 'GXYZ456';
const TOKEN = 'CABC789';
const AMOUNT = '1000000';

beforeEach(() => {
  process.env.EMAIL_DRY_RUN = 'true';
  jest.clearAllMocks();

  // Default: pref exists with email enabled
  (mockedPrisma.notificationPreference.upsert as jest.Mock).mockResolvedValue({
    id: 1,
    email: 'user@test.com',
    unsubToken: 'test-token-abc',
    emailEnabled: true,
  });
  (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({
    id: 1,
    email: 'user@test.com',
    unsubToken: 'test-token-abc',
    emailEnabled: true,
  });
  (mockedPrisma.notificationPreference.findFirst as jest.Mock).mockResolvedValue({
    id: 1,
    email: 'user@test.com',
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    unsubToken: 'test-token-abc',
    emailEnabled: true,
  });
});

describe('EMAIL_DRY_RUN=true', () => {
  it('logs to console instead of sending when dry run', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await sendPaymentFailureEmail(SUBSCRIBER, MERCHANT, AMOUNT, TOKEN);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[email:dry-run]'),
    );

    consoleSpy.mockRestore();
  });

  it('sendPaymentSuccessEmail logs in dry-run mode', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await sendPaymentSuccessEmail(SUBSCRIBER, MERCHANT, AMOUNT);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[email:dry-run]'),
    );

    consoleSpy.mockRestore();
  });

  it('sendCancellationEmail logs in dry-run mode', async () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await sendCancellationEmail(SUBSCRIBER, MERCHANT);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[email:dry-run]'),
    );

    consoleSpy.mockRestore();
  });
});

describe('Opt-out / unsubscribe', () => {
  it('skips sending when emailEnabled=false', async () => {
    (mockedPrisma.notificationPreference.findUnique as jest.Mock).mockResolvedValue({
      id: 1,
      email: 'user@test.com',
      unsubToken: 'test-token-abc',
      emailEnabled: false,
    });
    (mockedPrisma.notificationPreference.findFirst as jest.Mock).mockResolvedValue({
      id: 1,
      email: 'user@test.com',
      subscriber: SUBSCRIBER,
      emailEnabled: false,
      unsubToken: 'test-token-abc',
    });

    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    await sendPaymentFailureEmail(SUBSCRIBER, MERCHANT, AMOUNT, TOKEN);

    // Should log "Skipping opted-out" instead of dry-run send
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('opted-out'),
    );
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('[email:dry-run]'),
    );

    consoleSpy.mockRestore();
  });
});

describe('No preferences registered', () => {
  it('does not throw when no notification preferences exist', async () => {
    (mockedPrisma.notificationPreference.findFirst as jest.Mock).mockResolvedValue(null);

    await expect(
      sendPaymentFailureEmail(SUBSCRIBER, MERCHANT, AMOUNT, TOKEN),
    ).resolves.not.toThrow();
  });
});
