/**
 * BE-68 — Payment failure & lifecycle email notification service.
 *
 * Configuration (environment variables):
 *   SMTP_HOST          — SMTP server hostname (e.g. smtp.sendgrid.net)
 *   SMTP_PORT          — SMTP port, default 587
 *   SMTP_USER          — SMTP authentication username
 *   SMTP_PASS          — SMTP authentication password
 *   SMTP_FROM          — Sender address (default noreply@sorobanpay.com)
 *   EMAIL_DRY_RUN=true — Log emails to console instead of sending (default true)
 *   API_BASE_URL       — Base URL for unsubscribe links (default http://localhost:3001)
 */

import nodemailer from 'nodemailer';
import prisma from '../lib/prisma';

// ---------------------------------------------------------------------------
// Transporter
// ---------------------------------------------------------------------------

function buildTransporter() {
  if (process.env.EMAIL_DRY_RUN !== 'false') {
    // Dry-run: use a "preview" transport that logs to console
    return null;
  }

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST ?? 'localhost',
    port: parseInt(process.env.SMTP_PORT ?? '587', 10),
    secure: parseInt(process.env.SMTP_PORT ?? '587', 10) === 465,
    auth:
      process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
  });
}

const FROM = process.env.SMTP_FROM ?? 'noreply@sorobanpay.com';
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3001';
const isDryRun = () => process.env.EMAIL_DRY_RUN !== 'false';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function unsubscribeUrl(token: string): string {
  return `${API_BASE_URL}/api/v1/notifications/unsubscribe?token=${encodeURIComponent(token)}`;
}

function unsubscribeFooter(unsubToken: string): string {
  return `
    <p style="font-size:12px;color:#888;margin-top:32px;border-top:1px solid #eee;padding-top:12px;">
      You are receiving this email because you have a SorobanPay subscription.<br>
      To stop receiving emails, 
      <a href="${unsubscribeUrl(unsubToken)}" style="color:#888;">unsubscribe here</a>.
    </p>
  `;
}

async function getUnsubToken(email: string): Promise<string> {
  const pref = await prisma.notificationPreference.upsert({
    where: { email },
    create: { email },
    update: {},
  });
  return pref.unsubToken;
}

async function isEmailEnabled(email: string): Promise<boolean> {
  const pref = await prisma.notificationPreference.findUnique({ where: { email } });
  // No preference record = default enabled
  return pref?.emailEnabled ?? true;
}

/**
 * Send an email or log it in dry-run mode.
 * Silently skips if the recipient has opted out.
 */
async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  // Opt-out check
  const enabled = await isEmailEnabled(opts.to).catch(() => true);
  if (!enabled) {
    console.log(`[email] Skipping opted-out recipient: ${opts.to}`);
    return;
  }

  const unsubToken = await getUnsubToken(opts.to).catch(() => 'unknown');
  const fullHtml = opts.html + unsubscribeFooter(unsubToken);

  const mailOptions = {
    from: FROM,
    to: opts.to,
    subject: opts.subject,
    html: fullHtml,
  };

  if (isDryRun()) {
    console.log(
      `[email:dry-run] To: ${opts.to} | Subject: ${opts.subject}\n` +
        `[email:dry-run] Body preview: ${opts.html.substring(0, 200).replace(/<[^>]+>/g, '')}...`,
    );
    return;
  }

  const transporter = buildTransporter();
  if (!transporter) return;

  await transporter.sendMail(mailOptions);
}

// ---------------------------------------------------------------------------
// Email templates
// ---------------------------------------------------------------------------

function paymentFailureHtml(subscriber: string, merchant: string, amount: string, token: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#e53e3e;">⚠️ Payment Failed</h2>
      <p>Your scheduled payment to <strong>${merchant}</strong> could not be processed.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0;">
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>Subscriber</strong></td><td style="padding:8px;border:1px solid #eee;">${subscriber}</td></tr>
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>Merchant</strong></td><td style="padding:8px;border:1px solid #eee;">${merchant}</td></tr>
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #eee;">${amount}</td></tr>
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>Token</strong></td><td style="padding:8px;border:1px solid #eee;">${token}</td></tr>
      </table>
      <p><strong>Reason:</strong> Insufficient balance in the subscriber's wallet.</p>
      <p>Please ensure your wallet has sufficient funds and the token allowance is active. 
         The payment will be retried on the next scheduled cycle.</p>
    </div>
  `;
}

function merchantPaymentFailureHtml(subscriber: string, merchant: string, amount: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#e53e3e;">⚠️ Subscriber Payment Failed</h2>
      <p>A scheduled payment from one of your subscribers could not be collected.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0;">
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>Subscriber</strong></td><td style="padding:8px;border:1px solid #eee;">${subscriber}</td></tr>
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>Expected Amount</strong></td><td style="padding:8px;border:1px solid #eee;">${amount}</td></tr>
      </table>
      <p>The subscriber's subscription remains active. The payment will be retried on the next cycle.</p>
    </div>
  `;
}

function paymentSuccessHtml(subscriber: string, merchant: string, amount: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#38a169;">✅ Payment Successful</h2>
      <p>Your payment to <strong>${merchant}</strong> was processed successfully.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0;">
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>To</strong></td><td style="padding:8px;border:1px solid #eee;">${merchant}</td></tr>
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>Amount</strong></td><td style="padding:8px;border:1px solid #eee;">${amount}</td></tr>
      </table>
    </div>
  `;
}

function cancellationHtml(subscriber: string, merchant: string): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
      <h2 style="color:#718096;">📋 Subscription Cancelled</h2>
      <p>Your subscription to <strong>${merchant}</strong> has been cancelled.</p>
      <table style="border-collapse:collapse;width:100%;margin:16px 0;">
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>Subscriber</strong></td><td style="padding:8px;border:1px solid #eee;">${subscriber}</td></tr>
        <tr><td style="padding:8px;border:1px solid #eee;"><strong>Merchant</strong></td><td style="padding:8px;border:1px solid #eee;">${merchant}</td></tr>
      </table>
      <p>No further payments will be collected. Thank you for using SorobanPay.</p>
    </div>
  `;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Send payment failure email to subscriber (and merchant if email registered).
 */
export async function sendPaymentFailureEmail(
  subscriber: string,
  merchant: string,
  amount: string,
  token: string,
): Promise<void> {
  const subPref = await prisma.notificationPreference.findFirst({
    where: { subscriber },
  });
  const merchantPref = await prisma.notificationPreference.findFirst({
    where: { merchant },
  });

  const tasks: Promise<void>[] = [];

  if (subPref?.email) {
    tasks.push(
      sendEmail({
        to: subPref.email,
        subject: '⚠️ SorobanPay: Your payment failed',
        html: paymentFailureHtml(subscriber, merchant, amount, token),
      }),
    );
  }

  if (merchantPref?.email) {
    tasks.push(
      sendEmail({
        to: merchantPref.email,
        subject: '⚠️ SorobanPay: Subscriber payment failed',
        html: merchantPaymentFailureHtml(subscriber, merchant, amount),
      }),
    );
  }

  await Promise.all(tasks);
}

/**
 * Send payment success receipt email (optional).
 */
export async function sendPaymentSuccessEmail(
  subscriber: string,
  merchant: string,
  amount: string,
): Promise<void> {
  const subPref = await prisma.notificationPreference.findFirst({
    where: { subscriber },
  });

  if (subPref?.email) {
    await sendEmail({
      to: subPref.email,
      subject: '✅ SorobanPay: Payment successful',
      html: paymentSuccessHtml(subscriber, merchant, amount),
    });
  }
}

/**
 * Send cancellation confirmation email.
 */
export async function sendCancellationEmail(
  subscriber: string,
  merchant: string,
): Promise<void> {
  const subPref = await prisma.notificationPreference.findFirst({
    where: { subscriber },
  });

  if (subPref?.email) {
    await sendEmail({
      to: subPref.email,
      subject: '📋 SorobanPay: Subscription cancelled',
      html: cancellationHtml(subscriber, merchant),
    });
  }
}
