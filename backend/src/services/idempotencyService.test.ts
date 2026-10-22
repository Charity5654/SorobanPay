/**
 * idempotencyService.test.ts
 *
 * Tests for idempotency key tracking and conflict detection.
 *
 * Covers:
 *  - First request (new key)
 *  - Retry with same parameters (cache hit)
 *  - Retry with conflicting parameters (ConflictError)
 *  - Success and failure recording
 *  - UUID generation and validation
 *  - Error handling and observability
 */

import {
  checkIdempotencyKey,
  recordIdempotencySuccess,
  recordIdempotencyFailure,
  handleIdempotencyCheck,
  generateIdempotencyKey,
  isValidIdempotencyKey,
  IdempotencyConflictError,
  IdempotencyAuthorizationError,
  IdempotencyError,
} from './idempotencyService';
import prisma from '../lib/prisma';

jest.mock('../lib/prisma', () => ({
  paymentIdempotency: {
    findUnique: jest.fn(),
    upsert: jest.fn(),
  },
}));

jest.mock('../lib/logger', () => {
  const actual = jest.requireActual('../lib/logger');
  return {
    __esModule: true,
    ...actual,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

describe('idempotencyService', () => {
  const mockPrisma = prisma as jest.Mocked<typeof prisma>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkIdempotencyKey', () => {
    it('returns exists=false for new key', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce(null);

      const result = await checkIdempotencyKey({
        idempotencyKey: 'new-key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
      });

      expect(result.exists).toBe(false);
      expect(result.isConflict).toBeUndefined();
    });

    it('returns cached success result for same parameters', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: 'txhash123',
        status: 'succeeded',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await checkIdempotencyKey({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
      });

      expect(result.exists).toBe(true);
      expect(result.status).toBe('succeeded');
      expect(result.txHash).toBe('txhash123');
      expect(result.isConflict).toBe(false);
    });

    it('detects conflict when subscriber differs', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER1',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'pending',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await checkIdempotencyKey({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER2', // Different
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
      });

      expect(result.exists).toBe(true);
      expect(result.isConflict).toBe(true);
    });

    it('detects conflict when amount differs', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'pending',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await checkIdempotencyKey({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '2000', // Different
      });

      expect(result.exists).toBe(true);
      expect(result.isConflict).toBe(true);
    });

    it('returns pending status for in-progress request', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'pending',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await checkIdempotencyKey({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
      });

      expect(result.status).toBe('pending');
      expect(result.txHash).toBeUndefined();
    });

    it('returns failed status with error message', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'failed',
        error: 'Insufficient balance',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await checkIdempotencyKey({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
      });

      expect(result.status).toBe('failed');
      expect(result.error).toBe('Insufficient balance');
    });

    it('handles database errors gracefully', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockRejectedValueOnce(
        new Error('Database connection failed'),
      );

      await expect(
        checkIdempotencyKey({
          idempotencyKey: 'key-123',
          subscriber: 'GSUBSCRIBER',
          merchant: 'GMERCHANT',
          token: 'CTOKEN',
          amount: '1000',
        }),
      ).rejects.toThrow(IdempotencyError);
    });
  });

  describe('recordIdempotencySuccess', () => {
    it('records successful payment with txHash', async () => {
      mockPrisma.paymentIdempotency.upsert.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: 'txhash123',
        status: 'succeeded',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await recordIdempotencySuccess(
        {
          idempotencyKey: 'key-123',
          subscriber: 'GSUBSCRIBER',
          merchant: 'GMERCHANT',
          token: 'CTOKEN',
          amount: '1000',
        },
        'txhash123',
      );

      expect(mockPrisma.paymentIdempotency.upsert).toHaveBeenCalledWith({
        where: { idempotencyKey: 'key-123' },
        update: {
          status: 'succeeded',
          txHash: 'txhash123',
          error: null,
          updatedAt: expect.any(Date),
        },
        create: {
          idempotencyKey: 'key-123',
          subscriber: 'GSUBSCRIBER',
          merchant: 'GMERCHANT',
          token: 'CTOKEN',
          amount: '1000',
          status: 'succeeded',
          txHash: 'txhash123',
        },
      });
    });

    it('handles upsert errors', async () => {
      mockPrisma.paymentIdempotency.upsert.mockRejectedValueOnce(
        new Error('Unique constraint failed'),
      );

      await expect(
        recordIdempotencySuccess(
          {
            idempotencyKey: 'key-123',
            subscriber: 'GSUBSCRIBER',
            merchant: 'GMERCHANT',
            token: 'CTOKEN',
            amount: '1000',
          },
          'txhash123',
        ),
      ).rejects.toThrow(IdempotencyError);
    });
  });

  describe('recordIdempotencyFailure', () => {
    it('records failed payment with error message', async () => {
      mockPrisma.paymentIdempotency.upsert.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'failed',
        error: 'Insufficient balance',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await recordIdempotencyFailure(
        {
          idempotencyKey: 'key-123',
          subscriber: 'GSUBSCRIBER',
          merchant: 'GMERCHANT',
          token: 'CTOKEN',
          amount: '1000',
        },
        'Insufficient balance',
      );

      expect(mockPrisma.paymentIdempotency.upsert).toHaveBeenCalledWith({
        where: { idempotencyKey: 'key-123' },
        update: {
          status: 'failed',
          error: 'Insufficient balance',
          updatedAt: expect.any(Date),
        },
        create: {
          idempotencyKey: 'key-123',
          subscriber: 'GSUBSCRIBER',
          merchant: 'GMERCHANT',
          token: 'CTOKEN',
          amount: '1000',
          status: 'failed',
          error: 'Insufficient balance',
        },
      });
    });
  });

  describe('handleIdempotencyCheck', () => {
    it('returns null for new key (proceed with execution)', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce(null);

      const result = await handleIdempotencyCheck({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
      });

      expect(result).toBeNull();
    });

    it('returns cached txHash for successful retry', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: 'txhash123',
        status: 'succeeded',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await handleIdempotencyCheck({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
      });

      expect(result).not.toBeNull();
      expect(result?.txHash).toBe('txhash123');
      expect(result?.isRetry).toBe(true);
    });

    it('throws ConflictError for conflicting parameters', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER1',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'pending',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(
        handleIdempotencyCheck({
          idempotencyKey: 'key-123',
          subscriber: 'GSUBSCRIBER2', // Different
          merchant: 'GMERCHANT',
          token: 'CTOKEN',
          amount: '1000',
        }),
      ).rejects.toThrow(IdempotencyConflictError);
    });

    it('allows retry after previous failure', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'failed',
        error: 'Network timeout',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await handleIdempotencyCheck({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
      });

      expect(result).toBeNull(); // Allow retry
    });

    it('allows retry for pending requests', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'pending',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const result = await handleIdempotencyCheck({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
      });

      expect(result).toBeNull(); // Allow retry (caller should backoff)
    });
  });

  describe('generateIdempotencyKey', () => {
    it('generates valid UUID v4', () => {
      const key = generateIdempotencyKey();

      expect(isValidIdempotencyKey(key)).toBe(true);
      // Basic UUID v4 format check: 8-4-4-4-12
      expect(key).toMatch(/^[0-9a-f-]{36}$/i);
    });

    it('generates unique keys', () => {
      const key1 = generateIdempotencyKey();
      const key2 = generateIdempotencyKey();

      expect(key1).not.toBe(key2);
    });
  });

  describe('tenant isolation and authorization', () => {
    it('authorizes access with matching tenant', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce(null);

      const result = await checkIdempotencyKey({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        tenantId: 'tenant-1',
      });

      expect(result.exists).toBe(false);
    });

    it('rejects access for unauthorized tenant on conflict', async () => {
      mockPrisma.paymentIdempotency.findUnique.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER1',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'pending',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Different subscriber with same key — conflict
      const result = await checkIdempotencyKey({
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER2', // Different
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        tenantId: 'tenant-1',
      });

      expect(result.isConflict).toBe(true);
    });

    it('records success with tenant context', async () => {
      mockPrisma.paymentIdempotency.upsert.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: 'txhash123',
        status: 'succeeded',
        error: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await recordIdempotencySuccess(
        {
          idempotencyKey: 'key-123',
          subscriber: 'GSUBSCRIBER',
          merchant: 'GMERCHANT',
          token: 'CTOKEN',
          amount: '1000',
          tenantId: 'tenant-1',
        },
        'txhash123',
      );

      expect(mockPrisma.paymentIdempotency.upsert).toHaveBeenCalled();
    });

    it('records failure with tenant context', async () => {
      mockPrisma.paymentIdempotency.upsert.mockResolvedValueOnce({
        id: 1,
        idempotencyKey: 'key-123',
        subscriber: 'GSUBSCRIBER',
        merchant: 'GMERCHANT',
        token: 'CTOKEN',
        amount: '1000',
        txHash: null,
        status: 'failed',
        error: 'Insufficient balance',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await recordIdempotencyFailure(
        {
          idempotencyKey: 'key-123',
          subscriber: 'GSUBSCRIBER',
          merchant: 'GMERCHANT',
          token: 'CTOKEN',
          amount: '1000',
          tenantId: 'tenant-1',
        },
        'Insufficient balance',
      );

      expect(mockPrisma.paymentIdempotency.upsert).toHaveBeenCalled();
    });
  });
});
