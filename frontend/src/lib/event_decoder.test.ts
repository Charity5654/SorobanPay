/**
 * event_decoder.test.ts
 *
 * Unit tests for the SorobanPay event decoder helper.
 *
 * Tests verify that decodeContractEvent and decodeContractEvents correctly
 * parse base64-encoded XDR topics/data from the Soroban RPC getEvents
 * response into strongly-typed DecodedContractEvent objects.
 *
 * Issue #44 — Add support for typed contract event decoding
 */

import {
  xdr,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';
import {
  decodeContractEvent,
  decodeContractEvents,
  isSubscribeEvent,
  isExecutedEvent,
  isPaymentFailureEvent,
  isCancelEvent,
  CANCEL_REASON,
  CANCEL_REASON_LABEL,
  type RawSorobanEvent,
  type DecodedContractEvent,
} from './event_decoder';

// ─── Test addresses (valid StrKey-encoded) ─────────────────────────────────────

const SUBSCRIBER = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const MERCHANT = 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
const TOKEN = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const ADMIN = 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';

// ─── ScVal encoding helpers ────────────────────────────────────────────────────

function symbolVal(s: string): string {
  return nativeToScVal(s, { type: 'symbol' }).toXDR('base64');
}

function addressVal(addr: string): string {
  return new Address(addr).toScVal().toXDR('base64');
}

function i128Val(n: bigint): string {
  return nativeToScVal(n, { type: 'i128' }).toXDR('base64');
}

function u64Val(n: bigint): string {
  return nativeToScVal(n, { type: 'u64' }).toXDR('base64');
}

function u32Val(n: number): string {
  return nativeToScVal(n, { type: 'u32' }).toXDR('base64');
}

function voidVal(): string {
  return xdr.ScVal.scvVoid().toXDR('base64');
}

/** Encode a two-element tuple (as a Vec ScVal) — used for data fields like (amount, nonce) */
function tupleVal(a: xdr.ScVal, b: xdr.ScVal): string {
  return xdr.ScVal.scvVec([a, b]).toXDR('base64');
}

// ─── subscribe event ──────────────────────────────────────────────────────────

describe('decodeContractEvent: subscribe', () => {
  const raw: RawSorobanEvent = {
    topic: [
      symbolVal('subscribe'),
      addressVal(SUBSCRIBER),
      addressVal(MERCHANT),
      addressVal(TOKEN),
    ],
    value: i128Val(1000n),
  };

  it('decodes type as "subscribe"', () => {
    expect(decodeContractEvent(raw).type).toBe('subscribe');
  });

  it('decodes subscriber address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'subscribe') throw new Error('wrong type');
    expect(e.subscriber).toBe(SUBSCRIBER);
  });

  it('decodes merchant address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'subscribe') throw new Error('wrong type');
    expect(e.merchant).toBe(MERCHANT);
  });

  it('decodes token address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'subscribe') throw new Error('wrong type');
    expect(e.token).toBe(TOKEN);
  });

  it('decodes amount as bigint', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'subscribe') throw new Error('wrong type');
    expect(e.amount).toBe(1000n);
  });

  it('isSubscribeEvent type guard returns true', () => {
    expect(isSubscribeEvent(decodeContractEvent(raw))).toBe(true);
  });

  it('isExecutedEvent returns false for subscribe event', () => {
    expect(isExecutedEvent(decodeContractEvent(raw))).toBe(false);
  });
});

// ─── executed event ────────────────────────────────────────────────────────────

describe('decodeContractEvent: executed', () => {
  const raw: RawSorobanEvent = {
    topic: [
      symbolVal('executed'),
      addressVal(SUBSCRIBER),
      addressVal(MERCHANT),
      addressVal(TOKEN),
    ],
    value: tupleVal(
      nativeToScVal(5000n, { type: 'i128' }),
      nativeToScVal(3n, { type: 'u64' }),
    ),
  };

  it('decodes type as "executed"', () => {
    expect(decodeContractEvent(raw).type).toBe('executed');
  });

  it('decodes subscriber address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'executed') throw new Error('wrong type');
    expect(e.subscriber).toBe(SUBSCRIBER);
  });

  it('decodes merchant address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'executed') throw new Error('wrong type');
    expect(e.merchant).toBe(MERCHANT);
  });

  it('decodes token address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'executed') throw new Error('wrong type');
    expect(e.token).toBe(TOKEN);
  });

  it('decodes amount as bigint', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'executed') throw new Error('wrong type');
    expect(e.amount).toBe(5000n);
  });

  it('decodes nonce as bigint', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'executed') throw new Error('wrong type');
    expect(e.nonce).toBe(3n);
  });

  it('isExecutedEvent type guard returns true', () => {
    expect(isExecutedEvent(decodeContractEvent(raw))).toBe(true);
  });
});

// ─── payment_transfer_failure event ───────────────────────────────────────────

describe('decodeContractEvent: payment_transfer_failure', () => {
  const OVERDUE_SINCE = 1700000000n;
  const raw: RawSorobanEvent = {
    topic: [
      symbolVal('payment_transfer_failure'),
      addressVal(SUBSCRIBER),
      addressVal(MERCHANT),
    ],
    value: tupleVal(
      nativeToScVal(2500n, { type: 'i128' }),
      nativeToScVal(OVERDUE_SINCE, { type: 'u64' }),
    ),
  };

  it('decodes type as "payment_transfer_failure"', () => {
    expect(decodeContractEvent(raw).type).toBe('payment_transfer_failure');
  });

  it('decodes subscriber address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'payment_transfer_failure') throw new Error('wrong type');
    expect(e.subscriber).toBe(SUBSCRIBER);
  });

  it('decodes merchant address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'payment_transfer_failure') throw new Error('wrong type');
    expect(e.merchant).toBe(MERCHANT);
  });

  it('decodes amount as bigint', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'payment_transfer_failure') throw new Error('wrong type');
    expect(e.amount).toBe(2500n);
  });

  it('decodes overdueSince as bigint', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'payment_transfer_failure') throw new Error('wrong type');
    expect(e.overdueSince).toBe(OVERDUE_SINCE);
  });

  it('isPaymentFailureEvent type guard returns true', () => {
    expect(isPaymentFailureEvent(decodeContractEvent(raw))).toBe(true);
  });
});

// ─── payment_transfer_success event ───────────────────────────────────────────

describe('decodeContractEvent: payment_transfer_success', () => {
  const raw: RawSorobanEvent = {
    topic: [
      symbolVal('payment_transfer_success'),
      addressVal(SUBSCRIBER),
      addressVal(MERCHANT),
    ],
    value: i128Val(750n),
  };

  it('decodes type as "payment_transfer_success"', () => {
    expect(decodeContractEvent(raw).type).toBe('payment_transfer_success');
  });

  it('decodes subscriber address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'payment_transfer_success') throw new Error('wrong type');
    expect(e.subscriber).toBe(SUBSCRIBER);
  });

  it('decodes merchant address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'payment_transfer_success') throw new Error('wrong type');
    expect(e.merchant).toBe(MERCHANT);
  });

  it('decodes amount as bigint', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'payment_transfer_success') throw new Error('wrong type');
    expect(e.amount).toBe(750n);
  });
});

// ─── cancel event ─────────────────────────────────────────────────────────────

describe('decodeContractEvent: cancel', () => {
  const raw: RawSorobanEvent = {
    topic: [
      symbolVal('cancel'),
      addressVal(SUBSCRIBER),
      addressVal(MERCHANT),
    ],
    value: u32Val(CANCEL_REASON.SUBSCRIBER_VOLUNTARY),
  };

  it('decodes type as "cancel"', () => {
    expect(decodeContractEvent(raw).type).toBe('cancel');
  });

  it('decodes subscriber address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'cancel') throw new Error('wrong type');
    expect(e.subscriber).toBe(SUBSCRIBER);
  });

  it('decodes merchant address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'cancel') throw new Error('wrong type');
    expect(e.merchant).toBe(MERCHANT);
  });

  it('decodes reason code as number', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'cancel') throw new Error('wrong type');
    expect(e.reason).toBe(CANCEL_REASON.SUBSCRIBER_VOLUNTARY);
  });

  it('decodes reasonLabel for subscriber_voluntary', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'cancel') throw new Error('wrong type');
    expect(e.reasonLabel).toBe('Subscriber voluntary');
  });

  it('decodes reason code 2 (merchant_initiated) correctly', () => {
    const e = decodeContractEvent({
      topic: [symbolVal('cancel'), addressVal(SUBSCRIBER), addressVal(MERCHANT)],
      value: u32Val(CANCEL_REASON.MERCHANT_INITIATED),
    });
    if (e.type !== 'cancel') throw new Error('wrong type');
    expect(e.reason).toBe(2);
    expect(e.reasonLabel).toBe('Merchant initiated');
  });

  it('decodes reason code 3 (grace_period_expired) correctly', () => {
    const e = decodeContractEvent({
      topic: [symbolVal('cancel'), addressVal(SUBSCRIBER), addressVal(MERCHANT)],
      value: u32Val(CANCEL_REASON.GRACE_PERIOD_EXPIRED),
    });
    if (e.type !== 'cancel') throw new Error('wrong type');
    expect(e.reasonLabel).toBe('Grace period expired');
  });

  it('decodes reason code 4 (admin_forced) correctly', () => {
    const e = decodeContractEvent({
      topic: [symbolVal('cancel'), addressVal(SUBSCRIBER), addressVal(MERCHANT)],
      value: u32Val(CANCEL_REASON.ADMIN_FORCED),
    });
    if (e.type !== 'cancel') throw new Error('wrong type');
    expect(e.reasonLabel).toBe('Admin forced');
  });

  it('returns fallback label for unknown reason code', () => {
    const e = decodeContractEvent({
      topic: [symbolVal('cancel'), addressVal(SUBSCRIBER), addressVal(MERCHANT)],
      value: u32Val(99),
    });
    if (e.type !== 'cancel') throw new Error('wrong type');
    expect(e.reasonLabel).toMatch(/unknown/i);
  });

  it('isCancelEvent type guard returns true', () => {
    expect(isCancelEvent(decodeContractEvent(raw))).toBe(true);
  });
});

// ─── expired event ─────────────────────────────────────────────────────────────

describe('decodeContractEvent: expired', () => {
  const raw: RawSorobanEvent = {
    topic: [
      symbolVal('expired'),
      addressVal(SUBSCRIBER),
      addressVal(MERCHANT),
    ],
    value: voidVal(),
  };

  it('decodes type as "expired"', () => {
    expect(decodeContractEvent(raw).type).toBe('expired');
  });

  it('decodes subscriber address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'expired') throw new Error('wrong type');
    expect(e.subscriber).toBe(SUBSCRIBER);
  });

  it('decodes merchant address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'expired') throw new Error('wrong type');
    expect(e.merchant).toBe(MERCHANT);
  });
});

// ─── low_allowance event ───────────────────────────────────────────────────────

describe('decodeContractEvent: low_allowance', () => {
  const raw: RawSorobanEvent = {
    topic: [
      symbolVal('low_allowance'),
      addressVal(SUBSCRIBER),
      addressVal(MERCHANT),
      addressVal(TOKEN),
    ],
    value: tupleVal(
      nativeToScVal(100n, { type: 'i128' }),
      nativeToScVal(500n, { type: 'i128' }),
    ),
  };

  it('decodes type as "low_allowance"', () => {
    expect(decodeContractEvent(raw).type).toBe('low_allowance');
  });

  it('decodes token address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'low_allowance') throw new Error('wrong type');
    expect(e.token).toBe(TOKEN);
  });

  it('decodes allowance as bigint', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'low_allowance') throw new Error('wrong type');
    expect(e.allowance).toBe(100n);
  });

  it('decodes required as bigint', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'low_allowance') throw new Error('wrong type');
    expect(e.required).toBe(500n);
  });
});

// ─── batch_execute_initiated event ────────────────────────────────────────────

describe('decodeContractEvent: batch_execute_initiated', () => {
  const raw: RawSorobanEvent = {
    topic: [symbolVal('batch_execute_initiated'), addressVal(MERCHANT)],
    value: i128Val(10n),
  };

  it('decodes type as "batch_execute_initiated"', () => {
    expect(decodeContractEvent(raw).type).toBe('batch_execute_initiated');
  });

  it('decodes merchant address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'batch_execute_initiated') throw new Error('wrong type');
    expect(e.merchant).toBe(MERCHANT);
  });

  it('decodes batchSize as number', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'batch_execute_initiated') throw new Error('wrong type');
    expect(e.batchSize).toBe(10);
  });
});

// ─── contract_migrated event ───────────────────────────────────────────────────

describe('decodeContractEvent: contract_migrated', () => {
  const raw: RawSorobanEvent = {
    topic: [symbolVal('contract_migrated'), addressVal(ADMIN)],
    value: i128Val(2n),
  };

  it('decodes type as "contract_migrated"', () => {
    expect(decodeContractEvent(raw).type).toBe('contract_migrated');
  });

  it('decodes admin address', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'contract_migrated') throw new Error('wrong type');
    expect(e.admin).toBe(ADMIN);
  });

  it('decodes newVersion as number', () => {
    const e = decodeContractEvent(raw);
    if (e.type !== 'contract_migrated') throw new Error('wrong type');
    expect(e.newVersion).toBe(2);
  });
});

// ─── unknown / malformed events ───────────────────────────────────────────────

describe('decodeContractEvent: unknown and malformed events', () => {
  it('returns type "unknown" for an unrecognised event type symbol', () => {
    const e = decodeContractEvent({
      topic: [symbolVal('some_future_event'), addressVal(SUBSCRIBER)],
      value: voidVal(),
    });
    expect(e.type).toBe('unknown');
  });

  it('unknown event contains the rawType string', () => {
    const e = decodeContractEvent({
      topic: [symbolVal('some_future_event'), addressVal(SUBSCRIBER)],
      value: voidVal(),
    });
    if (e.type !== 'unknown') throw new Error('expected unknown');
    expect(e.rawType).toBe('some_future_event');
  });

  it('returns unknown for empty topic array', () => {
    expect(decodeContractEvent({ topic: [], value: voidVal() }).type).toBe('unknown');
  });

  it('returns unknown for invalid XDR in first topic', () => {
    expect(
      decodeContractEvent({ topic: ['not-valid-base64!!!'], value: voidVal() }).type,
    ).toBe('unknown');
  });

  it('does not throw for malformed data field', () => {
    // subscribe event but data is void instead of i128 — should return unknown gracefully
    const e = decodeContractEvent({
      topic: [
        symbolVal('subscribe'),
        addressVal(SUBSCRIBER),
        addressVal(MERCHANT),
        addressVal(TOKEN),
      ],
      value: voidVal(),
    });
    // graceful fallback — should not throw
    expect(['subscribe', 'unknown']).toContain(e.type);
  });
});

// ─── decodeContractEvents (batch) ─────────────────────────────────────────────

describe('decodeContractEvents', () => {
  const subscribeRaw: RawSorobanEvent = {
    topic: [
      symbolVal('subscribe'),
      addressVal(SUBSCRIBER),
      addressVal(MERCHANT),
      addressVal(TOKEN),
    ],
    value: i128Val(1000n),
  };

  const executedRaw: RawSorobanEvent = {
    topic: [
      symbolVal('executed'),
      addressVal(SUBSCRIBER),
      addressVal(MERCHANT),
      addressVal(TOKEN),
    ],
    value: tupleVal(
      nativeToScVal(1000n, { type: 'i128' }),
      nativeToScVal(1n, { type: 'u64' }),
    ),
  };

  const unknownRaw: RawSorobanEvent = {
    topic: [symbolVal('future_event')],
    value: voidVal(),
  };

  it('decodes an array of mixed events', () => {
    const results = decodeContractEvents([subscribeRaw, executedRaw]);
    expect(results).toHaveLength(2);
    expect(results[0].type).toBe('subscribe');
    expect(results[1].type).toBe('executed');
  });

  it('filters out unknown events', () => {
    const results = decodeContractEvents([subscribeRaw, unknownRaw, executedRaw]);
    expect(results).toHaveLength(2);
    // All results are known event types (the return type already excludes UnknownEvent)
    expect(results.map((e) => e.type)).not.toContain('unknown');
  });

  it('returns empty array for empty input', () => {
    expect(decodeContractEvents([])).toEqual([]);
  });

  it('returns empty array when all events are unknown', () => {
    expect(decodeContractEvents([unknownRaw, unknownRaw])).toHaveLength(0);
  });
});

// ─── CANCEL_REASON constants ──────────────────────────────────────────────────

describe('CANCEL_REASON constants', () => {
  it('SUBSCRIBER_VOLUNTARY is 1', () => {
    expect(CANCEL_REASON.SUBSCRIBER_VOLUNTARY).toBe(1);
  });

  it('MERCHANT_INITIATED is 2', () => {
    expect(CANCEL_REASON.MERCHANT_INITIATED).toBe(2);
  });

  it('GRACE_PERIOD_EXPIRED is 3', () => {
    expect(CANCEL_REASON.GRACE_PERIOD_EXPIRED).toBe(3);
  });

  it('ADMIN_FORCED is 4', () => {
    expect(CANCEL_REASON.ADMIN_FORCED).toBe(4);
  });
});

// ─── CANCEL_REASON_LABEL ──────────────────────────────────────────────────────

describe('CANCEL_REASON_LABEL', () => {
  it('maps all four reason codes to non-empty strings', () => {
    [1, 2, 3, 4].forEach((code) => {
      expect(CANCEL_REASON_LABEL[code]).toBeTruthy();
    });
  });
});
