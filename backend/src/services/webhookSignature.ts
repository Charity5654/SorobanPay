/**
 * backend/src/services/webhookSignature.ts
 *
 * HMAC-SHA256 signature generation and verification for webhook deliveries.
 */

import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Generate the HMAC-SHA256 signature for a webhook payload body.
 * Merchants can verify this signature using their endpoint secret.
 *
 * Signature format: "sha256=<hex_digest>"
 */
export function signPayload(body: string, secret: string): string {
  const hmac = createHmac('sha256', secret).update(body).digest('hex');
  return `sha256=${hmac}`;
}

/**
 * Verify a webhook HMAC-SHA256 signature header using timing-safe comparison.
 *
 * @param body The raw request body string
 * @param signatureHeader The signature header value, e.g. "sha256=<hex_digest>"
 * @param secret The webhook endpoint signing secret
 * @returns true if the signature is valid, false otherwise
 */
export function verifyWebhookSignature(body: string, signatureHeader: string, secret: string): boolean {
  if (!signatureHeader || !secret || typeof body !== 'string') return false;
  const expected = signPayload(body, secret);
  if (expected.length !== signatureHeader.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signatureHeader, 'utf-8'), Buffer.from(expected, 'utf-8'));
  } catch {
    return false;
  }
}
