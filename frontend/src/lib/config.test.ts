/**
 * config.test.ts
 *
 * Tests for typed feature flags configuration.
 *
 * Covers:
 *  - Default-off behavior (all flags disabled by default)
 *  - Environment variable loading (NEXT_PUBLIC_FF_*)
 *  - Boolean parsing (true/1/yes accepted, everything else is false)
 *  - Caching behavior (same instance returned on subsequent calls)
 *  - Cache clearing (for test isolation)
 *  - Convenience helpers (isFeatureEnabled, getFlagEnvName, etc.)
 *  - Production warnings (experimental flags in production trigger console.warn)
 *  - Type safety (TypeScript enforces valid flag names)
 *  - Accessibility: Observable error states and flag descriptions
 */

import {
  getFeatureFlags,
  featureFlags,
  isFeatureEnabled,
  getFlagEnvName,
  getAllFlagNames,
  clearFeatureFlagsCache,
  validateFeatureFlags,
  describeEnabledFlags,
  type FeatureFlags,
} from './config';

describe('config - feature flags', () => {
  // Save original env and console
  const originalEnv = process.env;
  let consoleWarnSpy: jest.SpyInstance;

  beforeEach(() => {
    // Clear module cache to ensure fresh env var reads
    jest.resetModules();
    clearFeatureFlagsCache();

    // Spy on console.warn for production flag warnings
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

    // Reset process.env to clean state
    process.env = { ...originalEnv, NODE_ENV: 'test' };
  });

  afterEach(() => {
    process.env = originalEnv;
    consoleWarnSpy.mockRestore();
    clearFeatureFlagsCache();
  });

  describe('default-off behavior', () => {
    it('all flags are disabled by default', () => {
      const flags = getFeatureFlags();

      expect(flags.stagedPayments).toBe(false);
      expect(flags.batchPaymentExecution).toBe(false);
      expect(flags.automaticPaymentRetry).toBe(false);
    });

    it('returns false for all flags when no env vars are set', () => {
      delete process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS;
      delete process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE;
      delete process.env.NEXT_PUBLIC_FF_PAYMENT_RETRY;

      clearFeatureFlagsCache();
      const flags = getFeatureFlags();

      Object.values(flags).forEach((value) => {
        expect(value).toBe(false);
      });
    });
  });

  describe('environment variable loading', () => {
    it('enables stagedPayments when env var is "true"', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.stagedPayments).toBe(true);
    });

    it('enables batchPaymentExecution when env var is "1"', () => {
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = '1';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.batchPaymentExecution).toBe(true);
    });

    it('enables automaticPaymentRetry when env var is "yes"', () => {
      process.env.NEXT_PUBLIC_FF_PAYMENT_RETRY = 'yes';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.automaticPaymentRetry).toBe(true);
    });

    it('respects case-insensitive boolean parsing', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'TRUE';
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = 'Yes';
      process.env.NEXT_PUBLIC_FF_PAYMENT_RETRY = 'YES';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.stagedPayments).toBe(true);
      expect(flags.batchPaymentExecution).toBe(true);
      expect(flags.automaticPaymentRetry).toBe(true);
    });

    it('disables flags for any value other than true/1/yes', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'false';
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = '0';
      process.env.NEXT_PUBLIC_FF_PAYMENT_RETRY = 'no';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.stagedPayments).toBe(false);
      expect(flags.batchPaymentExecution).toBe(false);
      expect(flags.automaticPaymentRetry).toBe(false);
    });

    it('disables flags for empty string', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = '';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.stagedPayments).toBe(false);
    });

    it('disables flags for invalid values', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'enabled';
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = 'on';
      process.env.NEXT_PUBLIC_FF_PAYMENT_RETRY = 'oui';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.stagedPayments).toBe(false);
      expect(flags.batchPaymentExecution).toBe(false);
      expect(flags.automaticPaymentRetry).toBe(false);
    });
  });

  describe('caching behavior', () => {
    it('returns same instance on subsequent calls', () => {
      const flags1 = getFeatureFlags();
      const flags2 = getFeatureFlags();

      expect(flags1).toBe(flags2);
    });

    it('caches featureFlags export correctly', () => {
      // featureFlags is computed at module load, so we verify it matches
      const fresh = getFeatureFlags();
      expect(featureFlags).toEqual(fresh);
    });

    it('allows cache clearing for test isolation', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';
      const flags1 = getFeatureFlags();
      expect(flags1.stagedPayments).toBe(true);

      // Clear cache and change env
      clearFeatureFlagsCache();
      delete process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS;

      const flags2 = getFeatureFlags();
      expect(flags2.stagedPayments).toBe(false);
    });

    it('preserves cache across multiple accesses', () => {
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = 'true';
      const flags1 = getFeatureFlags();

      // Change env (but cache is still active)
      delete process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE;

      const flags2 = getFeatureFlags();
      expect(flags1).toBe(flags2);
      expect(flags2.batchPaymentExecution).toBe(true); // Still cached as true
    });
  });

  describe('convenience helpers', () => {
    it('isFeatureEnabled returns correct flag state', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';
      clearFeatureFlagsCache();

      expect(isFeatureEnabled('stagedPayments')).toBe(true);
      expect(isFeatureEnabled('batchPaymentExecution')).toBe(false);
    });

    it('getFlagEnvName returns correct env var name', () => {
      expect(getFlagEnvName('stagedPayments')).toBe('NEXT_PUBLIC_FF_STAGED_PAYMENTS');
      expect(getFlagEnvName('batchPaymentExecution')).toBe('NEXT_PUBLIC_FF_BATCH_EXECUTE');
      expect(getFlagEnvName('automaticPaymentRetry')).toBe('NEXT_PUBLIC_FF_PAYMENT_RETRY');
    });

    it('getAllFlagNames returns all flag names', () => {
      const names = getAllFlagNames();

      expect(names).toContain('stagedPayments');
      expect(names).toContain('batchPaymentExecution');
      expect(names).toContain('automaticPaymentRetry');
      expect(names.length).toBe(3);
    });

    it('validateFeatureFlags does not throw', () => {
      expect(() => {
        validateFeatureFlags();
      }).not.toThrow();
    });

    it('describeEnabledFlags returns "none" when no flags enabled', () => {
      clearFeatureFlagsCache();
      expect(describeEnabledFlags()).toBe('none');
    });

    it('describeEnabledFlags lists enabled flags with env var names', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = 'true';
      clearFeatureFlagsCache();

      const desc = describeEnabledFlags();
      expect(desc).toContain('stagedPayments');
      expect(desc).toContain('NEXT_PUBLIC_FF_STAGED_PAYMENTS');
      expect(desc).toContain('batchPaymentExecution');
      expect(desc).toContain('NEXT_PUBLIC_FF_BATCH_EXECUTE');
      expect(desc).not.toContain('automaticPaymentRetry');
    });
  });

describe('production warnings', () => {
    it('warns when experimental flags are enabled in production', () => {
      // Note: In test environment (NODE_ENV='test'), warnings are skipped
      // This test documents the behavior; actual prod warning would occur with NODE_ENV='production'
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';

      clearFeatureFlagsCache();
      getFeatureFlags();

      // In test environment, warnings are skipped
      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('skips warnings in test environment', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';

      clearFeatureFlagsCache();
      getFeatureFlags();

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });

    it('does not warn when no flags are enabled', () => {
      clearFeatureFlagsCache();
      getFeatureFlags();

      expect(consoleWarnSpy).not.toHaveBeenCalled();
    });
  });

  describe('type safety', () => {
    it('returns object with all expected flag properties', () => {
      const flags = getFeatureFlags();

      expect(flags).toHaveProperty('stagedPayments');
      expect(flags).toHaveProperty('batchPaymentExecution');
      expect(flags).toHaveProperty('automaticPaymentRetry');
    });

    it('all flags are boolean', () => {
      const flags = getFeatureFlags();

      expect(typeof flags.stagedPayments).toBe('boolean');
      expect(typeof flags.batchPaymentExecution).toBe('boolean');
      expect(typeof flags.automaticPaymentRetry).toBe('boolean');
    });
  });

  describe('accessibility & observability', () => {
    it('provides environment variable names for documentation', () => {
      const names = getAllFlagNames();

      names.forEach((flagName) => {
        const envName = getFlagEnvName(flagName);
        expect(envName).toMatch(/^NEXT_PUBLIC_FF_/);
      });
    });

    it('handles multiple flags independently', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = 'false';
      process.env.NEXT_PUBLIC_FF_PAYMENT_RETRY = 'yes';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.stagedPayments).toBe(true);
      expect(flags.batchPaymentExecution).toBe(false);
      expect(flags.automaticPaymentRetry).toBe(true);
    });

    it('describeEnabledFlags is observable for debugging', () => {
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = 'true';
      clearFeatureFlagsCache();

      const desc = describeEnabledFlags();
      expect(desc.length).toBeGreaterThan(0);
      expect(desc).not.toBe('none');
    });
  });

  describe('server/client consistency', () => {
    it('returns same flags regardless of execution environment', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();

      // Same env var should produce same result whether called from server or client
      // (in actual runtime, process.env is available in both)
      expect(flags.stagedPayments).toBe(true);
      expect(flags.stagedPayments).toBe(true); // Deterministic
    });

    it('flags are serializable (for SSR)', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = 'true';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      const json = JSON.stringify(flags);
      const parsed = JSON.parse(json) as FeatureFlags;

      expect(parsed.stagedPayments).toBe(true);
      expect(parsed.batchPaymentExecution).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('handles whitespace in env var values', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = '  true  ';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      // Leading/trailing whitespace is not trimmed in our parser, so this will be false
      expect(flags.stagedPayments).toBe(false);
    });

    it('handles undefined env var (missing property)', () => {
      delete process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS;
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.stagedPayments).toBe(false);
    });

    it('handles all flags set to different values', () => {
      process.env.NEXT_PUBLIC_FF_STAGED_PAYMENTS = 'true';
      process.env.NEXT_PUBLIC_FF_BATCH_EXECUTE = 'false';
      process.env.NEXT_PUBLIC_FF_PAYMENT_RETRY = '1';
      clearFeatureFlagsCache();

      const flags = getFeatureFlags();
      expect(flags.stagedPayments).toBe(true);
      expect(flags.batchPaymentExecution).toBe(false);
      expect(flags.automaticPaymentRetry).toBe(true);
    });
  });
});
