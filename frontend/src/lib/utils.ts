/**
 * utils.ts
 *
 * Shared frontend utility functions:
 *   - Address display helpers
 *   - Stroop ↔ token unit conversions
 *   - Event type decoding
 *   - Interval formatting
 *
 * Issue #433 – Frontend unit tests with Jest and RTL
 */

// ── Known Soroban event type symbols ────────────────────────────────────────

const KNOWN_EVENT_TYPES = new Set([
  'subscribe',
  'executed',
  'cancel',
  'payment_transfer_failure',
] as const);

type KnownEventType = 'subscribe' | 'executed' | 'cancel' | 'payment_transfer_failure';
type EventType = KnownEventType | 'unknown';

// ── Address helpers ──────────────────────────────────────────────────────────

/**
 * Truncate a Stellar address for display.
 *
 * @param address  Full Stellar G- or C-address.
 * @param len      Number of characters to keep at each end (default: 4).
 * @returns        Truncated address like "GABC…WXYZ", or the original if
 *                 it is shorter than 2 * len.
 *
 * @example
 *   truncateAddress('GABC...XYZ')       // 'GABC…WXYZ'
 *   truncateAddress('GABC...XYZ', 6)    // 'GABC12…STUVWX'
 */
export function truncateAddress(address: string, len = 4): string {
  if (!address) return '';
  if (address.length <= len * 2) return address;
  return `${address.slice(0, len)}…${address.slice(-len)}`;
}

// ── Stroop ↔ token unit conversions ─────────────────────────────────────────

const STROOPS_PER_TOKEN = 10_000_000n;

/**
 * Convert a stroop amount (i128 represented as BigInt) to a human-readable
 * token string with 7 decimal places.
 *
 * @example
 *   stroopsToTokens(10_000_000n)  // '1.0000000'
 *   stroopsToTokens(1n)           // '0.0000001'
 */
export function stroopsToTokens(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_TOKEN;
  const fractional = stroops % STROOPS_PER_TOKEN;
  const frac = fractional.toString().padStart(7, '0');
  return `${whole}.${frac}`;
}

/**
 * Convert a token amount (positive integer) to stroops as a BigInt.
 *
 * @example
 *   tokensToStroops(1)    // 10_000_000n
 *   tokensToStroops(100)  // 1_000_000_000n
 */
export function tokensToStroops(tokens: number): bigint {
  return BigInt(tokens) * STROOPS_PER_TOKEN;
}

// ── Event type decoding ──────────────────────────────────────────────────────

/**
 * Decode a raw event type string from a Soroban event topic.
 *
 * Returns the event type if it is one of the four known SorobanPay types,
 * or "unknown" for anything else.
 *
 * @example
 *   decodeEventType('subscribe')  // 'subscribe'
 *   decodeEventType('foo')        // 'unknown'
 */
export function decodeEventType(raw: string): EventType {
  if ((KNOWN_EVENT_TYPES as Set<string>).has(raw)) {
    return raw as KnownEventType;
  }
  return 'unknown';
}

// ── Interval formatting ──────────────────────────────────────────────────────

const SECONDS_PER_DAY = 86_400;

/**
 * Format a payment interval (in seconds) as a human-readable string.
 *
 * Converts whole-day multiples to "N day(s)"; sub-day values are rendered
 * as raw seconds.
 *
 * @example
 *   formatInterval(86400)    // '1 day'
 *   formatInterval(172800)   // '2 days'
 *   formatInterval(2592000)  // '30 days'
 *   formatInterval(3600)     // '3600 seconds'
 */
export function formatInterval(seconds: number): string {
  if (seconds >= SECONDS_PER_DAY && seconds % SECONDS_PER_DAY === 0) {
    const days = seconds / SECONDS_PER_DAY;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  return `${seconds} seconds`;
}
