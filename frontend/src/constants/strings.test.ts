/**
 * strings.test.ts
 *
 * Issue #1152 – Extract localized core strings
 *
 * Tests for the UI_STRINGS catalogue:
 *  - Positive: every required key exists and is a non-empty string
 *  - Positive: parametric string functions return correct output
 *  - Negative: parametric functions with boundary values (days=1, days=0)
 *  - Boundary: singular vs plural day labels
 *  - Recovery: wrongNetworkFix produces network-name-specific message
 *  - Contract: shape of UI_STRINGS matches expected sections
 */

import { UI_STRINGS, LOCALE } from '@/constants/strings';

// ─── Locale ───────────────────────────────────────────────────────────────────

describe('LOCALE', () => {
  it('exports a non-empty locale identifier', () => {
    expect(LOCALE).toBeTruthy();
    expect(typeof LOCALE).toBe('string');
  });

  it('defaults to en-US', () => {
    expect(LOCALE).toBe('en-US');
  });
});

// ─── Shape: all top-level sections exist ──────────────────────────────────────

describe('UI_STRINGS – shape', () => {
  const sections = [
    'page', 'wallet', 'freighter', 'form', 'confirm',
    'progress', 'success', 'error', 'contractConfig', 'network',
    'history', 'emptyState',
  ] as const;

  sections.forEach((section) => {
    it(`section "${section}" exists`, () => {
      expect(UI_STRINGS[section]).toBeDefined();
    });
  });
});

// ─── Static strings are non-empty ─────────────────────────────────────────────

describe('UI_STRINGS – static strings are non-empty', () => {
  it('page.title is non-empty', () => {
    expect(UI_STRINGS.page.title.length).toBeGreaterThan(0);
  });

  it('form.submitIdle is non-empty', () => {
    expect(UI_STRINGS.form.submitIdle.length).toBeGreaterThan(0);
  });

  it('form.submitBusy is non-empty', () => {
    expect(UI_STRINGS.form.submitBusy.length).toBeGreaterThan(0);
  });

  it('form.walletHint is non-empty', () => {
    expect(UI_STRINGS.form.walletHint.length).toBeGreaterThan(0);
  });

  it('progress.ariaLabel is non-empty', () => {
    expect(UI_STRINGS.progress.ariaLabel.length).toBeGreaterThan(0);
  });

  it('progress.submitting is non-empty', () => {
    expect(UI_STRINGS.progress.submitting.length).toBeGreaterThan(0);
  });

  it('success.heading is non-empty', () => {
    expect(UI_STRINGS.success.heading.length).toBeGreaterThan(0);
  });

  it('success.createAnother is non-empty', () => {
    expect(UI_STRINGS.success.createAnother.length).toBeGreaterThan(0);
  });

  it('confirm.goBack is non-empty', () => {
    expect(UI_STRINGS.confirm.goBack.length).toBeGreaterThan(0);
  });

  it('confirm.confirm is non-empty', () => {
    expect(UI_STRINGS.confirm.confirm.length).toBeGreaterThan(0);
  });

  it('error.signingCancelled is non-empty', () => {
    expect(UI_STRINGS.error.signingCancelled.length).toBeGreaterThan(0);
  });

  it('error.genericFailed is non-empty', () => {
    expect(UI_STRINGS.error.genericFailed.length).toBeGreaterThan(0);
  });
});

// ─── Parametric strings ───────────────────────────────────────────────────────

describe('UI_STRINGS – parametric string functions', () => {
  describe('success.days', () => {
    it('pluralises "days" correctly for multiple days', () => {
      expect(UI_STRINGS.success.days({ days: 30 })).toBe('every 30 days');
    });

    it('uses singular "day" for 1 day', () => {
      expect(UI_STRINGS.success.days({ days: 1 })).toBe('every 1 day');
    });

    it('boundary: 0 days uses plural form', () => {
      expect(UI_STRINGS.success.days({ days: 0 })).toBe('every 0 days');
    });
  });

  describe('success.nextStep2', () => {
    it('includes day count and pluralises correctly', () => {
      const result = UI_STRINGS.success.nextStep2({ days: 7 });
      expect(result).toContain('7 days');
    });

    it('uses singular for 1 day', () => {
      const result = UI_STRINGS.success.nextStep2({ days: 1 });
      expect(result).toContain('1 day');
      expect(result).not.toContain('1 days');
    });
  });

  describe('success.amountTokens', () => {
    it('formats amount with "tokens" suffix', () => {
      expect(UI_STRINGS.success.amountTokens({ amount: '100' })).toBe('100 tokens');
    });

    it('works with large amounts', () => {
      expect(UI_STRINGS.success.amountTokens({ amount: '1000000' })).toBe('1000000 tokens');
    });
  });

  describe('success.intervalDisplay', () => {
    it('formats interval with days and seconds', () => {
      const result = UI_STRINGS.success.intervalDisplay({ days: 30, interval: '2592000' });
      expect(result).toContain('30 days');
      expect(result).toContain('2592000 s');
    });
  });

  describe('error.wrongNetworkFix', () => {
    it('includes the network name in the fix message', () => {
      const result = UI_STRINGS.error.wrongNetworkFix('Testnet');
      expect(result).toContain('Testnet');
    });

    it('works for Mainnet too', () => {
      const result = UI_STRINGS.error.wrongNetworkFix('Mainnet');
      expect(result).toContain('Mainnet');
    });
  });

  describe('network.badgeAriaLabel', () => {
    it('includes network name and status label', () => {
      const result = UI_STRINGS.network.badgeAriaLabel('Testnet', 'Contract reachable');
      expect(result).toContain('Testnet');
      expect(result).toContain('Contract reachable');
    });
  });

  describe('wallet.copyKeyLabel', () => {
    it('includes the public key in the label', () => {
      const key = 'GABC123';
      const result = UI_STRINGS.wallet.copyKeyLabel(key);
      expect(result).toContain(key);
    });
  });
});

// ─── Strings used in SubscriptionForm are present ────────────────────────────

describe('UI_STRINGS – SubscriptionForm integration strings', () => {
  it('form.submitIdle matches "Authorize Subscription"', () => {
    expect(UI_STRINGS.form.submitIdle).toMatch(/authorize subscription/i);
  });

  it('form.submitBusy ends with ellipsis character', () => {
    expect(UI_STRINGS.form.submitBusy).toMatch(/…$/);
  });

  it('progress.ariaLabel matches "Transaction in progress"', () => {
    expect(UI_STRINGS.progress.ariaLabel).toMatch(/transaction in progress/i);
  });

  it('success.createAnother matches "Create Another"', () => {
    expect(UI_STRINGS.success.createAnother).toMatch(/create another/i);
  });

  it('confirm.confirm matches "Confirm"', () => {
    expect(UI_STRINGS.confirm.confirm).toMatch(/confirm/i);
  });

  it('confirm.goBack matches "Go Back"', () => {
    expect(UI_STRINGS.confirm.goBack).toMatch(/go back/i);
  });
});
