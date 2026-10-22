import { notifyWebhooks, signPayload } from '../webhookNotifier';
import { enqueueWebhookDelivery, getWebhookQueue } from '../webhookQueue';
import prisma from '../../lib/prisma';
import { createHmac } from 'crypto';

jest.mock('../../lib/prisma', () => ({
  __esModule: true,
  default: {
    webhookEndpoint: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    webhookDelivery: {
      create: jest.fn(),
    },
  },
}));

jest.mock('../webhookQueue', () => ({
  enqueueWebhookDelivery: jest.fn(),
  getWebhookQueue: jest.fn(),
}));

global.fetch = jest.fn();

describe('Webhook Service', () => {
  const mockPayload = {
    event: 'payment.executed' as const,
    subscriber: 'GABC...',
    merchant: 'GMERCHANT...',
    amount: '1000',
    timestamp: 1234567890,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (getWebhookQueue as jest.Mock).mockReturnValue({}); // Queue exists by default
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('Event type is in endpoint.events — delivery is queued correctly', async () => {
    (prisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValue([
      { id: 1, url: 'https://example.com/hook', secret: null, events: 'payment.executed,payment.failed' }
    ]);

    await notifyWebhooks(mockPayload);
    expect(enqueueWebhookDelivery).toHaveBeenCalledTimes(1);
    expect(enqueueWebhookDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        endpointId: 1,
        payload: mockPayload,
      })
    );
  });

  it('Event type is NOT in endpoint.events — delivery is skipped silently', async () => {
    (prisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValue([
      { id: 2, url: 'https://example.com/hook2', secret: null, events: 'payment.failed' }
    ]);

    await notifyWebhooks(mockPayload);
    expect(enqueueWebhookDelivery).not.toHaveBeenCalled();
  });

  it('HMAC-SHA256 signature is generated correctly and verifiable', () => {
    const body = JSON.stringify(mockPayload);
    const secret = 'my-super-secret';
    const signature = signPayload(body, secret);

    const expectedHmac = createHmac('sha256', secret).update(body).digest('hex');
    expect(signature).toBe(`sha256=${expectedHmac}`);
  });

  it('A non-2xx HTTP response from the webhook URL triggers a retry', async () => {
    // Force fallback to deliverWithRetry
    (getWebhookQueue as jest.Mock).mockReturnValue(null);
    (prisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValue([
      { id: 3, url: 'https://example.com/hook3', secret: null, events: 'payment.executed' }
    ]);

    (global.fetch as jest.Mock)
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true, status: 200 });

    const promise = notifyWebhooks(mockPayload);
    
    // Fast-forward past the 1s retry delay
    await jest.runAllTimersAsync();
    await promise;

    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('After the maximum number of retries the delivery moves to the dead letter queue', async () => {
    // Force fallback to deliverWithRetry
    (getWebhookQueue as jest.Mock).mockReturnValue(null);
    (prisma.webhookEndpoint.findMany as jest.Mock).mockResolvedValue([
      { id: 4, url: 'https://example.com/hook4', secret: null, events: 'payment.executed' }
    ]);

    (global.fetch as jest.Mock).mockResolvedValue({ ok: false, status: 500 });

    const promise = notifyWebhooks(mockPayload);
    
    // Fast-forward through all MAX_ATTEMPTS backoffs
    await jest.runAllTimersAsync();
    await promise;

    // MAX_ATTEMPTS is 5 in webhookNotifier.ts
    expect(global.fetch).toHaveBeenCalledTimes(5);
    
    expect(prisma.webhookDelivery.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          attempt: 5,
          success: false,
        }),
      })
    );
  });
});
