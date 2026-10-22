/**
 * errors.test.ts
 *
 * Unit tests for the typed ContractLifecycleError enum and supporting
 * utilities added to errors.ts.
 *
 * Tests cover:
 *  - ContractLifecycleErrorCode values and exhaustiveness
 *  - ContractLifecycleError class construction, prototype chain, and properties
 *  - isContractLifecycleError type guard
 *  - lifecycleErrorMessage labels
 *  - mapLifecycleError routing (lifecycle errors + fallback to mapError)
 *
 * Issue #45 — Add a centralized error enum for backend failures
 */

import {
  ContractLifecycleErrorCode,
  ContractLifecycleError,
  isContractLifecycleError,
  lifecycleErrorMessage,
  mapLifecycleError,
  mapError,
  formatUnifiedError,
  formatInlineError,
  formatToastError,
} from './errors';

// ─── ContractLifecycleErrorCode values ────────────────────────────────────────

describe('ContractLifecycleErrorCode', () => {
  it('PREPARATION_FAILED equals "PREPARATION_FAILED"', () => {
    expect(ContractLifecycleErrorCode.PREPARATION_FAILED).toBe('PREPARATION_FAILED');
  });

  it('SIGNING_FAILED equals "SIGNING_FAILED"', () => {
    expect(ContractLifecycleErrorCode.SIGNING_FAILED).toBe('SIGNING_FAILED');
  });

  it('SUBMISSION_FAILED equals "SUBMISSION_FAILED"', () => {
    expect(ContractLifecycleErrorCode.SUBMISSION_FAILED).toBe('SUBMISSION_FAILED');
  });

  it('CONFIRMATION_TIMEOUT equals "CONFIRMATION_TIMEOUT"', () => {
    expect(ContractLifecycleErrorCode.CONFIRMATION_TIMEOUT).toBe('CONFIRMATION_TIMEOUT');
  });

  it('CONFIRMATION_FAILED equals "CONFIRMATION_FAILED"', () => {
    expect(ContractLifecycleErrorCode.CONFIRMATION_FAILED).toBe('CONFIRMATION_FAILED');
  });

  it('USER_CANCELLED equals "USER_CANCELLED"', () => {
    expect(ContractLifecycleErrorCode.USER_CANCELLED).toBe('USER_CANCELLED');
  });

  it('VALIDATION_ERROR equals "VALIDATION_ERROR"', () => {
    expect(ContractLifecycleErrorCode.VALIDATION_ERROR).toBe('VALIDATION_ERROR');
  });

  it('TRANSFER_FAILED equals "TRANSFER_FAILED"', () => {
    expect(ContractLifecycleErrorCode.TRANSFER_FAILED).toBe('TRANSFER_FAILED');
  });

  it('UNKNOWN equals "UNKNOWN"', () => {
    expect(ContractLifecycleErrorCode.UNKNOWN).toBe('UNKNOWN');
  });

  it('has all four lifecycle phase codes', () => {
    const phases = [
      ContractLifecycleErrorCode.PREPARATION_FAILED,
      ContractLifecycleErrorCode.SIGNING_FAILED,
      ContractLifecycleErrorCode.SUBMISSION_FAILED,
      ContractLifecycleErrorCode.CONFIRMATION_TIMEOUT,
    ];
    expect(phases).toHaveLength(4);
    // All unique
    expect(new Set(phases).size).toBe(4);
  });

  it('has all on-chain contract error code variants', () => {
    const contractCodes = [
      ContractLifecycleErrorCode.AMOUNT_MUST_BE_POSITIVE,
      ContractLifecycleErrorCode.INTERVAL_TOO_SHORT,
      ContractLifecycleErrorCode.INTERVAL_TOO_LONG,
      ContractLifecycleErrorCode.NO_ACTIVE_SUBSCRIPTION,
      ContractLifecycleErrorCode.PAYMENT_NOT_DUE,
      ContractLifecycleErrorCode.UNAUTHORIZED,
      ContractLifecycleErrorCode.TRANSFER_FAILED,
      ContractLifecycleErrorCode.INVALID_TIMESTAMP,
      ContractLifecycleErrorCode.AMOUNT_TOO_LARGE,
      ContractLifecycleErrorCode.SELF_SUBSCRIPTION,
      ContractLifecycleErrorCode.INVALID_TOKEN_ADDRESS,
      ContractLifecycleErrorCode.SUBSCRIPTION_PAUSED,
      ContractLifecycleErrorCode.EMPTY_BATCH,
      ContractLifecycleErrorCode.BATCH_TOO_LARGE,
      ContractLifecycleErrorCode.INSUFFICIENT_ALLOWANCE,
      ContractLifecycleErrorCode.ALREADY_MIGRATED,
      ContractLifecycleErrorCode.NOT_ADMIN,
      ContractLifecycleErrorCode.AMOUNT_EXCEEDS_LIMIT,
      ContractLifecycleErrorCode.GRACE_PERIOD_ACTIVE,
    ];
    expect(contractCodes).toHaveLength(19);
    expect(new Set(contractCodes).size).toBe(19);
  });
});

// ─── ContractLifecycleError class ─────────────────────────────────────────────

describe('ContractLifecycleError', () => {
  it('is an instance of Error', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.PREPARATION_FAILED,
      'some message',
    );
    expect(err).toBeInstanceOf(Error);
  });

  it('is an instance of ContractLifecycleError', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.SIGNING_FAILED,
      'signing error',
    );
    expect(err).toBeInstanceOf(ContractLifecycleError);
  });

  it('sets name to "ContractLifecycleError"', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.SUBMISSION_FAILED,
      'submission error',
    );
    expect(err.name).toBe('ContractLifecycleError');
  });

  it('stores the code', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.CONFIRMATION_TIMEOUT,
      'timed out',
    );
    expect(err.code).toBe(ContractLifecycleErrorCode.CONFIRMATION_TIMEOUT);
  });

  it('stores the message', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.USER_CANCELLED,
      'User declined the request',
    );
    expect(err.message).toBe('User declined the request');
  });

  it('stores the cause when provided', () => {
    const cause = new Error('original');
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.PREPARATION_FAILED,
      'wrapped',
      cause,
    );
    expect(err.cause).toBe(cause);
  });

  it('cause is undefined when not provided', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.UNKNOWN,
      'no cause',
    );
    expect(err.cause).toBeUndefined();
  });

  it('label getter returns the corresponding lifecycleErrorMessage', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.PREPARATION_FAILED,
      'fail',
    );
    expect(err.label).toBe(lifecycleErrorMessage.PREPARATION_FAILED);
  });

  it('label is non-empty for every error code', () => {
    Object.values(ContractLifecycleErrorCode).forEach((code) => {
      const err = new ContractLifecycleError(code, 'test');
      expect(err.label).toBeTruthy();
    });
  });
});

// ─── isContractLifecycleError type guard ──────────────────────────────────────

describe('isContractLifecycleError', () => {
  it('returns true for ContractLifecycleError instances', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.SIGNING_FAILED,
      'test',
    );
    expect(isContractLifecycleError(err)).toBe(true);
  });

  it('returns false for plain Error instances', () => {
    expect(isContractLifecycleError(new Error('plain'))).toBe(false);
  });

  it('returns false for null', () => {
    expect(isContractLifecycleError(null)).toBe(false);
  });

  it('returns false for undefined', () => {
    expect(isContractLifecycleError(undefined)).toBe(false);
  });

  it('returns false for a plain string', () => {
    expect(isContractLifecycleError('error string')).toBe(false);
  });

  it('returns false for a plain object', () => {
    expect(isContractLifecycleError({ message: 'error' })).toBe(false);
  });
});

// ─── lifecycleErrorMessage labels ─────────────────────────────────────────────

describe('lifecycleErrorMessage', () => {
  it('has a non-empty string for every ContractLifecycleErrorCode value', () => {
    Object.values(ContractLifecycleErrorCode).forEach((code) => {
      const label = lifecycleErrorMessage[code];
      expect(typeof label).toBe('string');
      expect(label.length).toBeGreaterThan(0);
    });
  });

  it('PREPARATION_FAILED label mentions preparation or transaction', () => {
    expect(lifecycleErrorMessage.PREPARATION_FAILED.toLowerCase()).toMatch(
      /preparation|transaction/,
    );
  });

  it('SIGNING_FAILED label mentions signing or transaction', () => {
    expect(lifecycleErrorMessage.SIGNING_FAILED.toLowerCase()).toMatch(
      /signing|transaction/,
    );
  });

  it('USER_CANCELLED label mentions cancelled or user', () => {
    expect(lifecycleErrorMessage.USER_CANCELLED.toLowerCase()).toMatch(
      /cancel|user/,
    );
  });

  it('TRANSFER_FAILED label mentions transfer or balance', () => {
    expect(lifecycleErrorMessage.TRANSFER_FAILED.toLowerCase()).toMatch(
      /transfer|balance/,
    );
  });
});

// ─── mapLifecycleError ────────────────────────────────────────────────────────

describe('mapLifecycleError', () => {
  it('returns a MappedError with non-empty message for lifecycle errors', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.PREPARATION_FAILED,
      'prep failed',
    );
    const mapped = mapLifecycleError(err);
    expect(mapped.message).toBeTruthy();
    expect(mapped.action).toBeTruthy();
  });

  it('maps SIGNING_FAILED to a result with message and action', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.SIGNING_FAILED,
      'signing failed',
    );
    const mapped = mapLifecycleError(err);
    expect(mapped.message).toBeTruthy();
    expect(mapped.action).toBeTruthy();
  });

  it('maps USER_CANCELLED to a result with action mentioning wallet or approve', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.USER_CANCELLED,
      'user declined',
    );
    const mapped = mapLifecycleError(err);
    expect(mapped.action.toLowerCase()).toMatch(/wallet|approve|submit/);
  });

  it('maps AMOUNT_MUST_BE_POSITIVE via contract error code lookup', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.AMOUNT_MUST_BE_POSITIVE,
      'amount must be positive',
    );
    const mapped = mapLifecycleError(err);
    // Should return the rich CONTRACT_ERROR_MAP entry for code 1
    const fallback = mapError(new Error('Contract error: 1'));
    expect(mapped.message).toBe(fallback.message);
  });

  it('maps TRANSFER_FAILED via contract error code lookup (code 7)', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.TRANSFER_FAILED,
      'insufficient balance',
    );
    const mapped = mapLifecycleError(err);
    const fallback = mapError(new Error('Contract error: 7'));
    expect(mapped.message).toBe(fallback.message);
  });

  it('TRANSFER_FAILED mapped result includes docsUrl', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.TRANSFER_FAILED,
      'transfer failed',
    );
    const mapped = mapLifecycleError(err);
    expect(mapped.docsUrl).toBeTruthy();
  });

  it('falls back to mapError for plain Error instances', () => {
    const plain = new Error('Transaction preparation failed: timeout');
    const fromLifecycle = mapLifecycleError(plain);
    const fromMapError = mapError(plain);
    // Both should produce equivalent output since mapLifecycleError defers to mapError
    expect(fromLifecycle.message).toBe(fromMapError.message);
  });

  it('falls back to mapError for null', () => {
    const result = mapLifecycleError(null);
    expect(result.message).toBeTruthy();
  });

  it('maps CONFIRMATION_TIMEOUT to result with message and action', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.CONFIRMATION_TIMEOUT,
      'timeout',
    );
    const mapped = mapLifecycleError(err);
    expect(mapped.message).toBeTruthy();
    expect(mapped.action.toLowerCase()).toMatch(/wait|retry|moment/);
  });

  it('maps WRONG_NETWORK to result with docsUrl', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.WRONG_NETWORK,
      'wrong network',
    );
    const mapped = mapLifecycleError(err);
    expect(mapped.docsUrl).toBeTruthy();
  });

  it('maps VALIDATION_ERROR to result with action mentioning form or fields', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.VALIDATION_ERROR,
      'invalid address',
    );
    const mapped = mapLifecycleError(err);
    expect(mapped.action.toLowerCase()).toMatch(/field|form|correct|resubmit/);
  });

  it('every ContractLifecycleErrorCode produces a non-empty MappedError.message', () => {
    Object.values(ContractLifecycleErrorCode).forEach((code) => {
      const err = new ContractLifecycleError(code, `test ${code}`);
      const mapped = mapLifecycleError(err);
      expect(mapped.message).toBeTruthy();
      expect(mapped.action).toBeTruthy();
    });
  });
});

// ─── Unified Toast and Inline Error Language ──────────────────────────────────

describe('Unified Toast and Inline Error Language', () => {
  it('formats unified error with message and action', () => {
    const err = new Error('User declined transaction');
    const unified = formatUnifiedError(err);
    expect(unified.title).toBe('Action required');
    expect(unified.message.toLowerCase()).toContain('declined');
    expect(unified.action).toBeTruthy();
  });

  it('keeps inline and toast error language identical', () => {
    const err = new ContractLifecycleError(
      ContractLifecycleErrorCode.SIGNING_FAILED,
      'User declined to sign transaction',
    );
    const inline = formatInlineError(err);
    const toast = formatToastError(err);

    expect(inline.title).toBe(toast.title);
    expect(inline.body).toBe(toast.message);
    expect(inline.action).toBe(toast.action);
    expect(inline.docsUrl).toBe(toast.docsUrl);
  });
});
