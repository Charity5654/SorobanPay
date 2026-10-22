/**
 * validation.ts
 *
 * Client-side input validation for the subscription form.
 * Pure functions — no side effects, no async.
 *
 * Requirements: 10.1, 10.9
 */

import { StrKey } from '@stellar/stellar-sdk';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Map of field name → error message. Empty object means all fields are valid. */
export interface FieldErrors {
  merchantAddress?: string;
  tokenAddress?: string;
  amount?: string;
  interval?: string;
}

/** Raw string values from the subscription form inputs. */
export interface SubscriptionFormValues {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
  /** The connected subscriber's public key. When provided, used to guard against self-subscription. */
  subscriberAddress?: string;
}

// ─── Interval bounds ──────────────────────────────────────────────────────────

export const MIN_INTERVAL_SECONDS = 86_400;      // 1 day
export const MAX_INTERVAL_SECONDS = 31_536_000;  // 365 days
export const DEFAULT_INTERVAL_SECONDS = 2_592_000; // 30 days

// ─── Address validators ───────────────────────────────────────────────────────

/** Returns true for a valid Stellar G-address (56-char base32, starts with G). */
export function isValidGAddress(addr: string): boolean {
  return /^G[A-Z2-7]{55}$/.test(addr.trim());
}

/** Returns true for a valid Stellar contract C-address (56-char base32, starts with C). */
export function isValidCAddress(addr: string): boolean {
  return /^C[A-Z2-7]{55}$/.test(addr.trim());
}

// ─── Address normalization + assertion helpers (Issue #37) ────────────────────
//
// transaction_builder.ts repeated the same
//   if (!isValidGAddress(x)) throw new Error(`Invalid ... address: ${x}`)
// block seven times across its builder functions, each operating on the raw,
// un-trimmed param. These helpers centralize that: normalize (trim) once,
// validate once, and either return the clean address or throw a consistently
// worded error — so every builder function does address handling the same way
// before it ever builds a contract call.

/** Trim a Stellar address. The sole normalization StrKey addresses need —
 *  they have no case variation, so there's nothing else safe to fold. */
export function normalizeAddress(addr: string): string {
  return addr.trim();
}

/**
 * Normalize and validate a Stellar G-address (account/subscriber/merchant).
 *
 * @param addr  Raw address, e.g. straight from a form field or params object.
 * @param label Used in the thrown message, e.g. "subscriber" → "Invalid subscriber address: …".
 * @returns     The trimmed address, once confirmed to match the G-address shape.
 * @throws      Error with a message matching the `/invalid (subscriber|merchant|...) address/i`
 *              pattern that lib/errors.ts's mapError() and rpc_error_normalizer.ts already key off.
 */
export function assertValidGAddress(addr: string, label: string): string {
  const normalized = normalizeAddress(addr);
  if (!isValidGAddress(normalized)) {
    throw new Error(`Invalid ${label} address: ${addr}`);
  }
  return normalized;
}

/** Same as `assertValidGAddress`, for a token contract C-address. */
export function assertValidCAddress(addr: string, label: string): string {
  const normalized = normalizeAddress(addr);
  if (!isValidCAddress(normalized)) {
    throw new Error(`Invalid ${label} address: ${addr}`);
  }
  return normalized;
}

// ─── Stricter, checksum-verified validation (opt-in) ───────────────────────────
//
// isValidGAddress/isValidCAddress above only check shape (length, charset) via
// regex — a string can match and still carry a corrupted StrKey checksum,
// which would only surface later as a confusing SDK/RPC error. StrKey (from
// @stellar/stellar-sdk) verifies the embedded CRC16 checksum for real.
//
// This is intentionally NOT wired into isValidGAddress/isValidCAddress or the
// assert* helpers above: a lot of this codebase's existing tests use
// regex-shaped-but-not-checksum-valid placeholder addresses (e.g.
// 'G' + 'A'.repeat(55)) as fixtures, and swapping the strictness of the
// widely-used validators out from under them would break those tests. Use
// these directly wherever you specifically want a real checksum guarantee —
// e.g. before persisting an address, or in a new form that isn't relying on
// the existing placeholder-fixture convention.

/** Returns true only for a G-address with a valid embedded StrKey checksum. */
export function isValidGAddressChecksum(addr: string): boolean {
  return StrKey.isValidEd25519PublicKey(normalizeAddress(addr));
}

/** Returns true only for a C-address with a valid embedded StrKey checksum. */
export function isValidCAddressChecksum(addr: string): boolean {
  return StrKey.isValidContract(normalizeAddress(addr));
}

// ─── Form validator ───────────────────────────────────────────────────────────

/**
 * Validate all subscription form fields.
 *
 * @param values  Raw form values (strings from <input> elements).
 * @returns       FieldErrors map. Empty = all valid.
 */
export function validateSubscriptionForm(
  values: SubscriptionFormValues,
): FieldErrors {
  const errors: FieldErrors = {};

  // merchantAddress — valid Stellar G-address, and must not equal the subscriber
  if (!values.merchantAddress.trim()) {
    errors.merchantAddress = 'Merchant address is required.';
  } else if (!isValidGAddress(values.merchantAddress)) {
    errors.merchantAddress =
      'Must be a valid Stellar G-address (56 characters, starts with G).';
  } else if (
    values.subscriberAddress &&
    values.merchantAddress.trim() === values.subscriberAddress.trim()
  ) {
    errors.merchantAddress =
      'Merchant address cannot be the same as your subscriber address. A subscription to yourself is not allowed.';
  }

  // tokenAddress — valid Stellar C-address (contract)
  if (!values.tokenAddress.trim()) {
    errors.tokenAddress = 'Token contract address is required.';
  } else if (!isValidCAddress(values.tokenAddress)) {
    errors.tokenAddress =
      'Must be a valid Stellar C-address (56 characters, starts with C).';
  }

  // amount — positive integer
  const amountNum = Number(values.amount);
  if (!values.amount.trim()) {
    errors.amount = 'Amount is required.';
  } else if (!Number.isInteger(amountNum) || isNaN(amountNum)) {
    errors.amount = 'Amount must be a whole number.';
  } else if (amountNum <= 0) {
    errors.amount = 'Amount must be greater than 0.';
  }

  // interval — seconds in [86400, 31536000]
  const intervalNum = Number(values.interval);
  if (!values.interval.trim()) {
    errors.interval = 'Interval is required.';
  } else if (!Number.isInteger(intervalNum) || isNaN(intervalNum)) {
    errors.interval = 'Interval must be a whole number of seconds.';
  } else if (intervalNum < MIN_INTERVAL_SECONDS) {
    errors.interval = `Minimum interval is ${MIN_INTERVAL_SECONDS.toLocaleString()} seconds (1 day).`;
  } else if (intervalNum > MAX_INTERVAL_SECONDS) {
    errors.interval = `Maximum interval is ${MAX_INTERVAL_SECONDS.toLocaleString()} seconds (365 days).`;
  }

  return errors;
}

/** Returns true when a FieldErrors object has no error entries. */
export function isFormValid(errors: FieldErrors): boolean {
  return Object.keys(errors).length === 0;
}
