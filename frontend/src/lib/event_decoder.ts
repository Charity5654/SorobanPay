/**
 * event_decoder.ts
 *
 * Decodes Soroban contract events emitted by the SorobanPay subscription
 * protocol into strongly-typed TypeScript objects.
 *
 * Supported event types (matching contracts/subscription/src/events.rs):
 *
 *   subscribe          — Topics: (symbol, subscriber, merchant, token)   Data: amount (i128)
 *   executed           — Topics: (symbol, subscriber, merchant, token)   Data: (amount i128, nonce u64)
 *   payment_transfer_failure — Topics: (symbol, subscriber, merchant)    Data: (amount i128, overdue_since u64)
 *   payment_transfer_success — Topics: (symbol, subscriber, merchant)    Data: amount (i128)
 *   cancel             — Topics: (symbol, subscriber, merchant)          Data: reason (u32)
 *   expired            — Topics: (symbol, subscriber, merchant)          Data: ()
 *   low_allowance      — Topics: (symbol, subscriber, merchant, token)   Data: (allowance i128, required i128)
 *   batch_execute_initiated — Topics: (symbol, merchant)                 Data: batch_size (i128)
 *   contract_migrated  — Topics: (symbol, admin)                         Data: new_version (i128)
 *
 * Usage:
 *   import { decodeContractEvent } from '@/lib/event_decoder';
 *   const event = decodeContractEvent(rawEvent);
 *   if (event.type === 'subscribe') { ... event.amount ... }
 *
 * Issue #44 — Add support for typed contract event decoding
 */

import { xdr, scValToNative } from '@stellar/stellar-sdk';

// ─── Cancel reason codes (mirrors events.rs) ─────────────────────────────────

/** Authoritative on-chain cancellation reason codes emitted in the `cancel` event. */
export const CANCEL_REASON = {
  /** Subscriber voluntarily terminated the subscription */
  SUBSCRIBER_VOLUNTARY: 1,
  /** Merchant initiated the cancellation */
  MERCHANT_INITIATED: 2,
  /** Subscription ended after an unpaid grace period */
  GRACE_PERIOD_EXPIRED: 3,
  /** Administrative or governance removal */
  ADMIN_FORCED: 4,
} as const;

export type CancelReason = (typeof CANCEL_REASON)[keyof typeof CANCEL_REASON];

/** Human-readable label for each cancel reason code */
export const CANCEL_REASON_LABEL: Record<number, string> = {
  [CANCEL_REASON.SUBSCRIBER_VOLUNTARY]: 'Subscriber voluntary',
  [CANCEL_REASON.MERCHANT_INITIATED]: 'Merchant initiated',
  [CANCEL_REASON.GRACE_PERIOD_EXPIRED]: 'Grace period expired',
  [CANCEL_REASON.ADMIN_FORCED]: 'Admin forced',
};

// ─── Decoded event union ──────────────────────────────────────────────────────

export interface SubscribeEvent {
  type: 'subscribe';
  subscriber: string;
  merchant: string;
  token: string;
  /** Payment amount in the token's smallest unit (stroops for XLM-based tokens) */
  amount: bigint;
}

export interface ExecutedEvent {
  type: 'executed';
  subscriber: string;
  merchant: string;
  token: string;
  /** Payment amount transferred */
  amount: bigint;
  /** Monotonically increasing per-subscription payment counter */
  nonce: bigint;
}

export interface PaymentTransferFailureEvent {
  type: 'payment_transfer_failure';
  subscriber: string;
  merchant: string;
  /** Amount that failed to transfer */
  amount: bigint;
  /** Ledger timestamp when the subscription first became overdue */
  overdueSince: bigint;
}

export interface PaymentTransferSuccessEvent {
  type: 'payment_transfer_success';
  subscriber: string;
  merchant: string;
  /** Amount successfully transferred */
  amount: bigint;
}

export interface CancelEvent {
  type: 'cancel';
  subscriber: string;
  merchant: string;
  /** Numeric reason code — use CANCEL_REASON constants for comparison */
  reason: number;
  /** Human-readable label for the reason code */
  reasonLabel: string;
}

export interface ExpiredEvent {
  type: 'expired';
  subscriber: string;
  merchant: string;
}

export interface LowAllowanceEvent {
  type: 'low_allowance';
  subscriber: string;
  merchant: string;
  token: string;
  /** Current approved allowance */
  allowance: bigint;
  /** Required allowance for the subscription amount */
  required: bigint;
}

export interface BatchExecuteInitiatedEvent {
  type: 'batch_execute_initiated';
  merchant: string;
  /** Number of subscribers in the batch */
  batchSize: number;
}

export interface ContractMigratedEvent {
  type: 'contract_migrated';
  admin: string;
  /** New schema version after migration */
  newVersion: number;
}

export interface UnknownEvent {
  type: 'unknown';
  /** Raw event type string extracted from the first topic */
  rawType: string;
}

export type DecodedContractEvent =
  | SubscribeEvent
  | ExecutedEvent
  | PaymentTransferFailureEvent
  | PaymentTransferSuccessEvent
  | CancelEvent
  | ExpiredEvent
  | LowAllowanceEvent
  | BatchExecuteInitiatedEvent
  | ContractMigratedEvent
  | UnknownEvent;

// ─── Raw event shape from Soroban RPC ────────────────────────────────────────

/**
 * Minimal representation of a raw event returned by the Soroban RPC
 * `getEvents` endpoint.  Each topic and the value are base64-encoded XDR.
 */
export interface RawSorobanEvent {
  /** Array of base64-encoded XDR ScVal topics */
  topic: string[];
  /** Base64-encoded XDR ScVal data value */
  value: string;
}

// ─── Decode helpers ───────────────────────────────────────────────────────────

/**
 * Decode a single base64-encoded XDR ScVal to its native JavaScript equivalent.
 * Returns `null` if decoding fails rather than throwing.
 */
function decodeScVal(base64: string): unknown {
  try {
    return scValToNative(xdr.ScVal.fromXDR(base64, 'base64'));
  } catch {
    return null;
  }
}

/**
 * Safely convert a decoded value to BigInt.
 * Handles number, string, bigint, and xdr.Int128Parts instances.
 */
function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(Math.trunc(value));
  if (typeof value === 'string') return BigInt(value);
  throw new TypeError(`Cannot convert ${typeof value} to BigInt: ${String(value)}`);
}

/**
 * Safely convert a decoded value to a number.
 */
function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'string') return Number(value);
  throw new TypeError(`Cannot convert ${typeof value} to number: ${String(value)}`);
}

/**
 * Safely convert a decoded ScVal to a string address.
 * scValToNative returns the raw string for Address types.
 */
function toAddress(value: unknown): string {
  if (typeof value === 'string') return value;
  throw new TypeError(`Expected string address, got ${typeof value}: ${String(value)}`);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Decode a raw Soroban RPC event into a typed {@link DecodedContractEvent}.
 *
 * Returns an `UnknownEvent` (rather than throwing) when the event type is
 * not recognised or if topic/data decoding fails, so consumers can safely
 * iterate over heterogeneous event streams without try/catch at the call site.
 *
 * @param raw - A raw event object from the Soroban RPC `getEvents` response.
 * @returns    A strongly-typed decoded event, or an `UnknownEvent` on failure.
 *
 * @example
 * ```ts
 * const event = decodeContractEvent(rawEvent);
 * if (event.type === 'subscribe') {
 *   console.log(event.subscriber, event.amount);
 * }
 * ```
 */
export function decodeContractEvent(raw: RawSorobanEvent): DecodedContractEvent {
  if (!raw.topic || raw.topic.length === 0) {
    return { type: 'unknown', rawType: '' };
  }

  const eventType = decodeScVal(raw.topic[0]);
  if (typeof eventType !== 'string') {
    return { type: 'unknown', rawType: String(eventType ?? '') };
  }

  try {
    switch (eventType) {
      case 'subscribe': {
        // Topics: (symbol, subscriber, merchant, token)  Data: amount i128
        const subscriber = toAddress(decodeScVal(raw.topic[1]));
        const merchant = toAddress(decodeScVal(raw.topic[2]));
        const token = toAddress(decodeScVal(raw.topic[3]));
        const amount = toBigInt(decodeScVal(raw.value));
        return { type: 'subscribe', subscriber, merchant, token, amount };
      }

      case 'executed': {
        // Topics: (symbol, subscriber, merchant, token)  Data: (amount i128, nonce u64)
        const subscriber = toAddress(decodeScVal(raw.topic[1]));
        const merchant = toAddress(decodeScVal(raw.topic[2]));
        const token = toAddress(decodeScVal(raw.topic[3]));
        const dataVal = decodeScVal(raw.value);
        // scValToNative maps a Tuple/Vec to an array
        const [rawAmount, rawNonce] = dataVal as [unknown, unknown];
        const amount = toBigInt(rawAmount);
        const nonce = toBigInt(rawNonce);
        return { type: 'executed', subscriber, merchant, token, amount, nonce };
      }

      case 'payment_transfer_failure': {
        // Topics: (symbol, subscriber, merchant)  Data: (amount i128, overdue_since u64)
        const subscriber = toAddress(decodeScVal(raw.topic[1]));
        const merchant = toAddress(decodeScVal(raw.topic[2]));
        const dataVal = decodeScVal(raw.value);
        const [rawAmount, rawOverdue] = dataVal as [unknown, unknown];
        const amount = toBigInt(rawAmount);
        const overdueSince = toBigInt(rawOverdue);
        return {
          type: 'payment_transfer_failure',
          subscriber,
          merchant,
          amount,
          overdueSince,
        };
      }

      case 'payment_transfer_success': {
        // Topics: (symbol, subscriber, merchant)  Data: amount i128
        const subscriber = toAddress(decodeScVal(raw.topic[1]));
        const merchant = toAddress(decodeScVal(raw.topic[2]));
        const amount = toBigInt(decodeScVal(raw.value));
        return { type: 'payment_transfer_success', subscriber, merchant, amount };
      }

      case 'cancel': {
        // Topics: (symbol, subscriber, merchant)  Data: reason u32
        const subscriber = toAddress(decodeScVal(raw.topic[1]));
        const merchant = toAddress(decodeScVal(raw.topic[2]));
        const reason = toNumber(decodeScVal(raw.value));
        const reasonLabel =
          CANCEL_REASON_LABEL[reason] ?? `Unknown reason (${reason})`;
        return { type: 'cancel', subscriber, merchant, reason, reasonLabel };
      }

      case 'expired': {
        // Topics: (symbol, subscriber, merchant)  Data: ()
        const subscriber = toAddress(decodeScVal(raw.topic[1]));
        const merchant = toAddress(decodeScVal(raw.topic[2]));
        return { type: 'expired', subscriber, merchant };
      }

      case 'low_allowance': {
        // Topics: (symbol, subscriber, merchant, token)  Data: (allowance i128, required i128)
        const subscriber = toAddress(decodeScVal(raw.topic[1]));
        const merchant = toAddress(decodeScVal(raw.topic[2]));
        const token = toAddress(decodeScVal(raw.topic[3]));
        const dataVal = decodeScVal(raw.value);
        const [rawAllowance, rawRequired] = dataVal as [unknown, unknown];
        const allowance = toBigInt(rawAllowance);
        const required = toBigInt(rawRequired);
        return { type: 'low_allowance', subscriber, merchant, token, allowance, required };
      }

      case 'batch_execute_initiated': {
        // Topics: (symbol, merchant)  Data: batch_size i128
        const merchant = toAddress(decodeScVal(raw.topic[1]));
        const batchSize = toNumber(decodeScVal(raw.value));
        return { type: 'batch_execute_initiated', merchant, batchSize };
      }

      case 'contract_migrated': {
        // Topics: (symbol, admin)  Data: new_version i128
        const admin = toAddress(decodeScVal(raw.topic[1]));
        const newVersion = toNumber(decodeScVal(raw.value));
        return { type: 'contract_migrated', admin, newVersion };
      }

      default:
        return { type: 'unknown', rawType: eventType };
    }
  } catch {
    return { type: 'unknown', rawType: eventType };
  }
}

/**
 * Decode an array of raw Soroban events, filtering to only successfully
 * recognised event types.  Unknown events are silently dropped.
 *
 * Useful when iterating over raw RPC results to extract only events
 * relevant to the SorobanPay subscription protocol.
 *
 * @param rawEvents - Array of raw events from `getEvents` RPC response.
 * @returns          Typed, recognised events (UnknownEvent entries excluded).
 */
export function decodeContractEvents(
  rawEvents: RawSorobanEvent[],
): Exclude<DecodedContractEvent, UnknownEvent>[] {
  return rawEvents
    .map(decodeContractEvent)
    .filter(
      (e): e is Exclude<DecodedContractEvent, UnknownEvent> => e.type !== 'unknown',
    );
}

/**
 * Type guard: narrows a {@link DecodedContractEvent} to {@link SubscribeEvent}.
 */
export function isSubscribeEvent(e: DecodedContractEvent): e is SubscribeEvent {
  return e.type === 'subscribe';
}

/**
 * Type guard: narrows a {@link DecodedContractEvent} to {@link ExecutedEvent}.
 */
export function isExecutedEvent(e: DecodedContractEvent): e is ExecutedEvent {
  return e.type === 'executed';
}

/**
 * Type guard: narrows a {@link DecodedContractEvent} to {@link PaymentTransferFailureEvent}.
 */
export function isPaymentFailureEvent(
  e: DecodedContractEvent,
): e is PaymentTransferFailureEvent {
  return e.type === 'payment_transfer_failure';
}

/**
 * Type guard: narrows a {@link DecodedContractEvent} to {@link CancelEvent}.
 */
export function isCancelEvent(e: DecodedContractEvent): e is CancelEvent {
  return e.type === 'cancel';
}
