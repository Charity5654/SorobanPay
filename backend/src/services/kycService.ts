/**
 * kycService.ts — KYC/AML third-party integration service.
 *
 * Issue #742: Integrate third-party KYC/AML verification into onboarding.
 *
 * Supports Onfido (default) and Jumio provider backends.
 * Provider is selected via KYC_PROVIDER env var ('onfido' | 'jumio').
 *
 * Features:
 * - Document verification (passport, national ID, driving license)
 * - Liveness detection
 * - AML screening on account creation
 * - Verification status stored and auditable
 * - Webhook callback handling
 * - Re-verification trigger on suspicious activity
 */

import prisma from '../lib/prisma';
import { logger } from '../lib/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export type KycProvider = 'onfido' | 'jumio';
export type KycStatus =
  | 'pending'
  | 'submitted'
  | 'approved'
  | 'rejected'
  | 'expired'
  | 're_verification_required';
export type AmlStatus = 'pending' | 'clear' | 'consider' | 'flagged';
export type DocumentType = 'passport' | 'national_id' | 'driving_license';

export interface InitiateKycParams {
  walletAddress: string;
  firstName: string;
  lastName: string;
  email: string;
  dateOfBirth: string; // ISO date YYYY-MM-DD
  countryCode: string; // ISO 3166-1 alpha-3
  documentType: DocumentType;
  ipAddress?: string;
  userAgent?: string;
}

export interface KycVerificationResult {
  walletAddress: string;
  status: KycStatus;
  provider: KycProvider;
  providerApplicantId?: string;
  sdkToken?: string; // Client-side SDK init token
  workflowRunId?: string;
  amlStatus: AmlStatus;
  livenessCompleted: boolean;
  documentType?: string;
  riskScore?: number;
  message: string;
}

export interface ProviderWebhookPayload {
  provider: KycProvider;
  event: string;
  resourceType?: string;
  applicantId?: string;
  workflowRunId?: string;
  checkId?: string;
  status?: string;
  subResult?: string;
  riskScore?: number;
  rawPayload: Record<string, unknown>;
}

// ─── Provider client interfaces ───────────────────────────────────────────────

interface ProviderApplicantResult {
  applicantId: string;
  sdkToken?: string;
  workflowRunId?: string;
}

interface ProviderCheckResult {
  checkId: string;
  status: AmlStatus;
  riskScore?: number;
}

// ─── Mock provider implementations ────────────────────────────────────────────
// In production, replace these with actual Onfido/Jumio SDK calls.

async function createOnfidoApplicant(
  params: InitiateKycParams
): Promise<ProviderApplicantResult> {
  // Production: POST https://api.onfido.com/v3.6/applicants
  // const response = await fetch('https://api.onfido.com/v3.6/applicants', {
  //   method: 'POST',
  //   headers: {
  //     'Authorization': `Token token=${process.env.ONFIDO_API_TOKEN}`,
  //     'Content-Type': 'application/json',
  //   },
  //   body: JSON.stringify({
  //     first_name: params.firstName,
  //     last_name: params.lastName,
  //     email: params.email,
  //     dob: params.dateOfBirth,
  //     address: { country: params.countryCode },
  //   }),
  // });
  // const data = await response.json();
  // Generate SDK token for client-side Onfido SDK
  // const tokenResp = await fetch('https://api.onfido.com/v3.6/sdk_token', { ... });
  logger.info({ msg: 'Creating Onfido applicant', wallet: params.walletAddress });
  return {
    applicantId: `onfido_${Date.now()}_${params.walletAddress.slice(0, 8)}`,
    sdkToken: `sdk_token_${Date.now()}`,
    workflowRunId: `wf_${Date.now()}`,
  };
}

async function createOnfidoAmlCheck(
  applicantId: string
): Promise<ProviderCheckResult> {
  // Production: POST https://api.onfido.com/v3.6/checks
  // body: { applicant_id, report_names: ['watchlist_enhanced'] }
  logger.info({ msg: 'Running Onfido AML check', applicantId });
  return {
    checkId: `check_${Date.now()}`,
    status: 'pending' as AmlStatus,
  };
}

async function createJumioTransaction(
  params: InitiateKycParams
): Promise<ProviderApplicantResult> {
  // Production: POST https://api.netverify.com/web/v4/initiate
  logger.info({ msg: 'Creating Jumio transaction', wallet: params.walletAddress });
  return {
    applicantId: `jumio_${Date.now()}_${params.walletAddress.slice(0, 8)}`,
    sdkToken: `jumio_token_${Date.now()}`,
    workflowRunId: `jumio_wf_${Date.now()}`,
  };
}

async function runJumioAmlScreening(
  transactionReference: string
): Promise<ProviderCheckResult> {
  // Production: POST https://api.netverify.com/aml/v1/screening
  logger.info({ msg: 'Running Jumio AML screening', transactionReference });
  return {
    checkId: `jumio_aml_${Date.now()}`,
    status: 'pending' as AmlStatus,
  };
}

// ─── KYC Service ──────────────────────────────────────────────────────────────

export class KycService {
  private provider: KycProvider;

  constructor(provider?: KycProvider) {
    const envProvider = process.env.KYC_PROVIDER as KycProvider | undefined;
    this.provider = provider ?? envProvider ?? 'onfido';
  }

  /**
   * Initiate KYC verification for a wallet address.
   *
   * Creates a provider applicant, stores the verification record,
   * runs AML screening, and returns an SDK token for the client.
   *
   * @throws if wallet is already verified or has a pending verification
   */
  async initiateVerification(
    params: InitiateKycParams
  ): Promise<KycVerificationResult> {
    const { walletAddress, ipAddress, userAgent } = params;

    logger.info({ msg: 'KYC: initiating verification', wallet: walletAddress, provider: this.provider });

    // Idempotency: if already approved, skip
    const existing = await prisma.kycVerification.findUnique({
      where: { walletAddress },
    });

    if (existing?.status === 'approved') {
      return this.buildResult(existing, 'Already verified.');
    }

    // Create or update provider applicant
    let providerResult: ProviderApplicantResult;
    let amlResult: ProviderCheckResult;

    if (this.provider === 'onfido') {
      providerResult = await createOnfidoApplicant(params);
      amlResult = await createOnfidoAmlCheck(providerResult.applicantId);
    } else {
      providerResult = await createJumioTransaction(params);
      amlResult = await runJumioAmlScreening(providerResult.applicantId);
    }

    // Persist verification record
    const record = await prisma.kycVerification.upsert({
      where: { walletAddress },
      create: {
        walletAddress,
        status: 'submitted',
        provider: this.provider,
        providerApplicantId: providerResult.applicantId,
        providerWorkflowRunId: providerResult.workflowRunId,
        documentType: params.documentType,
        amlStatus: 'pending',
        amlCheckId: amlResult.checkId,
        countryCode: params.countryCode,
        submittedAt: new Date(),
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
      },
      update: {
        status: 'submitted',
        provider: this.provider,
        providerApplicantId: providerResult.applicantId,
        providerWorkflowRunId: providerResult.workflowRunId,
        documentType: params.documentType,
        amlStatus: 'pending',
        amlCheckId: amlResult.checkId,
        submittedAt: new Date(),
        updatedAt: new Date(),
      },
    });

    // Audit log
    await this.auditLog(walletAddress, 'initiated', 'user', {
      provider: this.provider,
      applicantId: providerResult.applicantId,
      documentType: params.documentType,
    }, ipAddress, userAgent);

    logger.info({ msg: 'KYC: verification initiated', wallet: walletAddress, applicantId: providerResult.applicantId });

    return {
      ...this.buildResult(record, 'KYC verification initiated. Complete the document upload flow.'),
      sdkToken: providerResult.sdkToken,
      workflowRunId: providerResult.workflowRunId,
    };
  }

  /**
   * Get the current verification status for a wallet address.
   */
  async getVerificationStatus(
    walletAddress: string
  ): Promise<KycVerificationResult | null> {
    const record = await prisma.kycVerification.findUnique({
      where: { walletAddress },
    });

    if (!record) return null;
    return this.buildResult(record, this.statusMessage(record.status as KycStatus));
  }

  /**
   * Handle incoming webhook from the KYC provider.
   *
   * Updates verification status, runs liveness/document result processing,
   * updates AML screening result, and triggers re-verification if needed.
   */
  async handleWebhook(payload: ProviderWebhookPayload): Promise<void> {
    const { event, applicantId, workflowRunId, status, riskScore } = payload;

    logger.info({ msg: 'KYC webhook received', event, applicantId, workflowRunId, provider: payload.provider });

    // Find the verification record
    const record = await prisma.kycVerification.findFirst({
      where: {
        OR: [
          { providerApplicantId: applicantId ?? undefined },
          { providerWorkflowRunId: workflowRunId ?? undefined },
        ],
      },
    });

    if (!record) {
      logger.warn({ msg: 'KYC webhook: no matching verification record', applicantId, workflowRunId });
      return;
    }

    const walletAddress = record.walletAddress;

    // Append raw event to webhook log
    const currentLog: unknown[] = (() => {
      try {
        return JSON.parse(record.webhookLog) as unknown[];
      } catch {
        return [];
      }
    })();
    currentLog.push({ ...payload.rawPayload, receivedAt: new Date().toISOString() });
    const updatedLog = JSON.stringify(currentLog.slice(-50)); // keep last 50 events

    // Process event type
    let newStatus: KycStatus = record.status as KycStatus;
    let amlStatus: AmlStatus = record.amlStatus as AmlStatus;
    let livenessCompleted = record.livenessCompleted;
    let approvedAt: Date | undefined;
    let rejectedAt: Date | undefined;
    let newRiskScore: number | undefined = record.riskScore ?? undefined;

    // Onfido event types
    if (payload.provider === 'onfido') {
      if (event === 'workflow_run.completed') {
        if (status === 'approved') {
          newStatus = 'approved';
          approvedAt = new Date();
        } else if (status === 'declined') {
          newStatus = 'rejected';
          rejectedAt = new Date();
        }
      } else if (event === 'check.completed') {
        // AML check result
        const subResult = payload.subResult?.toLowerCase();
        if (subResult === 'clear') {
          amlStatus = 'clear';
        } else if (subResult === 'consider') {
          amlStatus = 'consider';
        } else {
          amlStatus = 'flagged';
        }
        if (riskScore !== undefined) newRiskScore = riskScore;
      } else if (event === 'liveness_photo.created' || event === 'video.created') {
        livenessCompleted = true;
      }
    }

    // Jumio event types
    if (payload.provider === 'jumio') {
      if (event === 'transaction.success') {
        newStatus = 'approved';
        approvedAt = new Date();
        livenessCompleted = true;
      } else if (event === 'transaction.failed' || event === 'transaction.declined') {
        newStatus = 'rejected';
        rejectedAt = new Date();
      } else if (event === 'aml_screening.completed') {
        amlStatus = (status as AmlStatus) ?? 'clear';
        if (riskScore !== undefined) newRiskScore = riskScore;
      }
    }

    // Update record
    await prisma.kycVerification.update({
      where: { id: record.id },
      data: {
        status: newStatus,
        amlStatus,
        livenessCompleted,
        riskScore: newRiskScore,
        approvedAt: approvedAt ?? record.approvedAt,
        rejectedAt: rejectedAt ?? record.rejectedAt,
        webhookLog: updatedLog,
        updatedAt: new Date(),
      },
    });

    // Audit log
    await this.auditLog(walletAddress, 'webhook_received', 'webhook', {
      event,
      newStatus,
      amlStatus,
      riskScore: newRiskScore,
    });

    // AML flagged: if high-risk, trigger re-verification
    if (amlStatus === 'flagged' && (newRiskScore ?? 0) >= 75) {
      await this.triggerReVerification(
        walletAddress,
        `AML screening flagged high-risk score: ${newRiskScore}`,
        'system'
      );
    }

    logger.info({ msg: 'KYC webhook processed', wallet: walletAddress, event, newStatus, amlStatus });
  }

  /**
   * Trigger re-verification for a wallet address.
   *
   * Called automatically on suspicious activity (high AML risk score,
   * fraud signals, admin override).
   */
  async triggerReVerification(
    walletAddress: string,
    reason: string,
    actor: string = 'system',
    ipAddress?: string
  ): Promise<void> {
    logger.info({ msg: 'KYC: triggering re-verification', wallet: walletAddress, reason, actor });

    const existing = await prisma.kycVerification.findUnique({
      where: { walletAddress },
    });

    if (!existing) {
      throw new Error(`No KYC record found for wallet ${walletAddress}`);
    }

    await prisma.kycVerification.update({
      where: { walletAddress },
      data: {
        status: 're_verification_required',
        updatedAt: new Date(),
      },
    });

    await this.auditLog(walletAddress, 're_verification_triggered', actor, {
      reason,
      previousStatus: existing.status,
      previousAmlStatus: existing.amlStatus,
    }, ipAddress);

    logger.warn({ msg: 'KYC: re-verification required', wallet: walletAddress, reason });
  }

  /**
   * Check whether a wallet address is allowed to transact.
   * Returns true only if KYC is approved and AML is clear or pending initial.
   */
  async isVerified(walletAddress: string): Promise<boolean> {
    const record = await prisma.kycVerification.findUnique({
      where: { walletAddress },
      select: { status: true, amlStatus: true, expiresAt: true },
    });

    if (!record) return false;
    if (record.status !== 'approved') return false;
    if (record.amlStatus === 'flagged') return false;
    if (record.expiresAt && record.expiresAt < new Date()) return false;

    return true;
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private buildResult(
    record: {
      walletAddress: string;
      status: string;
      provider: string;
      providerApplicantId: string | null;
      livenessCompleted: boolean;
      documentType: string | null;
      amlStatus: string;
      riskScore: number | null;
    },
    message: string
  ): KycVerificationResult {
    return {
      walletAddress: record.walletAddress,
      status: record.status as KycStatus,
      provider: record.provider as KycProvider,
      providerApplicantId: record.providerApplicantId ?? undefined,
      livenessCompleted: record.livenessCompleted,
      documentType: record.documentType ?? undefined,
      amlStatus: record.amlStatus as AmlStatus,
      riskScore: record.riskScore ?? undefined,
      message,
    };
  }

  private statusMessage(status: KycStatus): string {
    const messages: Record<KycStatus, string> = {
      pending: 'Verification not yet started.',
      submitted: 'Verification submitted — awaiting provider review.',
      approved: 'Identity verified.',
      rejected: 'Verification rejected. Please contact support.',
      expired: 'Verification expired. Re-verification required.',
      re_verification_required: 'Re-verification required due to compliance review.',
    };
    return messages[status] ?? 'Unknown status.';
  }

  private async auditLog(
    walletAddress: string,
    action: string,
    actor: string,
    details: Record<string, unknown>,
    ipAddress?: string,
    userAgent?: string
  ): Promise<void> {
    await prisma.kycAuditLog.create({
      data: {
        walletAddress,
        action,
        actor,
        details: JSON.stringify(details),
        ipAddress: ipAddress ?? null,
        userAgent: userAgent ?? null,
      },
    });
  }
}

export const kycService = new KycService();
