"use client";

/**
 * useTokenInfo.ts
 *
 * Fetches the subscriber's SEP-41 token balance and the current allowance
 * granted to the SorobanPay contract, so the subscription form can warn the
 * user before they attempt a payment that would fail with error 7 (TransferFailed).
 *
 * ## When fetching occurs
 * - Immediately when `tokenAddress` becomes a valid C-address and `subscriberAddress`
 *   is a valid G-address.
 * - Every 30 seconds while the hook is mounted (configurable via `refreshIntervalMs`).
 * - On `window` `focus` events (user returns to the tab).
 * - On explicit call to the returned `refresh()` function.
 *
 * ## Error handling
 * - Returns `status: 'error'` with a human-readable `error` string when the RPC
 *   call fails (e.g. non-SEP-41 address, network unavailable, contract reverted).
 * - Returns `status: 'idle'` when either address is absent/invalid (no fetch attempted).
 * - Never throws — all errors are caught internally.
 *
 * ## SEP-41 ABI
 *   balance(address)                     → i128
 *   allowance(from: address, spender: address) → i128
 *
 * Requirements: FE-balance-allowance
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { SorobanRpc, Contract, Address, nativeToScVal, scValToNative } from "@stellar/stellar-sdk";
import { isValidCAddress, isValidGAddress } from "@/lib/validation";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type TokenInfoStatus = "idle" | "loading" | "success" | "error";

export interface TokenInfoState {
  /** Hook lifecycle status. */
  status: TokenInfoStatus;
  /**
   * Subscriber's raw token balance as a bigint (token's smallest unit), or null
   * when not yet fetched or on error.
   */
  balance: bigint | null;
  /**
   * Current allowance granted from subscriber to the SorobanPay contract as a
   * bigint (token's smallest unit), or null when not yet fetched or on error.
   */
  allowance: bigint | null;
  /** Human-readable error message when `status === 'error'`. */
  error: string | null;
  /** ISO timestamp of the last successful fetch. */
  lastUpdated: string | null;
  /** Trigger an immediate refresh. Safe to call at any time. */
  refresh: () => void;
}

export interface UseTokenInfoOptions {
  /** Soroban RPC URL. Defaults to the project constant from @/constants/network. */
  rpcUrl?: string;
  /** Refresh interval in ms. Default: 30 000 (30 s). Set to 0 to disable. */
  refreshIntervalMs?: number;
  /** Whether to re-fetch when the window regains focus. Default: true. */
  refreshOnFocus?: boolean;
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const DEFAULT_REFRESH_INTERVAL_MS = 30_000;

// ─── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Fetches the subscriber's balance and allowance for a given SEP-41 token contract.
 *
 * @param tokenAddress      SEP-41 token contract C-address. Fetching is skipped when
 *                          this is empty or not a valid 56-char C-address.
 * @param subscriberAddress Subscriber Stellar G-address. Fetching is skipped when
 *                          this is empty or not a valid G-address.
 * @param spenderAddress    Address of the contract that has been granted the allowance
 *                          (typically CONTRACT_ID).
 * @param options           Optional configuration overrides.
 */
export function useTokenInfo(
  tokenAddress: string,
  subscriberAddress: string,
  spenderAddress: string,
  options: UseTokenInfoOptions = {},
): TokenInfoState {
  const {
    rpcUrl: rpcUrlOverride,
    refreshIntervalMs = DEFAULT_REFRESH_INTERVAL_MS,
    refreshOnFocus = true,
  } = options;

  // Lazy-import the constant to allow easy mocking in tests.
  // We import lazily so that mock calls happen at require() time.
  const getRpcUrl = useCallback((): string => {
    if (rpcUrlOverride) return rpcUrlOverride;
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { RPC_URL } = require("@/constants/network") as { RPC_URL: string };
    return RPC_URL;
  }, [rpcUrlOverride]);

  const [status, setStatus] = useState<TokenInfoStatus>("idle");
  const [balance, setBalance] = useState<bigint | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  // Keep a ref to the "fetch generation" counter so stale callbacks don't overwrite
  // newer state after rapid input changes or unmounts.
  const fetchGenRef = useRef(0);

  // Derived: are both addresses valid enough to attempt a fetch?
  const canFetch =
    isValidCAddress(tokenAddress) &&
    isValidGAddress(subscriberAddress) &&
    isValidCAddress(spenderAddress);

  const fetchTokenInfo = useCallback(async () => {
    if (!canFetch) {
      setStatus("idle");
      setBalance(null);
      setAllowance(null);
      setError(null);
      return;
    }

    const gen = ++fetchGenRef.current;
    setStatus("loading");

    try {
      const rpcUrl = getRpcUrl();
      const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });

      // We read-only simulate both calls; no signing required.
      const tokenContract = new Contract(tokenAddress.trim());

      const subscriberScVal = new Address(subscriberAddress.trim()).toScVal();
      const spenderScVal = new Address(spenderAddress.trim()).toScVal();

      // ── balance(subscriber) ──────────────────────────────────────────────
      const balanceTx = buildSimulationTx(
        tokenContract,
        "balance",
        [subscriberScVal],
      );

      // ── allowance(subscriber, spender) ───────────────────────────────────
      const allowanceTx = buildSimulationTx(
        tokenContract,
        "allowance",
        [subscriberScVal, spenderScVal],
      );

      // Run both simulations in parallel.
      const [balanceResult, allowanceResult] = await Promise.all([
        server.simulateTransaction(balanceTx),
        server.simulateTransaction(allowanceTx),
      ]);

      // Abort if a newer fetch has started since this one was dispatched.
      if (gen !== fetchGenRef.current) return;

      const parsedBalance = parseSimulationResult(balanceResult, "balance");
      const parsedAllowance = parseSimulationResult(allowanceResult, "allowance");

      setBalance(parsedBalance);
      setAllowance(parsedAllowance);
      setError(null);
      setStatus("success");
      setLastUpdated(new Date().toISOString());
    } catch (err) {
      if (gen !== fetchGenRef.current) return;
      const msg = buildErrorMessage(err);
      setBalance(null);
      setAllowance(null);
      setError(msg);
      setStatus("error");
    }
  }, [canFetch, tokenAddress, subscriberAddress, spenderAddress, getRpcUrl]);

  // ── Initial fetch & re-fetch when addresses change ────────────────────────
  useEffect(() => {
    fetchTokenInfo();
  }, [fetchTokenInfo]);

  // ── Periodic refresh ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!canFetch || refreshIntervalMs <= 0) return;

    const id = setInterval(() => {
      fetchTokenInfo();
    }, refreshIntervalMs);

    return () => clearInterval(id);
  }, [canFetch, fetchTokenInfo, refreshIntervalMs]);

  // ── Focus-based refresh ──────────────────────────────────────────────────
  useEffect(() => {
    if (!refreshOnFocus || !canFetch) return;

    const handleFocus = () => {
      fetchTokenInfo();
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [refreshOnFocus, canFetch, fetchTokenInfo]);

  return {
    status,
    balance,
    allowance,
    error,
    lastUpdated,
    refresh: fetchTokenInfo,
  };
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a minimal transaction object that can be passed to
 * `server.simulateTransaction()` for a read-only contract call.
 *
 * `simulateTransaction` requires a Transaction (not just an Operation), so we
 * create an unsigned one with a placeholder account and no sequence number
 * enforcement (sequence "0"). The RPC node simulates it without broadcasting.
 */
function buildSimulationTx(
  contract: Contract,
  method: string,
  args: ReturnType<Address["toScVal"]>[],
) {
  // Lazy import to allow mocking in tests.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { TransactionBuilder, BASE_FEE, Account } = require("@stellar/stellar-sdk") as {
    TransactionBuilder: typeof import("@stellar/stellar-sdk").TransactionBuilder;
    BASE_FEE: string;
    Account: typeof import("@stellar/stellar-sdk").Account;
    };

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { NETWORK_PASSPHRASE } = require("@/constants/network") as {
    NETWORK_PASSPHRASE: string;
  };

  // Placeholder account — sequence doesn't matter for simulation.
  const account = new Account(
    "GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN",
    "0",
  );

  return new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();
}

/**
 * Extract the i128 return value from a `simulateTransaction` result.
 * Throws a descriptive error if the simulation failed or the value is missing.
 */
function parseSimulationResult(
  result: SorobanRpc.Api.SimulateTransactionResponse,
  fieldName: string,
): bigint {
  if (SorobanRpc.Api.isSimulationError(result)) {
    throw new Error(
      `Token contract rejected "${fieldName}" call: ${result.error}`,
    );
  }

  const success = result as SorobanRpc.Api.SimulateTransactionSuccessResponse;

  const retval = success.result?.retval;
  if (retval === undefined) {
    throw new Error(
      `No return value in simulation for "${fieldName}". ` +
        "The address may not be a valid SEP-41 token contract.",
    );
  }

  // scValToNative converts i128 XDR to a bigint in stellar-sdk v12+
  const native = scValToNative(retval);

  if (typeof native === "bigint") return native;
  if (typeof native === "number") return BigInt(native);

  throw new Error(
    `Unexpected return type for "${fieldName}": expected i128, got ${typeof native}`,
  );
}

/**
 * Produce a concise, user-readable error message from an unknown caught value.
 */
function buildErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);

  // Classify common failure modes with friendly text.
  if (raw.includes("rejected") || raw.includes("reverted")) {
    return "Token contract call was rejected. The address may not be a valid SEP-41 token.";
  }
  if (raw.includes("No return value") || raw.includes("not be a valid SEP-41")) {
    return "The contract did not return a balance or allowance. Verify the token address is a SEP-41 contract.";
  }
  if (
    raw.includes("failed to fetch") ||
    raw.includes("network") ||
    raw.includes("ECONNREFUSED")
  ) {
    return "Could not reach the Soroban RPC endpoint. Check your network connection.";
  }
  if (raw.includes("timeout") || raw.includes("timed out")) {
    return "RPC request timed out while fetching token info. Will retry shortly.";
  }

  // Generic fallback — include raw message for debugging.
  return `Could not load token info: ${raw}`;
}
