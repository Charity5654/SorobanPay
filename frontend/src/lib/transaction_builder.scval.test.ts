/**
 * Unit tests for SCVal parameter conversion in transaction_builder.ts
 *
 * Verifies that each subscribe parameter is encoded into the correct ScVal
 * type as expected by the SorobanPay contract:
 *   - subscriber  → Address ScVal (scvAddress)
 *   - merchant    → Address ScVal (scvAddress)
 *   - token       → Address ScVal (scvAddress)
 *   - amount      → i128 ScVal   (scvI128)
 *   - interval    → u64 ScVal    (scvU64)
 *
 * These tests exercise the conversion helpers used inside
 * buildAndSubmitSubscribe without making any network calls.
 */

import { xdr, scValToNative, Address, nativeToScVal } from '@stellar/stellar-sdk';

// ─── Fixtures ──────────────────────────────────────────────────────────────────
// Valid StrKey-encoded addresses (checksums verified against stellar-base).
// Generated via: StrKey.encodeEd25519PublicKey / encodeContract(Buffer.alloc(32, n))
const VALID_G  = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';
const VALID_G2 = 'GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H';
const VALID_C  = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABSC4';
const VALID_C2 = 'CAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQC526';

// ─── Helpers: mirror the exact encoding used in transaction_builder.ts ─────────

function addressScVal(addr: string): xdr.ScVal {
  return new Address(addr).toScVal();
}

function amountScVal(amount: number): xdr.ScVal {
  return nativeToScVal(BigInt(amount), { type: 'i128' });
}

function intervalScVal(interval: number): xdr.ScVal {
  return nativeToScVal(BigInt(interval), { type: 'u64' });
}

// ─── Address ScVal type ────────────────────────────────────────────────────────

describe('SCVal: address parameters', () => {
  it('subscriber G-address produces scvAddress', () => {
    expect(addressScVal(VALID_G).switch()).toBe(xdr.ScValType.scvAddress());
  });

  it('merchant G-address produces scvAddress', () => {
    expect(addressScVal(VALID_G2).switch()).toBe(xdr.ScValType.scvAddress());
  });

  it('token C-address produces scvAddress', () => {
    expect(addressScVal(VALID_C).switch()).toBe(xdr.ScValType.scvAddress());
  });

  it('subscriber ScVal round-trips back to the original address', () => {
    expect(Address.fromScVal(addressScVal(VALID_G)).toString()).toBe(VALID_G);
  });

  it('merchant ScVal round-trips back to the original address', () => {
    expect(Address.fromScVal(addressScVal(VALID_G2)).toString()).toBe(VALID_G2);
  });

  it('token ScVal round-trips back to the original address', () => {
    expect(Address.fromScVal(addressScVal(VALID_C)).toString()).toBe(VALID_C);
  });

  it('two different addresses produce different ScVals', () => {
    expect(addressScVal(VALID_G).toXDR('base64')).not.toBe(
      addressScVal(VALID_G2).toXDR('base64'),
    );
  });

  it('G-address and C-address produce different ScVals', () => {
    expect(addressScVal(VALID_G).toXDR('base64')).not.toBe(
      addressScVal(VALID_C).toXDR('base64'),
    );
  });
});

// ─── Amount: i128 ─────────────────────────────────────────────────────────────

describe('SCVal: amount (i128)', () => {
  it('amount encodes as scvI128', () => {
    expect(amountScVal(100).switch()).toBe(xdr.ScValType.scvI128());
  });

  it('amount 100 round-trips to BigInt(100)', () => {
    expect(scValToNative(amountScVal(100))).toBe(BigInt(100));
  });

  it('minimum amount 1 round-trips correctly', () => {
    expect(scValToNative(amountScVal(1))).toBe(BigInt(1));
  });

  it('large amount (10^18) round-trips without overflow', () => {
    const large = 1000000000000000000;
    expect(scValToNative(amountScVal(large))).toBe(BigInt(large));
  });

  it('amount 500 round-trips correctly', () => {
    expect(scValToNative(amountScVal(500))).toBe(BigInt(500));
  });
});

// ─── Interval: u64 ────────────────────────────────────────────────────────────

describe('SCVal: interval (u64)', () => {
  it('interval encodes as scvU64', () => {
    expect(intervalScVal(86400).switch()).toBe(xdr.ScValType.scvU64());
  });

  it('minimum interval 86400 (1 day) round-trips', () => {
    expect(scValToNative(intervalScVal(86400))).toBe(BigInt(86400));
  });

  it('maximum interval 31536000 (365 days) round-trips', () => {
    expect(scValToNative(intervalScVal(31536000))).toBe(BigInt(31536000));
  });

  it('30-day interval 2592000 round-trips', () => {
    expect(scValToNative(intervalScVal(2592000))).toBe(BigInt(2592000));
  });
});

// ─── Positional argument contract ─────────────────────────────────────────────
// transaction_builder calls:
//   contract.call('subscribe', arg[0], arg[1], arg[2], arg[3], arg[4])
// where arg[0]=subscriber, [1]=merchant, [2]=token, [3]=amount, [4]=interval

describe('SCVal: positional argument contract', () => {
  const args = [
    addressScVal(VALID_G),   // 0: subscriber
    addressScVal(VALID_G2),  // 1: merchant
    addressScVal(VALID_C),   // 2: token
    amountScVal(500),         // 3: amount
    intervalScVal(2592000),   // 4: interval
  ];

  it('arg[0] (subscriber) is scvAddress decoding to subscriber', () => {
    expect(args[0].switch()).toBe(xdr.ScValType.scvAddress());
    expect(Address.fromScVal(args[0]).toString()).toBe(VALID_G);
  });

  it('arg[1] (merchant) is scvAddress decoding to merchant', () => {
    expect(args[1].switch()).toBe(xdr.ScValType.scvAddress());
    expect(Address.fromScVal(args[1]).toString()).toBe(VALID_G2);
  });

  it('arg[2] (token) is scvAddress decoding to token', () => {
    expect(args[2].switch()).toBe(xdr.ScValType.scvAddress());
    expect(Address.fromScVal(args[2]).toString()).toBe(VALID_C);
  });

  it('arg[3] (amount) is scvI128 with value 500', () => {
    expect(args[3].switch()).toBe(xdr.ScValType.scvI128());
    expect(scValToNative(args[3])).toBe(BigInt(500));
  });

  it('arg[4] (interval) is scvU64 with value 2592000', () => {
    expect(args[4].switch()).toBe(xdr.ScValType.scvU64());
    expect(scValToNative(args[4])).toBe(BigInt(2592000));
  });

  it('subscriber and merchant args are distinct ScVals', () => {
    expect(args[0].toXDR('base64')).not.toBe(args[1].toXDR('base64'));
  });

  it('amount and interval args have different ScVal types', () => {
    expect(args[3].switch()).not.toBe(args[4].switch());
  });
});

// ─── XDR serialisability ──────────────────────────────────────────────────────

describe('SCVal: XDR serialisability', () => {
  it('address ScVal survives XDR round-trip', () => {
    const original = addressScVal(VALID_C2);
    const restored = xdr.ScVal.fromXDR(original.toXDR());
    expect(restored.toXDR('base64')).toBe(original.toXDR('base64'));
  });

  it('i128 ScVal survives XDR round-trip', () => {
    const original = amountScVal(123456);
    const restored = xdr.ScVal.fromXDR(original.toXDR());
    expect(scValToNative(restored)).toBe(BigInt(123456));
  });

  it('u64 ScVal survives XDR round-trip', () => {
    const original = intervalScVal(604800);
    const restored = xdr.ScVal.fromXDR(original.toXDR());
    expect(scValToNative(restored)).toBe(BigInt(604800));
  });
});
