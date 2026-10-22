/**
 * #732 — SMS notification service.
 *
 * Features:
 *   - Twilio and Vonage provider support (pluggable via SMS_PROVIDER env)
 *   - SMS templates with variable substitution
 *   - Delivery status tracking (persisted in SmsLog)
 *   - Rate limiting: max 5 SMS per user per hour
 *   - STOP / unsubscribe compliance (opt-out stored in SmsOptOut)
 *   - Inbound webhook handler for delivery receipts and STOP replies
 *
 * Environment variables:
 *   SMS_PROVIDER          — "twilio" | "vonage" (default: "twilio")
 *   SMS_DRY_RUN           — "true" to log only, not send (default: true)
 *   TWILIO_ACCOUNT_SID    — Twilio account SID
 *   TWILIO_AUTH_TOKEN     — Twilio auth token
 *   TWILIO_FROM_NUMBER    — E.164 sender number or messaging service SID
 *   VONAGE_API_KEY        — Vonage API key
 *   VONAGE_API_SECRET     — Vonage API secret
 *   VONAGE_FROM_NUMBER    — Vonage sender number / name
 */

import https from 'https';
import prisma from '../lib/prisma';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SmsProvider = 'twilio' | 'vonage';

export interface SmsTemplate {
  id: string;
  body: string; // Use {{variableName}} placeholders
}

export interface SendSmsOptions {
  to: string;       // E.164 phone number e.g. +14155551234
  userId: string;   // Internal user identifier
  templateId?: string;
  variables?: Record<string, string>;
  body?: string;    // Used when no template specified
}

export interface SmsResult {
  success: boolean;
  messageId?: string;
  error?: string;
  logId: number;
}

// ---------------------------------------------------------------------------
// Built-in templates
// ---------------------------------------------------------------------------

const TEMPLATES: Record<string, SmsTemplate> = {
  payment_success: {
    id: 'payment_success',
    body: 'SorobanPay: Your payment of {{amount}} {{token}} to {{merchant}} was successful. Ref: {{txHash}}',
  },
  payment_failure: {
    id: 'payment_failure',
    body: 'SorobanPay: Your payment of {{amount}} {{token}} to {{merchant}} failed. Please ensure sufficient balance. Reply STOP to opt out.',
  },
  subscription_created: {
    id: 'subscription_created',
    body: 'SorobanPay: Subscription created with {{merchant}} for {{amount}} {{token}} every {{interval}}. Reply STOP to opt out.',
  },
  subscription_cancelled: {
    id: 'subscription_cancelled',
    body: 'SorobanPay: Your subscription with {{merchant}} has been cancelled. No further charges will be made.',
  },
  payment_due_reminder: {
    id: 'payment_due_reminder',
    body: 'SorobanPay: Payment reminder — {{amount}} {{token}} due to {{merchant}} in 24 hours. Ensure your wallet has sufficient balance.',
  },
};

// ---------------------------------------------------------------------------
// Template engine
// ---------------------------------------------------------------------------

/**
 * Substitute {{variable}} placeholders in a template body.
 */
function renderTemplate(body: string, variables: Record<string, string> = {}): string {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => variables[key] ?? `{{${key}}}`);
}

// ---------------------------------------------------------------------------
// Rate limiter (in-memory, per-userId, sliding window)
// ---------------------------------------------------------------------------

const rateLimitMap = new Map<string, number[]>(); // userId → timestamps

const RATE_LIMIT_MAX = 5;           // max SMS per window
const RATE_LIMIT_WINDOW_MS = 3600_000; // 1 hour in ms

/**
 * Returns true if the user is within rate limit, false if exceeded.
 * Side-effect: records the timestamp if allowed.
 */
function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const windowStart = now - RATE_LIMIT_WINDOW_MS;

  const times = (rateLimitMap.get(userId) ?? []).filter(t => t > windowStart);

  if (times.length >= RATE_LIMIT_MAX) {
    return false; // exceeded
  }

  times.push(now);
  rateLimitMap.set(userId, times);
  return true;
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function sendViaTwilio(to: string, body: string): Promise<{ messageId: string }> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? '';
  const authToken  = process.env.TWILIO_AUTH_TOKEN ?? '';
  const from       = process.env.TWILIO_FROM_NUMBER ?? '';

  const payload = new URLSearchParams({
    To:   to,
    From: from,
    Body: body,
  }).toString();

  return new Promise((resolve, reject) => {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const options = {
      hostname: 'api.twilio.com',
      path:     `/2010-04-01/Accounts/${accountSid}/Messages.json`,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Authorization':  `Basic ${auth}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.sid) {
            resolve({ messageId: parsed.sid });
          } else {
            reject(new Error(parsed.message ?? 'Twilio error'));
          }
        } catch {
          reject(new Error('Failed to parse Twilio response'));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

async function sendViaVonage(to: string, body: string): Promise<{ messageId: string }> {
  const apiKey    = process.env.VONAGE_API_KEY ?? '';
  const apiSecret = process.env.VONAGE_API_SECRET ?? '';
  const from      = process.env.VONAGE_FROM_NUMBER ?? 'SorobanPay';

  const payload = JSON.stringify({ from, to, text: body, api_key: apiKey, api_secret: apiSecret });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'rest.nexmo.com',
      path:     '/sms/json',
      method:   'POST',
      headers:  {
        'Content-Type':   'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const msg = parsed.messages?.[0];
          if (msg?.status === '0') {
            resolve({ messageId: msg['message-id'] });
          } else {
            reject(new Error(msg?.['error-text'] ?? 'Vonage error'));
          }
        } catch {
          reject(new Error('Failed to parse Vonage response'));
        }
      });
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Opt-out helpers
// ---------------------------------------------------------------------------

/**
 * Check if a phone number has opted out.
 */
export async function isOptedOut(phoneNumber: string): Promise<boolean> {
  const record = await prisma.smsOptOut.findUnique({ where: { phoneNumber } });
  return record !== null;
}

/**
 * Record a STOP / opt-out for a phone number. Idempotent.
 */
export async function recordOptOut(phoneNumber: string, userId?: string): Promise<void> {
  await prisma.smsOptOut.upsert({
    where: { phoneNumber },
    create: { phoneNumber, userId: userId ?? null },
    update: {},
  });
  console.log(`[sms] Opt-out recorded for ${phoneNumber}`);
}

/**
 * Remove opt-out (START command).
 */
export async function removeOptOut(phoneNumber: string): Promise<void> {
  await prisma.smsOptOut.deleteMany({ where: { phoneNumber } });
  console.log(`[sms] Opt-out removed for ${phoneNumber}`);
}

// ---------------------------------------------------------------------------
// Core send function
// ---------------------------------------------------------------------------

const isDryRun = () => process.env.SMS_DRY_RUN !== 'false';
const getProvider = (): SmsProvider =>
  (process.env.SMS_PROVIDER as SmsProvider) ?? 'twilio';

/**
 * Send an SMS message, respecting opt-outs and rate limits.
 */
export async function sendSms(options: SendSmsOptions): Promise<SmsResult> {
  const { to, userId, templateId, variables = {}, body: rawBody } = options;

  // --- Resolve body from template or raw body
  let body: string;
  if (templateId) {
    const tpl = TEMPLATES[templateId];
    if (!tpl) {
      return { success: false, error: `Unknown template: ${templateId}`, logId: -1 };
    }
    body = renderTemplate(tpl.body, variables);
  } else if (rawBody) {
    body = rawBody;
  } else {
    return { success: false, error: 'Either templateId or body must be provided', logId: -1 };
  }

  const provider = getProvider();

  // --- Opt-out check (STOP compliance)
  const optedOut = await isOptedOut(to);
  if (optedOut) {
    console.log(`[sms] Skipping opted-out number: ${to}`);
    const log = await prisma.smsLog.create({
      data: {
        to, body, templateId: templateId ?? null,
        variables: JSON.stringify(variables), provider, userId,
        status: 'blocked', errorMsg: 'Recipient has opted out',
      },
    });
    return { success: false, error: 'Recipient has opted out (STOP)', logId: log.id };
  }

  // --- Rate limit check
  if (!checkRateLimit(userId)) {
    const log = await prisma.smsLog.create({
      data: {
        to, body, templateId: templateId ?? null,
        variables: JSON.stringify(variables), provider, userId,
        status: 'rate_limited', errorMsg: 'Rate limit exceeded (5/hr)',
      },
    });
    console.warn(`[sms] Rate limit exceeded for userId=${userId}`);
    return { success: false, error: 'Rate limit exceeded: max 5 SMS per hour per user', logId: log.id };
  }

  // --- Create log entry (pending)
  const log = await prisma.smsLog.create({
    data: {
      to, body, templateId: templateId ?? null,
      variables: JSON.stringify(variables), provider, userId,
      status: 'queued',
    },
  });

  // --- Dry-run mode
  if (isDryRun()) {
    console.log(`[sms:dry-run] To: ${to} | Template: ${templateId ?? 'custom'} | Body: ${body}`);
    await prisma.smsLog.update({ where: { id: log.id }, data: { status: 'sent', messageId: 'dry-run' } });
    return { success: true, messageId: 'dry-run', logId: log.id };
  }

  // --- Send via provider
  try {
    let result: { messageId: string };

    if (provider === 'twilio') {
      result = await sendViaTwilio(to, body);
    } else {
      result = await sendViaVonage(to, body);
    }

    await prisma.smsLog.update({
      where: { id: log.id },
      data: { status: 'sent', messageId: result.messageId },
    });

    return { success: true, messageId: result.messageId, logId: log.id };
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    await prisma.smsLog.update({
      where: { id: log.id },
      data: { status: 'failed', errorMsg },
    });
    console.error(`[sms] Send failed for ${to}:`, errorMsg);
    return { success: false, error: errorMsg, logId: log.id };
  }
}

// ---------------------------------------------------------------------------
// Delivery status update (called by webhook)
// ---------------------------------------------------------------------------

/**
 * Update delivery status from provider webhook callback.
 */
export async function updateDeliveryStatus(
  messageId: string,
  status: string,
  errorCode?: string,
  errorMsg?: string,
): Promise<void> {
  await prisma.smsLog.updateMany({
    where: { messageId },
    data: { status, errorCode: errorCode ?? null, errorMsg: errorMsg ?? null },
  });
  console.log(`[sms] Delivery status updated: ${messageId} → ${status}`);
}

// ---------------------------------------------------------------------------
// Query helpers
// ---------------------------------------------------------------------------

/**
 * Get delivery status for a message log by id.
 */
export async function getSmsStatus(logId: number) {
  return prisma.smsLog.findUnique({ where: { id: logId } });
}

/**
 * Get all SMS logs for a user.
 */
export async function getSmsLogsForUser(userId: string, limit = 50) {
  return prisma.smsLog.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

// ---------------------------------------------------------------------------
// Bulk payment event helpers
// ---------------------------------------------------------------------------

export async function sendPaymentSuccessSms(
  userId: string, to: string,
  amount: string, token: string, merchant: string, txHash: string,
): Promise<SmsResult> {
  return sendSms({ to, userId, templateId: 'payment_success', variables: { amount, token, merchant, txHash } });
}

export async function sendPaymentFailureSms(
  userId: string, to: string,
  amount: string, token: string, merchant: string,
): Promise<SmsResult> {
  return sendSms({ to, userId, templateId: 'payment_failure', variables: { amount, token, merchant } });
}

export async function sendSubscriptionCreatedSms(
  userId: string, to: string,
  merchant: string, amount: string, token: string, interval: string,
): Promise<SmsResult> {
  return sendSms({ to, userId, templateId: 'subscription_created', variables: { merchant, amount, token, interval } });
}

export async function sendSubscriptionCancelledSms(
  userId: string, to: string,
  merchant: string,
): Promise<SmsResult> {
  return sendSms({ to, userId, templateId: 'subscription_cancelled', variables: { merchant } });
}

export { TEMPLATES as smsTemplates };
