/**
 * #732 — SMS notification API routes.
 *
 * Routes:
 *   POST   /api/v1/sms/send                  — Send an SMS
 *   GET    /api/v1/sms/status/:logId          — Get delivery status
 *   GET    /api/v1/sms/logs/:userId           — Get SMS logs for a user
 *   POST   /api/v1/sms/optout                 — Record STOP / opt-out
 *   DELETE /api/v1/sms/optout/:phone          — Remove opt-out (START)
 *   GET    /api/v1/sms/optout/:phone          — Check opt-out status
 *   POST   /api/v1/sms/webhook/twilio         — Twilio delivery receipt webhook
 *   POST   /api/v1/sms/webhook/vonage         — Vonage delivery receipt webhook
 */

import { Router, Request, Response } from 'express';
import {
  sendSms,
  getSmsStatus,
  getSmsLogsForUser,
  isOptedOut,
  recordOptOut,
  removeOptOut,
  updateDeliveryStatus,
  smsTemplates,
} from '../services/smsService';

const router = Router();

// ---------------------------------------------------------------------------
// Send SMS
// ---------------------------------------------------------------------------

/**
 * POST /send
 * Body: { to, userId, templateId?, variables?, body? }
 */
router.post('/send', async (req: Request, res: Response) => {
  const { to, userId, templateId, variables, body } = req.body ?? {};

  if (!to || !userId) {
    return res.status(400).json({ error: 'to and userId are required' });
  }

  // Basic E.164 check
  if (!/^\+[1-9]\d{6,14}$/.test(to)) {
    return res.status(400).json({ error: 'to must be a valid E.164 phone number (e.g. +14155551234)' });
  }

  if (!templateId && !body) {
    return res.status(400).json({ error: 'Either templateId or body must be provided' });
  }

  try {
    const result = await sendSms({ to, userId, templateId, variables, body });

    if (!result.success) {
      const statusCode = result.error?.includes('Rate limit') ? 429
        : result.error?.includes('opted out') ? 403
        : 502;
      return res.status(statusCode).json({ error: result.error, logId: result.logId });
    }

    return res.status(202).json({
      success: true,
      messageId: result.messageId,
      logId: result.logId,
    });
  } catch (err) {
    console.error('[sms route] send error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Delivery status
// ---------------------------------------------------------------------------

/**
 * GET /status/:logId
 */
router.get('/status/:logId', async (req: Request, res: Response) => {
  const logId = parseInt(String(req.params.logId), 10);
  if (isNaN(logId)) return res.status(400).json({ error: 'Invalid logId' });

  try {
    const log = await getSmsStatus(logId);
    if (!log) return res.status(404).json({ error: 'SMS log not found' });

    return res.json({
      id:        log.id,
      to:        log.to,
      status:    log.status,
      messageId: log.messageId,
      provider:  log.provider,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
      error:     log.errorMsg,
    });
  } catch (err) {
    console.error('[sms route] status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// User SMS logs
// ---------------------------------------------------------------------------

/**
 * GET /logs/:userId?limit=50
 */
router.get('/logs/:userId', async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10), 200);

  try {
    const logs = await getSmsLogsForUser(userId, limit);
    return res.json({ userId, count: logs.length, logs });
  } catch (err) {
    console.error('[sms route] logs error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Opt-out (STOP compliance)
// ---------------------------------------------------------------------------

/**
 * POST /optout
 * Body: { phoneNumber, userId? }
 */
router.post('/optout', async (req: Request, res: Response) => {
  const { phoneNumber, userId } = req.body ?? {};
  if (!phoneNumber) return res.status(400).json({ error: 'phoneNumber is required' });

  try {
    await recordOptOut(phoneNumber, userId);
    return res.json({ success: true, message: 'Opt-out recorded. No further SMS will be sent to this number.' });
  } catch (err) {
    console.error('[sms route] optout error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * DELETE /optout/:phone
 * Remove opt-out (re-subscribe via START).
 */
router.delete('/optout/:phone', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(String(req.params.phone));

  try {
    await removeOptOut(phone);
    return res.json({ success: true, message: 'Opt-out removed. SMS messaging re-enabled.' });
  } catch (err) {
    console.error('[sms route] optout remove error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * GET /optout/:phone
 * Check opt-out status.
 */
router.get('/optout/:phone', async (req: Request, res: Response) => {
  const phone = decodeURIComponent(String(req.params.phone));

  try {
    const optedOut = await isOptedOut(phone);
    return res.json({ phoneNumber: phone, optedOut });
  } catch (err) {
    console.error('[sms route] optout check error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Templates list
// ---------------------------------------------------------------------------

/**
 * GET /templates
 */
router.get('/templates', (_req: Request, res: Response) => {
  const templates = Object.values(smsTemplates).map(t => ({ id: t.id, body: t.body }));
  return res.json({ templates });
});

// ---------------------------------------------------------------------------
// Provider webhooks (delivery receipts & inbound replies)
// ---------------------------------------------------------------------------

/**
 * POST /webhook/twilio
 * Twilio delivery status callback.
 */
router.post('/webhook/twilio', async (req: Request, res: Response) => {
  const { MessageSid, MessageStatus, ErrorCode, ErrorMessage, Body, From } = req.body ?? {};

  // Handle STOP / inbound replies
  if (Body && From) {
    const upperBody = String(Body).trim().toUpperCase();
    if (['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'].includes(upperBody)) {
      await recordOptOut(From).catch(console.error);
      console.log(`[sms:webhook] STOP received from ${From}`);
    } else if (['START', 'YES', 'UNSTOP'].includes(upperBody)) {
      await removeOptOut(From).catch(console.error);
      console.log(`[sms:webhook] START received from ${From}`);
    }
  }

  // Handle delivery receipt
  if (MessageSid && MessageStatus) {
    const normalizedStatus = mapTwilioStatus(MessageStatus);
    await updateDeliveryStatus(MessageSid, normalizedStatus, ErrorCode, ErrorMessage)
      .catch(console.error);
  }

  // Twilio expects 200 + empty body (or TwiML)
  return res.status(200).send('<?xml version="1.0" encoding="UTF-8"?><Response></Response>');
});

/**
 * POST /webhook/vonage
 * Vonage delivery receipt / inbound SMS webhook.
 */
router.post('/webhook/vonage', async (req: Request, res: Response) => {
  const { messageId, status, errCode, text, msisdn } = req.body ?? {};

  // Handle inbound STOP
  if (text && msisdn) {
    const upperText = String(text).trim().toUpperCase();
    if (['STOP', 'UNSUBSCRIBE'].includes(upperText)) {
      await recordOptOut(`+${msisdn}`).catch(console.error);
    } else if (['START', 'SUBSCRIBE'].includes(upperText)) {
      await removeOptOut(`+${msisdn}`).catch(console.error);
    }
  }

  // Delivery receipt
  if (messageId && status) {
    const normalizedStatus = mapVonageStatus(status);
    await updateDeliveryStatus(messageId, normalizedStatus, errCode)
      .catch(console.error);
  }

  return res.status(200).json({ success: true });
});

// ---------------------------------------------------------------------------
// Status mappers
// ---------------------------------------------------------------------------

function mapTwilioStatus(status: string): string {
  const map: Record<string, string> = {
    queued: 'queued', sending: 'sent', sent: 'sent',
    delivered: 'delivered', undelivered: 'undelivered',
    failed: 'failed', received: 'received',
  };
  return map[status] ?? status;
}

function mapVonageStatus(status: string): string {
  const map: Record<string, string> = {
    delivered: 'delivered', buffered: 'sent', sent: 'sent',
    failed: 'failed', rejected: 'failed', expired: 'failed',
  };
  return map[status] ?? status;
}

export default router;
