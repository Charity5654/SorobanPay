/**
 * Unit tests for validation helpers.
 * Covers: isValidGAddress, isValidCAddress, validateSubscriptionForm (all fields)
 */

import {
  isValidGAddress,
  isValidCAddress,
  validateSubscriptionForm,
  isFormValid,
  MIN_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS,
  SubscriptionFormValues,
} from './validation';

const VALID_G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_C = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

const BASE_FORM: SubscriptionFormValues = {
  merchantAddress: VALID_G,
  tokenAddress: VALID_C,
  amount: '100',
  interval: '86400',
};

// ─── isValidCAddress ──────────────────────────────────────────────────────────

describe('isValidCAddress', () => {
  it('accepts a valid 56-char C-address', () => {
    expect(isValidCAddress(VALID_C)).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidCAddress('')).toBe(false);
  });

  it('rejects an address starting with G (account address)', () => {
    expect(isValidCAddress(VALID_G)).toBe(false);
  });

  it('rejects an address that is too short', () => {
    expect(isValidCAddress('CAAAAAAAAAAAAAAA')).toBe(false);
  });

  it('rejects an address that is too long', () => {
    expect(isValidCAddress(VALID_C + 'A')).toBe(false);
  });

  it('rejects an address with lowercase characters', () => {
    expect(isValidCAddress('caaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('rejects an address with invalid base32 characters (0, 1, 8, 9)', () => {
    // Replace last char with '0' (not in base32 alphabet A-Z2-7)
    const bad = VALID_C.slice(0, -1) + '0';
    expect(isValidCAddress(bad)).toBe(false);
  });

  it('rejects a random string', () => {
    expect(isValidCAddress('not-a-contract-address')).toBe(false);
  });

  it('accepts address with surrounding whitespace (trimmed)', () => {
    expect(isValidCAddress(`  ${VALID_C}  `)).toBe(true);
  });
});

// ─── validateSubscriptionForm — tokenAddress field ────────────────────────────

describe('validateSubscriptionForm: tokenAddress regression', () => {
  it('returns no error for a valid token address', () => {
    const errors = validateSubscriptionForm(BASE_FORM);
    expect(errors.tokenAddress).toBeUndefined();
    expect(isFormValid(errors)).toBe(true);
  });

  it('rejects empty token address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: '' });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects whitespace-only token address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: '   ' });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects a G-address used as token address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: VALID_G });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects a truncated C-address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: 'CAAAAAAA' });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects an address with invalid characters', () => {
    const bad = 'C' + '0'.repeat(55); // '0' not in base32 A-Z2-7
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: bad });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('rejects a plain URL accidentally entered as token address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: 'https://example.com/token' });
    expect(errors.tokenAddress).toBeDefined();
  });

  it('does not set errors on other fields when only token address is invalid', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: 'BAD' });
    expect(errors.tokenAddress).toBeDefined();
    expect(errors.merchantAddress).toBeUndefined();
    expect(errors.amount).toBeUndefined();
    expect(errors.interval).toBeUndefined();
  });

  it('isFormValid returns false when token address is the only error', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, tokenAddress: 'BAD' });
    expect(isFormValid(errors)).toBe(false);
  });
});

// ─── isValidGAddress ──────────────────────────────────────────────────────────

describe('isValidGAddress', () => {
  it('accepts a valid 56-char G-address', () => {
    expect(isValidGAddress(VALID_G)).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(isValidGAddress('')).toBe(false);
  });

  it('rejects a C-address (contract address)', () => {
    expect(isValidGAddress(VALID_C)).toBe(false);
  });

  it('rejects an address that is too short', () => {
    expect(isValidGAddress('GAAAAAAAAAAAAAAA')).toBe(false);
  });

  it('rejects an address that is too long', () => {
    expect(isValidGAddress(VALID_G + 'A')).toBe(false);
  });

  it('rejects an address with lowercase characters', () => {
    expect(isValidGAddress('gaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')).toBe(false);
  });

  it('rejects an address with invalid base32 characters (0)', () => {
    const bad = VALID_G.slice(0, -1) + '0';
    expect(isValidGAddress(bad)).toBe(false);
  });

  it('accepts an address with surrounding whitespace (trimmed)', () => {
    expect(isValidGAddress(`  ${VALID_G}  `)).toBe(true);
  });

  it('rejects a plain email accidentally entered as merchant address', () => {
    expect(isValidGAddress('merchant@example.com')).toBe(false);
  });
});

// ─── validateSubscriptionForm — merchantAddress field ─────────────────────────

describe('validateSubscriptionForm: merchantAddress', () => {
  it('returns no error for a valid merchant address', () => {
    const errors = validateSubscriptionForm(BASE_FORM);
    expect(errors.merchantAddress).toBeUndefined();
  });

  it('rejects empty merchant address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, merchantAddress: '' });
    expect(errors.merchantAddress).toBeDefined();
  });

  it('rejects whitespace-only merchant address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, merchantAddress: '   ' });
    expect(errors.merchantAddress).toBeDefined();
  });

  it('rejects a C-address used as merchant address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, merchantAddress: VALID_C });
    expect(errors.merchantAddress).toBeDefined();
  });

  it('rejects a truncated G-address', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, merchantAddress: 'GAAAAAAAAA' });
    expect(errors.merchantAddress).toBeDefined();
  });

  it('rejects a random string', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, merchantAddress: 'not-an-address' });
    expect(errors.merchantAddress).toBeDefined();
  });

  it('does not set errors on other fields when only merchant address is invalid', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, merchantAddress: 'BAD' });
    expect(errors.merchantAddress).toBeDefined();
    expect(errors.tokenAddress).toBeUndefined();
    expect(errors.amount).toBeUndefined();
    expect(errors.interval).toBeUndefined();
  });
});

// ─── validateSubscriptionForm — amount field ──────────────────────────────────

describe('validateSubscriptionForm: amount', () => {
  it('returns no error for a valid positive integer amount', () => {
    const errors = validateSubscriptionForm(BASE_FORM);
    expect(errors.amount).toBeUndefined();
  });

  it('rejects empty amount', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, amount: '' });
    expect(errors.amount).toBeDefined();
  });

  it('rejects whitespace-only amount', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, amount: '   ' });
    expect(errors.amount).toBeDefined();
  });

  it('rejects zero amount', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, amount: '0' });
    expect(errors.amount).toBeDefined();
  });

  it('rejects negative amount', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, amount: '-1' });
    expect(errors.amount).toBeDefined();
  });

  it('rejects a decimal amount', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, amount: '9.5' });
    expect(errors.amount).toBeDefined();
  });

  it('rejects non-numeric input', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, amount: 'abc' });
    expect(errors.amount).toBeDefined();
  });

  it('accepts amount of 1', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, amount: '1' });
    expect(errors.amount).toBeUndefined();
  });

  it('does not set errors on other fields when only amount is invalid', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, amount: '0' });
    expect(errors.amount).toBeDefined();
    expect(errors.merchantAddress).toBeUndefined();
    expect(errors.tokenAddress).toBeUndefined();
    expect(errors.interval).toBeUndefined();
  });
});

// ─── validateSubscriptionForm — interval field ────────────────────────────────

describe('validateSubscriptionForm: interval', () => {
  it('returns no error for the minimum valid interval', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: String(MIN_INTERVAL_SECONDS) });
    expect(errors.interval).toBeUndefined();
  });

  it('returns no error for the maximum valid interval', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: String(MAX_INTERVAL_SECONDS) });
    expect(errors.interval).toBeUndefined();
  });

  it('rejects empty interval', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: '' });
    expect(errors.interval).toBeDefined();
  });

  it('rejects whitespace-only interval', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: '   ' });
    expect(errors.interval).toBeDefined();
  });

  it('rejects interval below minimum (86399)', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: String(MIN_INTERVAL_SECONDS - 1) });
    expect(errors.interval).toBeDefined();
  });

  it('rejects interval above maximum', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: String(MAX_INTERVAL_SECONDS + 1) });
    expect(errors.interval).toBeDefined();
  });

  it('rejects zero interval', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: '0' });
    expect(errors.interval).toBeDefined();
  });

  it('rejects a decimal interval', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: '86400.5' });
    expect(errors.interval).toBeDefined();
  });

  it('rejects non-numeric interval', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: 'daily' });
    expect(errors.interval).toBeDefined();
  });

  it('does not set errors on other fields when only interval is invalid', () => {
    const errors = validateSubscriptionForm({ ...BASE_FORM, interval: '0' });
    expect(errors.interval).toBeDefined();
    expect(errors.merchantAddress).toBeUndefined();
    expect(errors.tokenAddress).toBeUndefined();
    expect(errors.amount).toBeUndefined();
  });
});

// ─── validateSubscriptionForm — all fields invalid simultaneously ─────────────

describe('validateSubscriptionForm: all fields invalid', () => {
  it('reports errors on all four fields at once', () => {
    const errors = validateSubscriptionForm({
      merchantAddress: '',
      tokenAddress: '',
      amount: '0',
      interval: '0',
    });
    expect(errors.merchantAddress).toBeDefined();
    expect(errors.tokenAddress).toBeDefined();
    expect(errors.amount).toBeDefined();
    expect(errors.interval).toBeDefined();
    expect(isFormValid(errors)).toBe(false);
  });
});
