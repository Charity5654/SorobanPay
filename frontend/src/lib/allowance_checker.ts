/**
 * allowance_checker.ts
 *
 * Queries a SEP-41 token contract to determine how much allowance
 * a subscriber has granted to the SorobanPay subscription contract.
 *
 * The check is performed via `simulateTransaction` on the Soroban RPC
 * (read-only, no fees, no signing required). This mirrors what the
 * on-chain `subscribe` entry point reads before deciding whether to
 * emit a `low_allowance` event or reject with `InsufficientAllowance`
 * (when `strict = true`).
 *
 * Typical usage — call before building the subscription transaction so
 * the UI can warn the user to approve a higher allowance if needed:
 *
 * ```ts
 * const result = await checkAllowance({
 *   subscriberAddress: publicKey,
 *   tokenContractId:   tokenAddress,
 *   contractId,        // SorobanPay contract — the spender
 *   requiredAmount:    BigInt(amount),
 *   rpcUrl,
 *   networkPassphrase,
 * });
 *
 * if (!result.sufficient) {
 *   // Show UI warning — result.shortfall tokens need to be approved
 * }
 * ```
 */

import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  scValToNative,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { isValidCAddress, isValidGAddress } from './validation';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Input parameters for `checkAllowance`. */
export interface CheckAllowanceParams {
  /** Subscriber's Stellar G-address (the owner of the allowance). */
  subscriberAddress: string;
  /** SEP-41 token contract C-address to query. */
  tokenContractId: string;
  /** SorobanPay contract C-address (the spender). */
  contractId: string;
  /** Minimum allowance required (in the token's smallest unit). */
  requiredAmount: bigint;
  /** Soroban RPC endpoint URL. */
  rpcUrl: string;
  /** Stellar network passphrase. */
  networkPassphrase: string;
}

/** Result returned by `checkAllowance`. */
export interface AllowanceResult {
  /**
   * Current allowance granted by `subscriberAddress` to the SorobanPay
   * contract, denominated in the token's smallest unit.
   */
  allowance: bigint;
  /**
   * `true` when `allowance >= requiredAmount`.
   * The subscription transaction is safe to submit.
   */
  sufficient: boolean;
  /**
   * How many additional tokens need to be approved before the first payment
   * can be executed. Zero when `sufficient` is `true`.
   */
  shortfall: bigint;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether the subscriber's current SEP-41 token allowance for the
 * SorobanPay contract is large enough to cover at least one payment.
 *
 * The check is performed via `simulateTransaction` — read-only, free, and
 * requires no wallet signature. The simulation calls `allowance(owner, spender)`
 * on the token contract and decodes the returned `i128` ScVal.
 *
 * @throws {Error} If any address is invalid, RPC simulation fails, or the
 *                 simulation returns an unexpected result type.
 */
export async function checkAllowance(
  params: CheckAllowanceParams,
): Promise<AllowanceResult> {
  const { subscriberAddress, tokenContractId, contractId, requiredAmount, rpcUrl, networkPassphrase } =
    params;

  // Validate inputs before touching the network
  if (!isValidGAddress(subscriberAddress)) {
    throw new Error(`checkAllowance: invalid subscriber address: ${subscriberAddress}`);
  }
  if (!isValidCAddress(tokenContractId)) {
    throw new Error(`checkAllowance: invalid token contract address: ${tokenContractId}`);
  }
  if (!isValidCAddress(contractId)) {
    throw new Error(`checkAllowance: invalid SorobanPay contract address: ${contractId}`);
  }
  if (requiredAmount < 0n) {
    throw new Error(`checkAllowance: requiredAmount must be non-negative, got ${requiredAmount}`);
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // Build a throw-away read-only transaction that calls token.allowance(owner, spender).
  // We use a dummy source account keypair because simulateTransaction only needs
  // a structurally valid transaction — it never submits to the network.
  const dummySourceAccount = await server.getAccount(subscriberAddress);

  const tokenContract = new Contract(tokenContractId);
  const tx = new TransactionBuilder(dummySourceAccount, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      tokenContract.call(
        'allowance',
        // owner: the subscriber
        new Address(subscriberAddress).toScVal(),
        // spender: the SorobanPay subscription contract
        new Address(contractId).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  // Simulate — read-only, no fees charged, no signing required
  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(
      `checkAllowance: simulation failed: ${simResult.error}`,
    );
  }

  if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
    throw new Error('checkAllowance: unexpected simulation result (neither success nor error)');
  }

  // The `allowance` function returns a single i128 result
  const results = simResult.result;
  if (!results) {
    throw new Error('checkAllowance: simulation returned no result value');
  }

  // scValToNative converts i128 → bigint
  const rawAllowance = scValToNative(results.retval);
  if (typeof rawAllowance !== 'bigint') {
    throw new Error(
      `checkAllowance: expected i128 (bigint) from allowance(), got ${typeof rawAllowance}`,
    );
  }

  const allowance = rawAllowance < 0n ? 0n : rawAllowance;
  const sufficient = allowance >= requiredAmount;
  const shortfall = sufficient ? 0n : requiredAmount - allowance;

  return { allowance, sufficient, shortfall };
}

// ─── Formatting helper ────────────────────────────────────────────────────────

/**
 * Format a raw i128 allowance (bigint) into a human-readable string.
 *
 * Token contracts typically use 7 decimal places (1 stroop = 1e-7 XLM).
 * If `decimals` is omitted the raw integer is returned as-is.
 *
 * @example
 *   formatAllowance(10_000_000n, 7)  // → "1.0000000"
 *   formatAllowance(500n)             // → "500"
 */
export function formatAllowance(raw: bigint, decimals?: number): string {
  if (decimals === undefined || decimals <= 0) {
    return raw.toString();
  }
  const factor = 10n ** BigInt(decimals);
  const whole = raw / factor;
  const fraction = raw % factor;
  const fractionStr = fraction.toString().padStart(decimals, '0');
  return `${whole}.${fractionStr}`;
}
