'use client';

/**
 * useAccountBalance.ts
 *
 * Fetches the native XLM balance for a connected Stellar account via the
 * Soroban RPC `getAccount()` endpoint.
 *
 * Features:
 *  - Returns the XLM balance as a human-readable string (e.g. "100.0000000")
 *  - Returns "0.0000000" for unfunded accounts (account-not-found is not an error)
 *  - Exposes isLoading and error states
 *  - Accepts an optional `refreshTrigger` counter: incrementing it forces a
 *    re-fetch (used by useFriendbot after a successful fund operation)
 *
 * Usage:
 *   const { balance, isLoading, error, refetch } =
 *     useAccountBalance({ publicKey });
 */

import { useState, useEffect, useCallback } from 'react';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { RPC_URL } from '@/constants/network';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseAccountBalanceOptions {
  /** Connected wallet public key. Pass null/undefined when disconnected. */
  publicKey: string | null | undefined;
  /** Override RPC URL (useful in tests). */
  rpcUrl?: string;
  /**
   * Increment this value to trigger an immediate re-fetch.
   * Useful after a Friendbot fund so the balance updates without a page reload.
   */
  refreshTrigger?: number;
}

export interface UseAccountBalanceResult {
  /** Human-readable XLM balance string, e.g. "100.0000000". Null while loading. */
  balance: string | null;
  /** True while the RPC request is in flight. */
  isLoading: boolean;
  /** Error message if the fetch failed, null otherwise. */
  error: string | null;
  /** Manually trigger a re-fetch. */
  refetch: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Extract the native XLM balance string from a getAccount response. */
function extractNativeBalance(
  account: Awaited<ReturnType<SorobanRpc.Server['getAccount']>>,
): string {
  // account.balances is an array of balance objects; native XLM has asset_type === 'native'
  const balances = (account as unknown as { balances?: { asset_type: string; balance: string }[] }).balances;
  if (!Array.isArray(balances)) return '0.0000000';
  const native = balances.find((b) => b.asset_type === 'native');
  return native?.balance ?? '0.0000000';
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAccountBalance({
  publicKey,
  rpcUrl = RPC_URL,
  refreshTrigger = 0,
}: UseAccountBalanceOptions): UseAccountBalanceResult {
  const [balance, setBalance] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Internal counter incremented by refetch() to trigger the effect
  const [internalTrigger, setInternalTrigger] = useState(0);

  const refetch = useCallback(() => {
    setInternalTrigger((c) => c + 1);
  }, []);

  useEffect(() => {
    if (!publicKey) {
      setBalance(null);
      setError(null);
      return;
    }

    let cancelled = false;

    async function fetchBalance() {
      setIsLoading(true);
      setError(null);

      try {
        const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
        const account = await server.getAccount(publicKey!);
        if (!cancelled) {
          setBalance(extractNativeBalance(account));
        }
      } catch (err: unknown) {
        if (cancelled) return;
        // A 404 / account-not-found means the account is unfunded — treat as 0
        const msg = err instanceof Error ? err.message : String(err);
        if (
          msg.includes('Not Found') ||
          msg.includes('not found') ||
          msg.includes('404') ||
          msg.includes('account') // "account not found" variants
        ) {
          setBalance('0.0000000');
        } else {
          setError(msg);
          setBalance(null);
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void fetchBalance();

    return () => {
      cancelled = true;
    };
    // refreshTrigger and internalTrigger both cause a re-run
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, rpcUrl, refreshTrigger, internalTrigger]);

  return { balance, isLoading, error, refetch };
}
