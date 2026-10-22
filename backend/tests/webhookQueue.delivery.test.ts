/**
 * webhookQueue.delivery.test.ts — #1064
 *
 * Focused unit tests for the redactPayload helper exported from webhookQueue.ts.
 *
 * No Redis, BullMQ, or Prisma connections are needed — only the pure helper
 * function is exercised here.
 */

import { redactPayload } from '../src/services/webhookQueue';

// ─── redactPayload ────────────────────────────────────────────────────────────

describe('redactPayload', () => {
  // ── Top-level sensitive keys ────────────────────────────────────────────────

  it('redacts "secret" at top level', () => {
    const input = JSON.stringify({ event: 'payment.executed', secret: 'supersecret123' });
    const output = JSON.parse(redactPayload(input));
    expect(output.secret).toBe('[REDACTED]');
    expect(output.event).toBe('payment.executed');
  });

  it('redacts "token" at top level', () => {
    const input = JSON.stringify({ token: 'eyJhbGciOiJIUzI1NiJ9', amount: '100' });
    const output = JSON.parse(redactPayload(input));
    expect(output.token).toBe('[REDACTED]');
    expect(output.amount).toBe('100');
  });

  it('redacts "password" at top level', () => {
    const input = JSON.stringify({ password: 'p@ssw0rd', user: 'alice' });
    const output = JSON.parse(redactPayload(input));
    expect(output.password).toBe('[REDACTED]');
    expect(output.user).toBe('alice');
  });

  it('redacts "authorization" at top level', () => {
    const input = JSON.stringify({ authorization: 'Bearer abc123', method: 'POST' });
    const output = JSON.parse(redactPayload(input));
    expect(output.authorization).toBe('[REDACTED]');
    expect(output.method).toBe('POST');
  });

  it('redacts "key" at top level', () => {
    const input = JSON.stringify({ key: 'api-key-value', id: 42 });
    const output = JSON.parse(redactPayload(input));
    expect(output.key).toBe('[REDACTED]');
    expect(output.id).toBe(42);
  });

  it('redacts "signature" at top level', () => {
    const input = JSON.stringify({ signature: 'sha256=abc', payload: 'data' });
    const output = JSON.parse(redactPayload(input));
    expect(output.signature).toBe('[REDACTED]');
    expect(output.payload).toBe('data');
  });

  // ── Nested sensitive keys ───────────────────────────────────────────────────

  it('redacts nested sensitive keys in a sub-object', () => {
    const input = JSON.stringify({
      event: 'payment.executed',
      meta: {
        secret: 'nested-secret',
        merchant: 'GMERCH123',
      },
    });
    const output = JSON.parse(redactPayload(input));
    expect(output.meta.secret).toBe('[REDACTED]');
    expect(output.meta.merchant).toBe('GMERCH123');
    expect(output.event).toBe('payment.executed');
  });

  it('redacts deeply nested sensitive keys', () => {
    const input = JSON.stringify({
      outer: {
        inner: {
          deepest: {
            token: 'deep-token',
            value: 'safe',
          },
        },
      },
    });
    const output = JSON.parse(redactPayload(input));
    expect(output.outer.inner.deepest.token).toBe('[REDACTED]');
    expect(output.outer.inner.deepest.value).toBe('safe');
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const input = JSON.stringify({
      items: [
        { id: 1, secret: 'abc' },
        { id: 2, secret: 'def' },
      ],
    });
    const output = JSON.parse(redactPayload(input));
    expect(output.items[0].secret).toBe('[REDACTED]');
    expect(output.items[1].secret).toBe('[REDACTED]');
    expect(output.items[0].id).toBe(1);
    expect(output.items[1].id).toBe(2);
  });

  // ── Case-insensitive matching ───────────────────────────────────────────────

  it('redacts "SECRET" (uppercase)', () => {
    const input = JSON.stringify({ SECRET: 'value', event: 'test' });
    const output = JSON.parse(redactPayload(input));
    expect(output.SECRET).toBe('[REDACTED]');
  });

  it('redacts "Token" (mixed case)', () => {
    const input = JSON.stringify({ Token: 'bearer-xyz', event: 'test' });
    const output = JSON.parse(redactPayload(input));
    expect(output.Token).toBe('[REDACTED]');
  });

  it('redacts "AUTHORIZATION" (all caps)', () => {
    const input = JSON.stringify({ AUTHORIZATION: 'Basic abc', path: '/api' });
    const output = JSON.parse(redactPayload(input));
    expect(output.AUTHORIZATION).toBe('[REDACTED]');
  });

  it('redacts "Password" (title case)', () => {
    const input = JSON.stringify({ Password: 'hunter2', username: 'bob' });
    const output = JSON.parse(redactPayload(input));
    expect(output.Password).toBe('[REDACTED]');
  });

  // ── Passthrough for non-sensitive payloads ──────────────────────────────────

  it('returns the payload unchanged when no sensitive keys are present', () => {
    const input = JSON.stringify({
      event: 'payment.executed',
      subscriber: 'GSUB123',
      merchant: 'GMERCH456',
      amount: '1000',
      timestamp: 1700000000,
    });
    const output = JSON.parse(redactPayload(input));
    expect(output).toEqual(JSON.parse(input));
  });

  it('preserves numeric, boolean, and null values for non-sensitive keys', () => {
    const input = JSON.stringify({
      count: 42,
      active: true,
      note: null,
      tags: ['a', 'b'],
    });
    const output = JSON.parse(redactPayload(input));
    expect(output.count).toBe(42);
    expect(output.active).toBe(true);
    expect(output.note).toBeNull();
    expect(output.tags).toEqual(['a', 'b']);
  });

  // ── Invalid JSON fallback ───────────────────────────────────────────────────

  it('returns the original string unchanged when input is not valid JSON', () => {
    const notJson = 'this is not json {broken';
    const result = redactPayload(notJson);
    expect(result).toBe(notJson);
  });

  it('returns empty string unchanged', () => {
    expect(redactPayload('')).toBe('');
  });

  it('returns a plain string (not JSON object) unchanged', () => {
    // JSON.parse('hello') throws; the function should return 'hello' as-is
    expect(redactPayload('hello')).toBe('hello');
  });
});
