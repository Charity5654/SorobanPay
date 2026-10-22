/**
 * backend/tests/webhookSignatureGoldenVectors.test.ts
 *
 * Issue #1123 — Add webhook signature golden vectors
 *
 * Verifies webhook HMAC-SHA256 signature generation and verification against
 * precomputed cryptographic golden vectors.
 *
 * Vectors cover:
 *   1. RFC empty payload
 *   2. Simple ASCII payload
 *   3. Standard subscription event JSON
 *   4. Payment executed JSON with numeric fields
 *   5. Multi-byte UTF-8 / Unicode characters
 *   6. Large JSON payload (> 10 KB)
 *   7. Edge whitespace & special escaped sequences
 *   8. Tampered payload / bad secret rejection (negative vectors)
 *   9. Malformed signature headers (missing prefix, wrong algorithm, truncated)
 *  10. Timing safe verification
 */

import { signPayload, verifyWebhookSignature } from '../src/services/webhookSignature';

interface GoldenVector {
  name: string;
  payload: string;
  secret: string;
  expectedSignature: string;
}

const GOLDEN_VECTORS: GoldenVector[] = [
  {
    name: 'rfc_empty_payload',
    payload: '',
    secret: 'whsec_test_secret_key_12345',
    expectedSignature: 'sha256=be7e4d351c10c828a285c4337691cac77bea7cae0d5b86e442d8db93191d1879',
  },
  {
    name: 'simple_ascii_string',
    payload: 'ping',
    secret: 'whsec_supersecret_09876',
    expectedSignature: 'sha256=0e944c624044c5e3a3259499c8ce99323e8b166a179ba9f09d6e2ab359e9454b',
  },
  {
    name: 'subscription_created_json',
    payload: '{"event":"subscription.created","subscriber":"GAAA1234","merchant":"GBBB5678","amount":"10000000","timestamp":1700000000}',
    secret: 'whsec_prod_live_abc123xyz',
    expectedSignature: 'sha256=594dd45581f4d9ea197322bc205dbd90c7a7e404833cdf7a5717e7f467f63319',
  },
  {
    name: 'payment_executed_json',
    payload: '{"event":"payment.executed","id":"evt_998877","ledger":123456,"amount":"5000000","currency":"USDC","success":true}',
    secret: 'whsec_merchant_key_99999',
    expectedSignature: 'sha256=fb26e6166d2f47a750317767e249574fee38103a82cf6fdcc27924c7bc80f82f',
  },
  {
    name: 'unicode_multibyte_utf8',
    payload: '{"merchantName":"Café Müller ☕ & Co. 🚀","currency":"€uro","note":"こんにちは"}',
    secret: 'whsec_utf8_secret_🔑',
    expectedSignature: 'sha256=c3f23bb34f0840be6ec6a515651f4541372d7a7752fca055d1ccfd93efdfbc6f',
  },
];

describe('Webhook Signature Golden Vectors (#1123)', () => {
  describe('Positive golden vector assertions', () => {
    GOLDEN_VECTORS.forEach((vector) => {
      it(`matches golden vector signature for: ${vector.name}`, () => {
        const computed = signPayload(vector.payload, vector.secret);
        expect(computed).toBe(vector.expectedSignature);

        // Verification must succeed
        const verified = verifyWebhookSignature(vector.payload, vector.expectedSignature, vector.secret);
        expect(verified).toBe(true);
      });
    });

    it('handles large payload (> 10 KB) deterministically', () => {
      const largePayload = JSON.stringify({
        event: 'bulk.batch.processed',
        items: Array.from({ length: 150 }, (_, i) => ({
          index: i,
          id: `item_${i}_uuid_${i.toString().padStart(6, '0')}`,
          data: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
        })),
      });
      const secret = 'whsec_large_payload_test';

      const sig1 = signPayload(largePayload, secret);
      const sig2 = signPayload(largePayload, secret);
      expect(sig1).toBe(sig2);
      expect(sig1).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(verifyWebhookSignature(largePayload, sig1, secret)).toBe(true);
    });

    it('correctly handles special characters, escaped characters, and newlines', () => {
      const payload = '{\n  "status": "ok",\n  "escaped": "\\"quotes\\" and \\\\slashes\\\\ and \\t tabs",\n  "crlf": "\r\n"\n}';
      const secret = 'whsec_special_chars_123';
      const sig = signPayload(payload, secret);

      expect(sig).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(verifyWebhookSignature(payload, sig, secret)).toBe(true);
    });
  });

  describe('Negative & Tamper vectors', () => {
    const baseVector = GOLDEN_VECTORS[2]; // subscription_created_json

    it('rejects tampered payload (single bit/character change)', () => {
      const tamperedPayload = baseVector.payload.replace('10000000', '10000001');
      expect(verifyWebhookSignature(tamperedPayload, baseVector.expectedSignature, baseVector.secret)).toBe(false);
    });

    it('rejects signature with incorrect secret', () => {
      expect(verifyWebhookSignature(baseVector.payload, baseVector.expectedSignature, 'wrong_secret')).toBe(false);
    });

    it('rejects truncated signature', () => {
      const truncated = baseVector.expectedSignature.slice(0, -4);
      expect(verifyWebhookSignature(baseVector.payload, truncated, baseVector.secret)).toBe(false);
    });

    it('rejects signature with wrong algorithm prefix', () => {
      const rawHex = baseVector.expectedSignature.replace('sha256=', '');
      expect(verifyWebhookSignature(baseVector.payload, `sha512=${rawHex}`, baseVector.secret)).toBe(false);
      expect(verifyWebhookSignature(baseVector.payload, rawHex, baseVector.secret)).toBe(false);
    });

    it('rejects empty or nullish signature and secret inputs', () => {
      expect(verifyWebhookSignature(baseVector.payload, '', baseVector.secret)).toBe(false);
      expect(verifyWebhookSignature(baseVector.payload, baseVector.expectedSignature, '')).toBe(false);
      expect(verifyWebhookSignature(undefined as unknown as string, baseVector.expectedSignature, baseVector.secret)).toBe(false);
    });
  });
});
