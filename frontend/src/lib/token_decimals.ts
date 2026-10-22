"use client";

/**
 * token_decimals.ts
 *
 * Helper utilities for consistent token amount rendering across the app.
 * Handles both native Stellar tokens (7 decimals) and non-native tokens
 * with custom decimal configurations.
 *
 * Usage:
 * ```ts
 * // Format stroops to human-readable amount (7 decimals)
 * const display = formatTokenAmount(1_000_000n, 7); // "0.1"
 *
 * // Parse user input to smallest unit
 * const stroops = parseTokenAmount("100.5", 7); // 1_005_000_000n
 *
 * // Get decimals for known token
 * const decimals = getTokenDecimals("USDC"); // 6
 * ```
 */

// ─── Token Decimal Registry ────────────────────────────────────────────────────

/** Known tokens with their decimal places. Add entries as needed. */
const TOKEN_DECIMALS: Record<string, number> = {
  // Native Stellar tokens
  native: 7,
  XLM: 7,

  // Stablecoins
  USDC: 6,
  EURC: 6,

  // Other common tokens
  BTC: 7,
  ETH: 7,
};

/**
 * Get the decimal places for a token by symbol.
 * Returns 7 (native Stellar default) if token is unknown.
 *
 * @param symbol - Token symbol (case-insensitive, e.g. "USDC", "usdc")
 * @returns Number of decimal places for the token
 */
export function getTokenDecimals(symbol: string): number {
  return TOKEN_DECIMALS[symbol.toUpperCase()] ?? 7;
}

/**
 * Register a custom token with its decimal places.
 * Useful for dynamically added tokens.
 *
 * @param symbol - Token symbol
 * @param decimals - Number of decimal places
 */
export function registerToken(symbol: string, decimals: number): void {
  if (decimals < 0 || decimals > 19) {
    throw new Error(`Invalid decimals: ${decimals}. Must be between 0 and 19.`);
  }
  TOKEN_DECIMALS[symbol.toUpperCase()] = decimals;
}

// ─── Amount Formatting ─────────────────────────────────────────────────────────

/**
 * Calculate the multiplier (10^decimals) for a given decimal count.
 * Cached for performance.
 */
const DECIMAL_MULTIPLIERS: Record<number, bigint> = {};

function getDecimalMultiplier(decimals: number): bigint {
  if (!DECIMAL_MULTIPLIERS[decimals]) {
    DECIMAL_MULTIPLIERS[decimals] = 10n ** BigInt(decimals);
  }
  return DECIMAL_MULTIPLIERS[decimals];
}

/**
 * Format a raw token amount (in smallest unit) to a human-readable string.
 *
 * @param amount - Raw amount in smallest unit (e.g., stroops for XLM)
 * @param decimals - Number of decimal places for the token
 * @param options - Display options
 * @returns Formatted amount string (e.g., "100.0000000" for 7 decimals)
 *
 * @example
 * ```ts
 * formatTokenAmount(1_000_000_000n, 7) // "100.0000000"
 * formatTokenAmount(1_000_000n, 6)     // "1.000000"
 * formatTokenAmount(1n, 0)              // "1"
 * ```
 */
export function formatTokenAmount(
  amount: bigint,
  decimals: number,
  options?: {
    /** Pad with zeros (default: true) */
    padZeros?: boolean;
    /** Trim trailing zeros (default: false) */
    trimTrailing?: boolean;
  },
): string {
  const { padZeros = true, trimTrailing = false } = options || {};

  if (decimals < 0) {
    throw new Error(`Invalid decimals: ${decimals}`);
  }

  if (decimals === 0) {
    return amount.toString();
  }

  const multiplier = getDecimalMultiplier(decimals);
  const whole = amount / multiplier;
  const frac = amount % multiplier;

  // Format fractional part with leading zeros
  const fracStr = frac.toString().padStart(decimals, "0");

  // Build result
  let result = `${whole}.${fracStr}`;

  // Trim trailing zeros if requested
  if (trimTrailing) {
    result = result.replace(/\.?0+$/, "");
  }

  return result;
}

/**
 * Format a token amount with a token symbol appended.
 *
 * @param amount - Raw amount in smallest unit
 * @param decimals - Number of decimal places
 * @param symbol - Token symbol (optional, e.g., "USDC", "XLM")
 * @returns Formatted string with symbol (e.g., "100 USDC")
 *
 * @example
 * ```ts
 * formatTokenWithSymbol(1_000_000n, 6, "USDC") // "1 USDC"
 * formatTokenWithSymbol(7_000_000_000n, 7)     // "700"
 * ```
 */
export function formatTokenWithSymbol(
  amount: bigint,
  decimals: number,
  symbol?: string,
): string {
  const formatted = formatTokenAmount(amount, decimals, { trimTrailing: true });
  return symbol ? `${formatted} ${symbol}` : formatted;
}

// ─── Amount Parsing ────────────────────────────────────────────────────────────

/**
 * Parse a human-readable token amount string to the smallest unit (bigint).
 *
 * @param amountStr - User input (e.g., "100.5", "100", "0.0000001")
 * @param decimals - Number of decimal places for the token
 * @returns Raw amount in smallest unit, or null if invalid
 *
 * @example
 * ```ts
 * parseTokenAmount("100.5", 7)  // 1_005_000_000n (XLM)
 * parseTokenAmount("1.5", 6)    // 1_500_000n (USDC)
 * parseTokenAmount("abc", 7)    // null (invalid)
 * ```
 */
export function parseTokenAmount(amountStr: string, decimals: number): bigint | null {
  const trimmed = amountStr.trim();

  if (!trimmed || !/^[0-9]*\.?[0-9]*$/.test(trimmed)) {
    return null; // Invalid format
  }

  try {
    // Split into whole and fractional parts
    const [wholeStr = "0", fracStr = "0"] = trimmed.split(".");

    // Validate fractional part doesn't exceed decimals
    if (fracStr.length > decimals) {
      return null; // Too many decimal places
    }

    // Parse components
    const whole = BigInt(wholeStr || "0");
    const fracPadded = fracStr.padEnd(decimals, "0");
    const frac = BigInt(fracPadded);

    const multiplier = getDecimalMultiplier(decimals);
    return whole * multiplier + frac;
  } catch {
    return null; // Parse error
  }
}

/**
 * Safely parse a token amount, returning a default on error.
 *
 * @param amountStr - User input
 * @param decimals - Number of decimal places
 * @param defaultValue - Value to return if parsing fails (default: 0n)
 * @returns Parsed amount or default
 */
export function parseTokenAmountOrDefault(
  amountStr: string,
  decimals: number,
  defaultValue: bigint = 0n,
): bigint {
  return parseTokenAmount(amountStr, decimals) ?? defaultValue;
}

// ─── Amount Comparison ─────────────────────────────────────────────────────────

/**
 * Check if a parsed amount exceeds a maximum.
 *
 * @param amount - Raw amount in smallest unit
 * @param maxAmount - Maximum allowed amount
 * @returns true if amount <= maxAmount
 */
export function isAmountWithinLimit(amount: bigint, maxAmount: bigint): boolean {
  return amount <= maxAmount;
}

/**
 * Calculate the shortfall between a required and available amount.
 * Returns 0n if amount >= required.
 *
 * @param required - Required amount
 * @param available - Available amount
 * @returns Shortfall amount (0 if sufficient)
 */
export function calculateShortfall(required: bigint, available: bigint): bigint {
  return required > available ? required - available : 0n;
}

// ─── Precision Helpers ────────────────────────────────────────────────────────

/**
 * Round a token amount to a specific number of decimal places.
 * Truncates (floors) rather than rounding to nearest.
 *
 * @param amount - Raw amount in smallest unit
 * @param decimals - Current decimal places
 * @param newDecimals - Target decimal places to round to
 * @returns Rounded amount
 *
 * @example
 * ```ts
 * roundToDecimals(1_234_567n, 7, 6)  // 123_456n (truncate last digit)
 * ```
 */
export function roundToDecimals(
  amount: bigint,
  decimals: number,
  newDecimals: number,
): bigint {
  if (newDecimals > decimals) {
    // Expanding decimals - multiply up
    const diff = BigInt(newDecimals - decimals);
    return amount * (10n ** diff);
  } else if (newDecimals < decimals) {
    // Reducing decimals - divide down (truncate)
    const diff = BigInt(decimals - newDecimals);
    return amount / (10n ** diff);
  }
  return amount;
}

/**
 * Convert an amount between two decimal scales.
 *
 * @param amount - Raw amount in source decimals
 * @param fromDecimals - Source decimal places
 * @param toDecimals - Target decimal places
 * @returns Amount in target decimal scale
 *
 * @example
 * ```ts
 * convertDecimals(1_000_000n, 6, 7)  // 10_000_000n (USDC to XLM scale)
 * convertDecimals(10_000_000n, 7, 6) // 1_000_000n (XLM to USDC scale)
 * ```
 */
export function convertDecimals(
  amount: bigint,
  fromDecimals: number,
  toDecimals: number,
): bigint {
  if (fromDecimals === toDecimals) {
    return amount;
  }

  if (fromDecimals > toDecimals) {
    const diff = BigInt(fromDecimals - toDecimals);
    return amount / (10n ** diff);
  } else {
    const diff = BigInt(toDecimals - fromDecimals);
    return amount * (10n ** diff);
  }
}

// ─── Validation ────────────────────────────────────────────────────────────────

/**
 * Validate that an amount string is a valid positive number.
 *
 * @param amountStr - User input
 * @returns Error message, or null if valid
 */
export function validateAmountString(amountStr: string): string | null {
  const trimmed = amountStr.trim();

  if (!trimmed) {
    return "Amount is required";
  }

  if (!/^[0-9]*\.?[0-9]+$/.test(trimmed)) {
    return "Amount must be a positive number";
  }

  // Check for leading zeros (e.g., "00100" is suspicious but allowed)
  if (trimmed.startsWith("0") && trimmed.length > 1 && !trimmed.startsWith("0.")) {
    return "Amount should not have leading zeros";
  }

  return null;
}
