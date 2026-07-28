/**
 * utils.test.ts
 *
 * Unit tests for frontend utility functions:
 *   - address truncation (truncateAddress)
 *   - stroop ↔ token unit conversion (stroopsToTokens, tokensToStroops)
 *   - event type decoding (decodeEventType)
 *
 * Issue #433 – Frontend unit tests with Jest and RTL
 */

// ── Helpers defined inline (matching what you'd add to src/lib/utils.ts) ────
// These are tested as pure functions; the actual module is src/lib/utils.ts

import {
  truncateAddress,
  stroopsToTokens,
  tokensToStroops,
  decodeEventType,
  formatInterval,
} from '@/lib/utils';

// ── truncateAddress ────────────────────────────────────────────────────────

describe('truncateAddress', () => {
  const fullAddress = 'GABC123DEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUVWX';

  it('returns the first 4 and last 4 chars separated by …', () => {
    expect(truncateAddress(fullAddress)).toBe('GABC…UVWX');
  });

  it('respects a custom prefix/suffix length', () => {
    expect(truncateAddress(fullAddress, 6)).toBe('GABC12…STUVWX');
  });

  it('returns the full address unchanged when shorter than 2 * len', () => {
    expect(truncateAddress('SHORT', 10)).toBe('SHORT');
  });

  it('returns empty string for empty input', () => {
    expect(truncateAddress('')).toBe('');
  });
});

// ── stroopsToTokens / tokensToStroops ─────────────────────────────────────

describe('stroopsToTokens', () => {
  it('converts 1 stroop to 0.0000001 tokens (7 decimal places)', () => {
    expect(stroopsToTokens(1n)).toBe('0.0000001');
  });

  it('converts 10_000_000 stroops to exactly 1 token', () => {
    expect(stroopsToTokens(10_000_000n)).toBe('1.0000000');
  });

  it('converts 100_000_000 stroops to 10 tokens', () => {
    expect(stroopsToTokens(100_000_000n)).toBe('10.0000000');
  });

  it('handles 0 stroops', () => {
    expect(stroopsToTokens(0n)).toBe('0.0000000');
  });

  it('handles large values without precision loss', () => {
    expect(stroopsToTokens(1_000_000_000_000n)).toBe('100000.0000000');
  });
});

describe('tokensToStroops', () => {
  it('converts 1 token to 10_000_000 stroops', () => {
    expect(tokensToStroops(1)).toBe(10_000_000n);
  });

  it('converts 0 tokens to 0 stroops', () => {
    expect(tokensToStroops(0)).toBe(0n);
  });

  it('converts 100 tokens to 1_000_000_000 stroops', () => {
    expect(tokensToStroops(100)).toBe(1_000_000_000n);
  });

  it('round-trips through stroopsToTokens', () => {
    const tokens = 42;
    const stroops = tokensToStroops(tokens);
    expect(stroopsToTokens(stroops)).toBe('42.0000000');
  });
});

// ── decodeEventType ────────────────────────────────────────────────────────

describe('decodeEventType', () => {
  it('returns "subscribe" for the subscribe event symbol', () => {
    expect(decodeEventType('subscribe')).toBe('subscribe');
  });

  it('returns "executed" for the executed event symbol', () => {
    expect(decodeEventType('executed')).toBe('executed');
  });

  it('returns "cancel" for the cancel event symbol', () => {
    expect(decodeEventType('cancel')).toBe('cancel');
  });

  it('returns "payment_transfer_failure" for that event symbol', () => {
    expect(decodeEventType('payment_transfer_failure')).toBe('payment_transfer_failure');
  });

  it('returns "unknown" for an unrecognised event type', () => {
    expect(decodeEventType('something_else')).toBe('unknown');
  });

  it('is case-sensitive — "Subscribe" is not a known type', () => {
    expect(decodeEventType('Subscribe')).toBe('unknown');
  });
});

// ── formatInterval ─────────────────────────────────────────────────────────

describe('formatInterval', () => {
  it('formats 86400 seconds as "1 day"', () => {
    expect(formatInterval(86400)).toBe('1 day');
  });

  it('formats 172800 seconds as "2 days"', () => {
    expect(formatInterval(172800)).toBe('2 days');
  });

  it('formats 2592000 seconds as "30 days"', () => {
    expect(formatInterval(2592000)).toBe('30 days');
  });

  it('formats 31536000 seconds as "365 days"', () => {
    expect(formatInterval(31536000)).toBe('365 days');
  });

  it('formats sub-day values as raw seconds', () => {
    expect(formatInterval(3600)).toBe('3600 seconds');
  });
});
