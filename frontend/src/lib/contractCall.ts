/**
 * contractCall.ts — Issue #35
 *
 * Every builder function in transaction_builder.ts hand-assembles its
 * contract.call(...) operation the same way:
 *
 *   contract.call(
 *     'method_name',
 *     new Address(x).toScVal(),
 *     nativeToScVal(BigInt(y), { type: 'i128' }),
 *     ...
 *   )
 *
 * That's easy to get subtly wrong (wrong SDK type tag, forgetting BigInt()
 * on a numeric field Soroban expects as i128/u64, a raw ScVal slipping in
 * where a plain value was meant) with no compiler help — `contract.call`
 * takes `...xdr.ScVal[]`, so any of those mistakes still type-checks.
 *
 * This wraps it in a small typed arg DSL (`arg.address(...)`, `arg.i128(...)`,
 * etc.) so each argument's Soroban type is declared once, in one place, and
 * a construction failure (e.g. an address string malformed enough that
 * `new Address()` itself throws) is mapped through normalizeRpcError() like
 * every other transaction-layer error instead of surfacing as a raw SDK
 * exception.
 */

import { Address, Contract, nativeToScVal, xdr } from '@stellar/stellar-sdk';
import { normalizeRpcError } from './rpc_error_normalizer';

// ─── Typed argument DSL ─────────────────────────────────────────────────────

export type ContractArg =
  | { kind: 'address'; value: string }
  | { kind: 'i128'; value: number | bigint }
  | { kind: 'u64'; value: number | bigint }
  | { kind: 'u32'; value: number }
  | { kind: 'bool'; value: boolean }
  /** Encodes as the u64 value when defined, or ScVal::Void (Soroban's `None`) when undefined. */
  | { kind: 'optionU64'; value: number | bigint | undefined };

/** Convenience constructors — `arg.address(x)` instead of `{ kind: 'address', value: x }`. */
export const arg = {
  address: (value: string): ContractArg => ({ kind: 'address', value }),
  i128: (value: number | bigint): ContractArg => ({ kind: 'i128', value }),
  u64: (value: number | bigint): ContractArg => ({ kind: 'u64', value }),
  u32: (value: number): ContractArg => ({ kind: 'u32', value }),
  bool: (value: boolean): ContractArg => ({ kind: 'bool', value }),
  optionU64: (value: number | bigint | undefined): ContractArg => ({ kind: 'optionU64', value }),
};

function argToScVal(a: ContractArg): xdr.ScVal {
  switch (a.kind) {
    case 'address':
      return new Address(a.value).toScVal();
    case 'i128':
      return nativeToScVal(BigInt(a.value), { type: 'i128' });
    case 'u64':
      return nativeToScVal(BigInt(a.value), { type: 'u64' });
    case 'u32':
      return nativeToScVal(a.value, { type: 'u32' });
    case 'bool':
      return nativeToScVal(a.value, { type: 'bool' });
    case 'optionU64':
      return a.value != null ? nativeToScVal(BigInt(a.value), { type: 'u64' }) : xdr.ScVal.scvVoid();
  }
}

// ─── Wrapper ────────────────────────────────────────────────────────────────

/**
 * Build a `contract.call(method, ...)` operation from a typed argument list.
 *
 * @param contractId Deployed contract address (C-address).
 * @param method     Contract entry point name, e.g. 'subscribe'.
 * @param args       Arguments in declared order, built via the `arg.*` helpers.
 * @throws A NormalizedRpcError (via normalizeRpcError()) if any argument
 *         fails to convert — e.g. `arg.address(x)` where `x` isn't a value
 *         the SDK's Address class accepts.
 */
export function buildContractCall(
  contractId: string,
  method: string,
  args: ContractArg[],
): xdr.Operation {
  try {
    const contract = new Contract(contractId);
    return contract.call(method, ...args.map(argToScVal));
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw normalizeRpcError(
      new Error(`Failed to build ${method} contract call: ${msg}`),
    );
  }
}
