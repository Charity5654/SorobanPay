/**
 * kyc.ts — KYC/AML verification REST API routes.
 *
 * Issue #742: KYC/AML third-party integration.
 *
 * Routes:
 *   POST /api/v1/kyc/initiate          — start KYC for a wallet
 *   GET  /api/v1/kyc/status/:wallet    — get verification status
 *   POST /api/v1/kyc/webhook/onfido    — Onfido webhook endpoint
 *   POST /api/v1/kyc/webhook/jumio     — Jumio webhook endpoint
 *   POST /api/v1/kyc/re-verify         — trigger re-verification (admin/system)
 *   GET  /api/v1/kyc/audit/:wallet     — fetch audit log for a wallet
 */

import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import prisma from '../lib/prisma';
import { logger } from '../lib/logger';
import { kycService, type ProviderWebhookPayload } from '../services/kycService';

const router = Router();

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Validate an Onfido webhook signature.
 * Onfido sends X-SHA2-Signature: sha256=<hmac> with the raw body.
 */
function validateOnfidoSignature(
  rawBody: Buffer,
  signature: string,
  secret: string
): boolean {
  const expected = `sha256=${crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex')}`;
  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

/**
 * Validate a Jumio webhook signature.
 * Jumio sends X-Jumio-Signature: <base64_hmac> over the raw body.
 */
function validateJumioSignature(
  rawBody: Buffer,
  signature: string,
  secret: string
): boolean {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('base64');
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(expected, 'base64')
    );
  } catch {
    return false;
  }
}

// ─── POST /initiate ────────────────────────────────────────────────────────────
router.post('/initiate', async (req: Request, res: Response) => {
  try {
    const {
      walletAddress,
      firstName,
      lastName,
      email,
      dateOfBirth,
      countryCode,
      documentType,
    } = req.body as {
      walletAddress: string;
      firstName: string;
      lastName: string;
      email: string;
      dateOfBirth: string;
      countryCode: string;
      documentType: 'passport' | 'national_id' | 'driving_license';
    };

    // Basic validation
    if (!walletAddress || !firstName || !lastName || !email || !dateOfBirth || !countryCode || !documentType) {
      return res.status(400).json({ error: 'Missing required fields', required: ['walletAddress', 'firstName', 'lastName', 'email', 'dateOfBirth', 'countryCode', 'documentType'] });
    }

    if (!['passport', 'national_id', 'driving_license'].includes(documentType)) {
      return res.status(400).json({ error: 'Invalid documentType', allowed: ['passport', 'national_id', 'driving_license'] });
    }

    // Validate Stellar address format (G + 55 alphanumeric chars)
    if (!/^G[A-Z0-9]{55}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid walletAddress — must be a valid Stellar G-address' });
    }

    const result = await kycService.initiateVerification({
      walletAddress,
      firstName,
      lastName,
      email,
      dateOfBirth,
      countryCode,
      documentType,
      ipAddress: req.ip ?? undefined,
      userAgent: req.headers['user-agent'],
    });

    return res.status(201).json(result);
  } catch (err) {
    logger.error({ msg: 'KYC initiate error', err });
    return res.status(500).json({ error: 'Failed to initiate KYC verification' });
  }
});

// ─── GET /status/:walletAddress ────────────────────────────────────────────────
router.get('/status/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!/^G[A-Z0-9]{55}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid walletAddress' });
    }

    const status = await kycService.getVerificationStatus(walletAddress);

    if (!status) {
      return res.status(404).json({
        error: 'No KYC record found for this wallet',
        walletAddress,
        status: 'not_found',
      });
    }

    return res.json(status);
  } catch (err) {
    logger.error({ msg: 'KYC status error', err });
    return res.status(500).json({ error: 'Failed to retrieve KYC status' });
  }
});

// ─── POST /webhook/onfido ──────────────────────────────────────────────────────
// Onfido sends raw JSON body with X-SHA2-Signature header.
// We register this route BEFORE express.json() in the app so we can access rawBody.
router.post('/webhook/onfido', async (req: Request, res: Response) => {
  try {
    const secret = process.env.ONFIDO_WEBHOOK_SECRET;
    const signature = req.headers['x-sha2-signature'] as string | undefined;

    if (secret && signature) {
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
      if (!validateOnfidoSignature(rawBody, signature, secret)) {
        logger.warn({ msg: 'Onfido webhook: invalid signature' });
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const body = req.body as Record<string, unknown>;
    const payload = body.payload as Record<string, unknown> | undefined;

    const webhookPayload: ProviderWebhookPayload = {
      provider: 'onfido',
      event: (payload?.action as string) ?? (body.event as string) ?? 'unknown',
      resourceType: (payload?.resource_type as string) ?? undefined,
      applicantId:
        (payload?.object as Record<string, unknown>)?.id as string | undefined ??
        (body.applicant_id as string) ?? undefined,
      workflowRunId:
        (payload?.object as Record<string, unknown>)?.id as string | undefined ??
        (body.workflow_run_id as string) ?? undefined,
      checkId: (body.check_id as string) ?? undefined,
      status: (payload?.object as Record<string, unknown>)?.status as string | undefined,
      subResult: (payload?.object as Record<string, unknown>)?.sub_result as string | undefined,
      rawPayload: body,
    };

    await kycService.handleWebhook(webhookPayload);

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ msg: 'Onfido webhook processing error', err });
    // Return 200 to prevent provider from retrying on server errors —
    // they will retry on 4xx/5xx, causing duplicate processing.
    return res.status(200).json({ received: true, processingError: true });
  }
});

// ─── POST /webhook/jumio ───────────────────────────────────────────────────────
router.post('/webhook/jumio', async (req: Request, res: Response) => {
  try {
    const secret = process.env.JUMIO_WEBHOOK_SECRET;
    const signature = req.headers['x-jumio-signature'] as string | undefined;

    if (secret && signature) {
      const rawBody = (req as Request & { rawBody?: Buffer }).rawBody ?? Buffer.from(JSON.stringify(req.body));
      if (!validateJumioSignature(rawBody, signature, secret)) {
        logger.warn({ msg: 'Jumio webhook: invalid signature' });
        return res.status(401).json({ error: 'Invalid webhook signature' });
      }
    }

    const body = req.body as Record<string, unknown>;

    const webhookPayload: ProviderWebhookPayload = {
      provider: 'jumio',
      event: (body.event as string) ?? (body.callbackType as string) ?? 'unknown',
      applicantId: (body.transactionReference as string) ?? undefined,
      workflowRunId: (body.transactionReference as string) ?? undefined,
      status: (body.idCheckStatus as string) ?? undefined,
      riskScore:
        typeof body.riskScore === 'number' ? body.riskScore : undefined,
      rawPayload: body,
    };

    await kycService.handleWebhook(webhookPayload);

    return res.status(200).json({ received: true });
  } catch (err) {
    logger.error({ msg: 'Jumio webhook processing error', err });
    return res.status(200).json({ received: true, processingError: true });
  }
});

// ─── POST /re-verify ──────────────────────────────────────────────────────────
router.post('/re-verify', async (req: Request, res: Response) => {
  try {
    const { walletAddress, reason } = req.body as {
      walletAddress: string;
      reason: string;
    };

    if (!walletAddress || !reason) {
      return res.status(400).json({ error: 'walletAddress and reason are required' });
    }

    if (!/^G[A-Z0-9]{55}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid walletAddress' });
    }

    await kycService.triggerReVerification(
      walletAddress,
      reason,
      'admin',
      req.ip ?? undefined
    );

    return res.json({
      message: 'Re-verification triggered successfully',
      walletAddress,
      status: 're_verification_required',
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('No KYC record')) {
      return res.status(404).json({ error: err.message });
    }
    logger.error({ msg: 'KYC re-verify error', err });
    return res.status(500).json({ error: 'Failed to trigger re-verification' });
  }
});

// ─── GET /audit/:walletAddress ─────────────────────────────────────────────────
router.get('/audit/:walletAddress', async (req: Request, res: Response) => {
  try {
    const { walletAddress } = req.params;

    if (!/^G[A-Z0-9]{55}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid walletAddress' });
    }

    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;

    const [auditLogs, total] = await Promise.all([
      prisma.kycAuditLog.findMany({
        where: { walletAddress },
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.kycAuditLog.count({ where: { walletAddress } }),
    ]);

    return res.json({
      walletAddress,
      total,
      limit,
      offset,
      logs: auditLogs.map((log) => ({
        ...log,
        details: (() => {
          try { return JSON.parse(log.details); } catch { return {}; }
        })(),
      })),
    });
  } catch (err) {
    logger.error({ msg: 'KYC audit log error', err });
    return res.status(500).json({ error: 'Failed to retrieve KYC audit logs' });
  }
});

export default router;
