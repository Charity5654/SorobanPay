/**
 * kycService.test.ts — KYC/AML service unit tests.
 * Issue #742.
 */

import { KycService, type InitiateKycParams, type ProviderWebhookPayload } from '../../src/services/kycService';

// ─── Prisma mock ──────────────────────────────────────────────────────────────
jest.mock('../../src/lib/prisma', () => ({
  __esModule: true,
  default: {
    kycVerification: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
      update: jest.fn(),
      findFirst: jest.fn(),
    },
    kycAuditLog: {
      create: jest.fn(),
    },
  },
}));

import prisma from '../../src/lib/prisma';

// ─── Logger mock ──────────────────────────────────────────────────────────────
jest.mock('../../src/lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

// ─── Test data ────────────────────────────────────────────────────────────────

const TEST_WALLET = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890';

const baseParams: InitiateKycParams = {
  walletAddress: TEST_WALLET,
  firstName: 'Alice',
  lastName: 'Test',
  email: 'alice@example.com',
  dateOfBirth: '1990-01-01',
  countryCode: 'GBR',
  documentType: 'passport',
};

const mockRecord = {
  id: 1,
  walletAddress: TEST_WALLET,
  status: 'submitted',
  provider: 'onfido',
  providerApplicantId: 'onfido_app_001',
  providerWorkflowRunId: 'wf_001',
  documentType: 'passport',
  livenessCompleted: false,
  amlStatus: 'pending',
  amlCheckId: 'check_001',
  countryCode: 'GBR',
  riskScore: null,
  webhookLog: '[]',
  submittedAt: new Date(),
  approvedAt: null,
  rejectedAt: null,
  expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
  createdAt: new Date(),
  updatedAt: new Date(),
};

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('KycService', () => {
  let service: KycService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new KycService('onfido');
  });

  describe('initiateVerification', () => {
    test('creates a new verification record', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.kycVerification.upsert as jest.Mock).mockResolvedValue({
        ...mockRecord,
        status: 'submitted',
      });
      (prisma.kycAuditLog.create as jest.Mock).mockResolvedValue({});

      const result = await service.initiateVerification(baseParams);

      expect(result.walletAddress).toBe(TEST_WALLET);
      expect(result.status).toBe('submitted');
      expect(result.provider).toBe('onfido');
      expect(prisma.kycVerification.upsert).toHaveBeenCalledTimes(1);
      expect(prisma.kycAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'initiated', actor: 'user' }),
        })
      );
    });

    test('returns existing record if already approved', async () => {
      const approvedRecord = { ...mockRecord, status: 'approved' };
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue(approvedRecord);

      const result = await service.initiateVerification(baseParams);

      expect(result.status).toBe('approved');
      expect(result.message).toBe('Already verified.');
      // Should not call upsert
      expect(prisma.kycVerification.upsert).not.toHaveBeenCalled();
    });

    test('includes sdkToken in response', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.kycVerification.upsert as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.kycAuditLog.create as jest.Mock).mockResolvedValue({});

      const result = await service.initiateVerification(baseParams);

      expect(result.sdkToken).toBeDefined();
      expect(typeof result.sdkToken).toBe('string');
    });
  });

  describe('getVerificationStatus', () => {
    test('returns null for unknown wallet', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getVerificationStatus(TEST_WALLET);

      expect(result).toBeNull();
    });

    test('returns status for known wallet', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue(mockRecord);

      const result = await service.getVerificationStatus(TEST_WALLET);

      expect(result).not.toBeNull();
      expect(result!.walletAddress).toBe(TEST_WALLET);
      expect(result!.status).toBe('submitted');
    });
  });

  describe('handleWebhook', () => {
    test('handles Onfido workflow_run.completed/approved event', async () => {
      (prisma.kycVerification.findFirst as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.kycVerification.update as jest.Mock).mockResolvedValue({ ...mockRecord, status: 'approved' });
      (prisma.kycAuditLog.create as jest.Mock).mockResolvedValue({});

      const payload: ProviderWebhookPayload = {
        provider: 'onfido',
        event: 'workflow_run.completed',
        applicantId: 'onfido_app_001',
        status: 'approved',
        rawPayload: {},
      };

      await service.handleWebhook(payload);

      expect(prisma.kycVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'approved' }),
        })
      );
    });

    test('handles Onfido workflow_run.completed/declined event', async () => {
      (prisma.kycVerification.findFirst as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.kycVerification.update as jest.Mock).mockResolvedValue({ ...mockRecord, status: 'rejected' });
      (prisma.kycAuditLog.create as jest.Mock).mockResolvedValue({});

      const payload: ProviderWebhookPayload = {
        provider: 'onfido',
        event: 'workflow_run.completed',
        applicantId: 'onfido_app_001',
        status: 'declined',
        rawPayload: {},
      };

      await service.handleWebhook(payload);

      expect(prisma.kycVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'rejected' }),
        })
      );
    });

    test('handles Onfido AML check.completed with clear result', async () => {
      (prisma.kycVerification.findFirst as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.kycVerification.update as jest.Mock).mockResolvedValue({ ...mockRecord, amlStatus: 'clear' });
      (prisma.kycAuditLog.create as jest.Mock).mockResolvedValue({});

      const payload: ProviderWebhookPayload = {
        provider: 'onfido',
        event: 'check.completed',
        applicantId: 'onfido_app_001',
        subResult: 'clear',
        rawPayload: {},
      };

      await service.handleWebhook(payload);

      expect(prisma.kycVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ amlStatus: 'clear' }),
        })
      );
    });

    test('triggers re-verification when AML flagged with high risk score', async () => {
      const flaggedRecord = { ...mockRecord, status: 'approved' };
      (prisma.kycVerification.findFirst as jest.Mock).mockResolvedValue(flaggedRecord);
      (prisma.kycVerification.update as jest.Mock).mockResolvedValue({
        ...flaggedRecord,
        amlStatus: 'flagged',
        riskScore: 90,
      });
      (prisma.kycAuditLog.create as jest.Mock).mockResolvedValue({});
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue(flaggedRecord);

      const payload: ProviderWebhookPayload = {
        provider: 'onfido',
        event: 'check.completed',
        applicantId: 'onfido_app_001',
        subResult: 'flagged',
        riskScore: 90,
        rawPayload: {},
      };

      await service.handleWebhook(payload);

      // Should have called update twice: once for the check, once for re-verification
      expect(prisma.kycVerification.update).toHaveBeenCalledTimes(2);
    });

    test('handles Jumio transaction.success event', async () => {
      const jumioService = new KycService('jumio');
      const jumioRecord = { ...mockRecord, provider: 'jumio', providerApplicantId: 'jumio_ref_001' };
      (prisma.kycVerification.findFirst as jest.Mock).mockResolvedValue(jumioRecord);
      (prisma.kycVerification.update as jest.Mock).mockResolvedValue({ ...jumioRecord, status: 'approved' });
      (prisma.kycAuditLog.create as jest.Mock).mockResolvedValue({});

      const payload: ProviderWebhookPayload = {
        provider: 'jumio',
        event: 'transaction.success',
        applicantId: 'jumio_ref_001',
        rawPayload: {},
      };

      await jumioService.handleWebhook(payload);

      expect(prisma.kycVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'approved', livenessCompleted: true }),
        })
      );
    });

    test('returns early for unknown applicant ID', async () => {
      (prisma.kycVerification.findFirst as jest.Mock).mockResolvedValue(null);

      await service.handleWebhook({
        provider: 'onfido',
        event: 'workflow_run.completed',
        applicantId: 'unknown_id',
        rawPayload: {},
      });

      expect(prisma.kycVerification.update).not.toHaveBeenCalled();
    });
  });

  describe('triggerReVerification', () => {
    test('sets status to re_verification_required', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue(mockRecord);
      (prisma.kycVerification.update as jest.Mock).mockResolvedValue({
        ...mockRecord,
        status: 're_verification_required',
      });
      (prisma.kycAuditLog.create as jest.Mock).mockResolvedValue({});

      await service.triggerReVerification(TEST_WALLET, 'Suspicious activity detected', 'system');

      expect(prisma.kycVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 're_verification_required' }),
        })
      );
      expect(prisma.kycAuditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 're_verification_triggered' }),
        })
      );
    });

    test('throws if no record found', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(
        service.triggerReVerification(TEST_WALLET, 'reason', 'system')
      ).rejects.toThrow(`No KYC record found for wallet ${TEST_WALLET}`);
    });
  });

  describe('isVerified', () => {
    test('returns true for approved, clear, non-expired record', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue({
        status: 'approved',
        amlStatus: 'clear',
        expiresAt: new Date(Date.now() + 86400000),
      });

      expect(await service.isVerified(TEST_WALLET)).toBe(true);
    });

    test('returns false for pending status', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue({
        status: 'pending',
        amlStatus: 'pending',
        expiresAt: null,
      });

      expect(await service.isVerified(TEST_WALLET)).toBe(false);
    });

    test('returns false for approved but flagged AML', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue({
        status: 'approved',
        amlStatus: 'flagged',
        expiresAt: new Date(Date.now() + 86400000),
      });

      expect(await service.isVerified(TEST_WALLET)).toBe(false);
    });

    test('returns false for approved but expired', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue({
        status: 'approved',
        amlStatus: 'clear',
        expiresAt: new Date(Date.now() - 1000), // in the past
      });

      expect(await service.isVerified(TEST_WALLET)).toBe(false);
    });

    test('returns false if no record exists', async () => {
      (prisma.kycVerification.findUnique as jest.Mock).mockResolvedValue(null);

      expect(await service.isVerified(TEST_WALLET)).toBe(false);
    });
  });
});
