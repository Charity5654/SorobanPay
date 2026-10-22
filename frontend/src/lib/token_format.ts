"use client";

/**
 * token_format.ts
 *
 * Locale-aware token amount formatting utilities.
 *
 * Centralises decimal handling, locale-specific grouping separators,
 * rounding, compact notation, and unavailable-value placeholders
 * without ever mutating on-chain integers.
 *
 * All functions are pure and side-effect free.
 *
 * Usage:
 * ```ts
 * import { formatTokenLocale, formatTokenSafe, formatUnavailable } from '@/lib/token_format';
 *
 * // Locale-aware display
 * formatTokenLocale(1_500_000n, 6, { locale: 'en-US' }); // "1.5"
 * formatTokenLocale(1_500_000n, 6, { locale: 'de-DE' }); // "1,5"
 *
 * // Safe wrapper for possibly-null amounts
 * formatTokenSafe(null, 7);                              // "—"
 * formatTokenSafe(10_000_000n, 7, { locale: 'en-US' }); // "1"
 *
 * // Unavailable placeholder
 * formatUnavailable('XLM'); // "— XLM"
 * ```
 *
 * Issue #1048 – Add locale-aware token formatting
 */

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Options for locale-aware token formatting.
 */
export interface TokenFormatOptions {
  /**
   * BCP 47 locale tag used by Intl.NumberFormat (default: 'en-US').
   * Examples: 'en-US', 'de-DE', 'fr-FR', 'ja-JP'
   */
  locale?: string;

  /**
   * Maximum number of fraction digits to display (default: token's decimals).
   * Clamps the displayed precision without affecting the underlying bigint.
   */
  maximumFractionDigits?: number;

  /**
   * Minimum number of fraction digits to display (default: 0).
   * Set equal to maximumFractionDigits to force a fixed width.
   */
  minimumFractionDigits?: number;

  /**
   * Intl.NumberFormat notation style (default: 'standard').
   * 'compact' produces short-form output like "1.5M" or "2K".
   */
  notation?: "standard" | "compact";

  /**
   * When true, strips trailing zeros from the fractional part (default: true).
   * Only applies to 'standard' notation; compact notation manages its own
   * digit trimming via Intl.
   */
  trimTrailing?: boolean;
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

/** Cached bigint multipliers indexed by decimal count. */
const MULTIPLIER_CACHE: Record<number, bigint> = {};

function getMultiplier(decimals: number): bigint {
  if (MULTIPLIER_CACHE[decimals] === undefined) {
    MULTIPLIER_CACHE[decimals] = 10n ** BigInt(decimals);
  }
  return MULTIPLIER_CACHE[decimals];
}

/**
 * Convert a raw bigint amount to a JavaScript number suitable for
 * Intl.NumberFormat, preserving up to `decimals` places of precision.
 *
 * For very large values beyond Number.MAX_SAFE_INTEGER the conversion may
 * lose integer-part precision; the fractional part is always preserved.
 */
function bigintToNumber(amount: bigint, decimals: number): number {
  if (decimals === 0) {
    return Number(amount);
  }
  const multiplier = getMultiplier(decimals);
  const whole = amount / multiplier;
  const frac = amount % multiplier;
  // Build as string then parse to avoid floating-point intermediate errors
  const fracStr = frac.toString().padStart(decimals, "0");
  return parseFloat(`${whole}.${fracStr}`);
}

/** EM dash used as the canonical unavailable-value placeholder. */
const EM_DASH = "\u2014";

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Format a raw token amount (in the token's smallest unit) as a
 * locale-aware human-readable string using Intl.NumberFormat.
 *
 * The on-chain bigint is never mutated; only the display string is affected.
 *
 * @param amount   - Raw amount in token's smallest unit (e.g. stroops for XLM).
 * @param decimals - Number of decimal places for this token.
 * @param options  - Optional locale and display options.
 * @returns Locale-formatted number string.
 *
 * @example
 * ```ts
 * formatTokenLocale(1_000_000_000n, 7)                        // "100"
 * formatTokenLocale(1_500_000n, 6, { locale: 'de-DE' })       // "1,5"
 * formatTokenLocale(1_500_000_000n, 6, { notation: 'compact' }) // "1.5K"
 * ```
 */
export function formatTokenLocale(
  amount: bigint,
  decimals: number,
  options?: TokenFormatOptions,
): string {
  const {
    locale = "en-US",
    maximumFractionDigits = decimals,
    minimumFractionDigits = 0,
    notation = "standard",
    trimTrailing = true,
  } = options ?? {};

  if (decimals < 0) {
    throw new Error(`formatTokenLocale: invalid decimals ${decimals}`);
  }

  // Convert bigint → number for Intl
  const numeric = bigintToNumber(amount, decimals);

  try {
    const formatted = new Intl.NumberFormat(locale, {
      notation,
      maximumFractionDigits: Math.min(maximumFractionDigits, 20),
      minimumFractionDigits,
    }).format(numeric);

    // For standard notation, optionally strip trailing zeros that Intl may
    // leave in (when minimumFractionDigits > 0 this is intentional).
    if (notation === "standard" && trimTrailing && minimumFractionDigits === 0) {
      // Remove trailing zeros after the decimal separator; use a locale-
      // agnostic approach by stripping the numeric chars at the end.
      // We strip ASCII decimal-point trailing zeros; for non-ASCII separators
      // (e.g. ',' in de-DE) Intl itself does the right thing.
      return formatted.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    }

    return formatted;
  } catch {
    // Intl unavailable (very old environment) – fall back to plain string
    const num = bigintToNumber(amount, decimals);
    const str = num.toFixed(maximumFractionDigits);
    if (trimTrailing && minimumFractionDigits === 0) {
      return str.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
    }
    return str;
  }
}

/**
 * Format a raw token amount and append the token symbol.
 *
 * @param amount   - Raw amount in token's smallest unit.
 * @param decimals - Number of decimal places for this token.
 * @param symbol   - Token ticker symbol (e.g. "USDC", "XLM").
 *                   Pass an empty string to omit the symbol.
 * @param options  - Optional locale and display options.
 * @returns Formatted string like `"1.5 USDC"` or just `"1.5"` if symbol is empty.
 *
 * @example
 * ```ts
 * formatTokenWithLocaleSymbol(1_500_000n, 6, 'USDC') // "1.5 USDC"
 * formatTokenWithLocaleSymbol(1_500_000n, 6, '')     // "1.5"
 * ```
 */
export function formatTokenWithLocaleSymbol(
  amount: bigint,
  decimals: number,
  symbol: string,
  options?: TokenFormatOptions,
): string {
  const formatted = formatTokenLocale(amount, decimals, options);
  return symbol.trim() ? `${formatted} ${symbol.trim()}` : formatted;
}

/**
 * Return a standardised placeholder for unavailable or not-yet-loaded values.
 *
 * @param label - Optional suffix appended after the em dash (e.g. a token symbol).
 * @returns `"—"` or `"— XLM"` when a label is provided.
 *
 * @example
 * ```ts
 * formatUnavailable()       // "—"
 * formatUnavailable('XLM')  // "— XLM"
 * ```
 */
export function formatUnavailable(label?: string): string {
  if (label && label.trim()) {
    return `${EM_DASH} ${label.trim()}`;
  }
  return EM_DASH;
}

/**
 * Safe wrapper around `formatTokenLocale` that handles `null` and `undefined`
 * amounts by returning a fallback placeholder instead of throwing.
 *
 * This is the **primary formatting function** for UI components that receive
 * amounts which may not yet be available (e.g. during loading or after an
 * RPC error).
 *
 * @param amount   - Raw amount in token's smallest unit, or `null`/`undefined`.
 * @param decimals - Number of decimal places for this token.
 * @param options  - Optional locale, display, and fallback options.
 * @returns Locale-formatted string, or `options.fallback` / `"—"` if amount is absent.
 *
 * @example
 * ```ts
 * formatTokenSafe(null,         7)                        // "—"
 * formatTokenSafe(undefined,    7, { fallback: 'N/A' })   // "N/A"
 * formatTokenSafe(10_000_000n,  7, { locale: 'en-US' })   // "1"
 * ```
 */
export function formatTokenSafe(
  amount: bigint | null | undefined,
  decimals: number,
  options?: TokenFormatOptions & { fallback?: string },
): string {
  if (amount === null || amount === undefined) {
    return options?.fallback ?? formatUnavailable();
  }
  // Strip the `fallback` key before passing to formatTokenLocale
  const { fallback: _fallback, ...formatOptions } = options ?? {};
  return formatTokenLocale(amount, decimals, formatOptions);
}
