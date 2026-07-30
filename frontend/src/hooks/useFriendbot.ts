'use client';

/**
 * useFriendbot.ts
 *
 * Hook for funding a testnet Stellar account via the Friendbot faucet.
 *
 * Features:
 *  - Calls https://friendbot.stellar.org/?addr={publicKey}
 *  - Only intended for testnet — callers should guard with NETWORK_NAME check
 *  - Exposes isFunding, success, and error states
 *  - On success, notifies a callback (e.g. to trigger a balance re-fetch)
 *  - Resets success/error state before each new call
 *
 * Usage:
 *   const { fund, isFunding, success, error } = useFriendbot({
 *     publicKey,
 *     onSuccess: refetchBalance,
 *   });
 */

import { useState, useCallback } from 'react';

// ── Constants ─────────────────────────────────────────────────────────────────

export const FRIENDBOT_URL = 'https://friendbot.stellar.org';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UseFriendbotOptions {
  /** The Stellar public key (G-address) to fund. */
  publicKey: string | null | undefined;
  /**
   * Called after a successful Friendbot response.
   * Typically used to trigger a balance re-fetch after a short delay.
   */
  onSuccess?: () => void;
  /**
   * Delay in ms before calling onSuccess (default: 5000).
   * The Friendbot transaction needs a moment to settle on-chain before
   * the balance RPC reflects the new amount.
   */
  successDelayMs?: number;
  /** Override the Friendbot base URL (useful in tests). */
  friendbotUrl?: string;
}

export interface UseFriendbotResult {
  /** Initiate the Friendbot funding request. */
  fund: () => Promise<void>;
  /** True while the HTTP request is in flight. */
  isFunding: boolean;
  /** True after a successful fund response (clears on next call). */
  success: boolean;
  /** Error message from the last failed attempt, null otherwise. */
  error: string | null;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useFriendbot({
  publicKey,
  onSuccess,
  successDelayMs = 5000,
  friendbotUrl = FRIENDBOT_URL,
}: UseFriendbotOptions): UseFriendbotResult {
  const [isFunding, setIsFunding] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fund = useCallback(async () => {
    if (!publicKey || isFunding) return;

    setIsFunding(true);
    setSuccess(false);
    setError(null);

    try {
      const url = `${friendbotUrl}/?addr=${encodeURIComponent(publicKey)}`;
      const response = await fetch(url);

      if (!response.ok) {
        // Friendbot returns a JSON error body on failure
        let detail = `HTTP ${response.status}`;
        try {
          const body = (await response.json()) as { detail?: string; title?: string };
          detail = body.detail ?? body.title ?? detail;
        } catch {
          // Ignore JSON parse failure — use the status code message
        }
        throw new Error(detail);
      }

      setSuccess(true);

      // Schedule the balance refresh after the ledger settles
      if (onSuccess) {
        setTimeout(onSuccess, successDelayMs);
      }
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : 'Friendbot request failed';
      setError(msg);
    } finally {
      setIsFunding(false);
    }
  }, [publicKey, isFunding, friendbotUrl, onSuccess, successDelayMs]);

  return { fund, isFunding, success, error };
}
