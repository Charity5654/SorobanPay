/**
 * backend/tests/telemetryRedaction.test.ts
 *
 * TEST-1134 — Telemetry & Logging Redaction Tests
 *
 * Acceptance criteria:
 *  - Verifies public keys / Stellar addresses are masked (prefix...suffix)
 *  - Verifies secret seeds (S...) and private tokens are masked ([REDACTED])
 *  - Verifies deep nested objects and arrays in telemetry payloads are redacted
 *  - Verifies non-sensitive fields (timestamps, event types, amounts) remain intact
 *  - Verifies boundary edge cases: null, empty string, short strings, undefined
 */

import {
  redactAddress,
  redactSecret,
  redactTelemetryPayload,
} from '../src/lib/logger';

describe('Telemetry Redaction Suite', () => {
  describe('redactAddress', () => {
    it('redacts valid Stellar public addresses to first 8 and last 8 characters', () => {
      const address = 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456';
      const redacted = redactAddress(address);
      expect(redacted).toBe('GABC1234...EF123456');
      expect(redacted).not.toContain('ABCDEF1234567890');
    });

    it('returns short addresses or empty strings untouched without crashing', () => {
      expect(redactAddress('')).toBe('');
      expect(redactAddress('short')).toBe('short');
      expect(redactAddress('1234567890123456')).toBe('1234567890123456');
    });
  });

  describe('redactSecret', () => {
    it('redacts 56-character Stellar secret seeds beginning with S', () => {
      const secretSeed = 'SBWZ5U22PZ3VCS536S267K5SOWGB6HYI65A5L2P2Z5FVMNYMFR3LJJ34';
      const redacted = redactSecret(secretSeed);
      expect(redacted).toBe('SBWZ...[REDACTED_SEED]');
      expect(redacted).not.toContain('PZ3VCS536S267K5SOWGB');
    });

    it('masks arbitrary private secrets and api tokens', () => {
      const token = 'sk_live_99887766554433221100';
      const redacted = redactSecret(token);
      expect(redacted).toBe('sk_l...[REDACTED]');
    });

    it('handles empty or very short strings safely', () => {
      expect(redactSecret('')).toBe('');
      expect(redactSecret('abc')).toBe('[REDACTED]');
    });
  });

  describe('redactTelemetryPayload', () => {
    it('recursively redacts nested objects with sensitive fields and addresses', () => {
      const telemetryEvent = {
        eventName: 'subscription.created',
        timestamp: '2026-09-27T10:00:00Z',
        merchantAddress: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456',
        auth: {
          token: 'jwt.token.secret.here',
          apiKey: 'pk_secret_123456789',
        },
        metadata: {
          amount: '50.00',
          seed: 'SBWZ5U22PZ3VCS536S267K5SOWGB6HYI65A5L2P2Z5FVMNYMFR3LJJ34',
        },
      };

      const sanitized = redactTelemetryPayload(telemetryEvent);

      expect(sanitized.eventName).toBe('subscription.created');
      expect(sanitized.timestamp).toBe('2026-09-27T10:00:00Z');
      expect(sanitized.merchantAddress).toBe('GABC1234...EF123456');
      expect(sanitized.auth.token).toBe('[REDACTED]');
      expect(sanitized.auth.apiKey).toBe('[REDACTED]');
      expect(sanitized.metadata.amount).toBe('50.00');
      expect(sanitized.metadata.seed).toBe('[REDACTED]');
    });

    it('redacts sensitive items inside arrays', () => {
      const payload = {
        recipients: [
          { address: 'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456' },
          { secret: 'verysecretpassword' },
        ],
      };

      const sanitized = redactTelemetryPayload(payload);
      expect(sanitized.recipients[0].address).toBe('GABC1234...EF123456');
      expect(sanitized.recipients[1].secret).toBe('[REDACTED]');
    });

    it('boundary: handles null, undefined, primitives and circular-free objects', () => {
      expect(redactTelemetryPayload(null)).toBeNull();
      expect(redactTelemetryPayload(undefined)).toBeUndefined();
      expect(redactTelemetryPayload(42)).toBe(42);
      expect(redactTelemetryPayload('normal text')).toBe('normal text');
    });
  });
});
