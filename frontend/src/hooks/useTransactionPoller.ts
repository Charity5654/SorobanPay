/**
 * useTransactionPoller.ts
 *
 * React hook that polls the Soroban RPC `getTransaction` endpoint until a
 * submitted transaction reaches a terminal state (SUCCESS or FAILED), times
 * out, or is cancelled.
 *
 * Polling strategy:
 *   - Initial delay: 2 000 ms
 *   - Exponential backoff: delay × 1.5 on each attempt (capped at 10 000 ms)
 *   - Hard timeout: 60 seconds — yields 'timeout' status with an explorer link
 *
 * Status lifecycle:
 *   idle  ──(start)──►  confirming  ──(SUCCESS)──►  success
 *                    ├──(FAILED)───►  failed
 *                    └──(timeout)──►  timeout
 *
 * Explorer link (Stellar Expert):
 *   Testnet:  https://stellar.expert/explorer/testnet/tx/{hash}
 *   Mainnet:  https://stellar.expert/explorer/public/tx/{hash}
 */

import { useState, useCallback, useRef } from 'react';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { NETWORK_NAME } from '@/constants/network';

// ── Types ─────────────────────────────────────────────────────────────────────

export type PollerStatus = 'idle' | 'confirming' | 'success' | 'failed' | 'timeout';

export interface TransactionPollerState {
  /** Current lifecycle status */
  status: PollerStatus;
  /** Transaction hash being polled (set as soon as polling starts) */
  txHash: string | null;
  /**
   * Error message when status is 'failed'.
   * Includes the contract error code and human-readable description when
   * available from the transaction result metadata.
   */
  errorMessage: string | null;
  /** Stellar Expert explorer URL for the current txHash */
  explorerUrl: string | null;
}

export interface UseTransactionPollerOptions {
  /** Override the Soroban RPC URL (defaults to RPC_URL from constants) */
  rpcUrl?: string;
  /**
   * Called when the transaction reaches SUCCESS status.
   * Receives the confirmed transaction hash.
   */
  onSuccess?: (txHash: string) => void;
  /**
   * Called when the transaction reaches FAILED status.
   * Receives the error message extracted from result metadata.
   */
  onFailed?: (errorMessage: string, txHash: string) => void;
  /**
   * Called when polling times out (60 s elapsed with no terminal status).
   * Receives the transaction hash and the explorer URL.
   */
  onTimeout?: (txHash: string, explorerUrl: string) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Initial polling interval in milliseconds */
const INITIAL_DELAY_MS = 2_000;
/** Exponential backoff multiplier */
const BACKOFF_FACTOR = 1.5;
/** Maximum polling interval in milliseconds */
const MAX_DELAY_MS = 10_000;
/** Total polling timeout in milliseconds */
const POLL_TIMEOUT_MS = 60_000;

// ── Explorer URL helper ───────────────────────────────────────────────────────

/**
 * Build a Stellar Expert explorer URL for a given transaction hash.
 * Uses NETWORK_NAME from constants to determine testnet vs. mainnet.
 */
export function buildExplorerUrl(txHash: string, networkName = NETWORK_NAME): string {
  const network = networkName === 'Mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

/**
 * Extract a human-readable error message from a failed Soroban transaction.
 *
 * Attempts to pull the contract error code from the result metadata XDR
 * (e.g. "Error(Contract, #7)" → "contract error #7") for display alongside
 * the raw result.
 */
export function extractFailureMessage(
  response: SorobanRpc.Api.GetTransactionResponse,
): string {
  if (response.status !== SorobanRpc.Api.GetTransactionStatus.FAILED) {
    return 'Transaction failed';
  }

  const failedResponse = response as SorobanRpc.Api.GetFailedTransactionResponse;
  const metaXdr = failedResponse.resultMetaXdr;

  if (!metaXdr) {
    return 'Transaction failed on-chain (no result metadata available)';
  }

  const metaStr = typeof metaXdr === 'string' ? metaXdr : metaXdr.toXDR('base64');

  // Attempt to detect contract error code patterns in the XDR base64 string.
  // The base64 encoding of "Error(Contract, #N)" sequences tends to include
  // the raw error code. We also match common textual representations that
  // appear in decoded XDR strings.
  const codeMatch = metaStr.match(
    /Error\(Contract,\s*#(\d+)\)|contract\s+error[:\s#]+(\d+)|ContractError\((\d+)\)/i,
  );
  if (codeMatch) {
    const code = codeMatch[1] ?? codeMatch[2] ?? codeMatch[3];
    return `Transaction failed on-chain: contract error #${code}`;
  }

  return `Transaction failed on-chain: ${metaStr.slice(0, 120)}`;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Hook for polling a submitted Soroban transaction to its terminal state.
 *
 * @example
 * ```tsx
 * const { state, startPolling } = useTransactionPoller({
 *   rpcUrl: RPC_URL,
 *   onSuccess: (hash) => setSuccessData({ txHash: hash, ... }),
 *   onFailed:  (msg, hash) => setTxError(classifyError(new Error(msg))),
 *   onTimeout: (_hash, url) => setTxError(classifyError(new Error(`timeout:${url}`))),
 * });
 *
 * // After Freighter signs and submits:
 * startPolling(sendResult.hash, server);
 * ```
 */
export function useTransactionPoller(
  options: UseTransactionPollerOptions = {},
): {
  state: TransactionPollerState;
  startPolling: (txHash: string, server: SorobanRpc.Server) => void;
  reset: () => void;
} {
  const { onSuccess, onFailed, onTimeout } = options;

  const [state, setState] = useState<TransactionPollerState>({
    status: 'idle',
    txHash: null,
    errorMessage: null,
    explorerUrl: null,
  });

  // Track whether polling is active so we can cancel on unmount / reset
  const activeRef = useRef(false);

  const reset = useCallback(() => {
    activeRef.current = false;
    setState({
      status: 'idle',
      txHash: null,
      errorMessage: null,
      explorerUrl: null,
    });
  }, []);

  const startPolling = useCallback(
    (txHash: string, server: SorobanRpc.Server) => {
      // Cancel any previous poll
      activeRef.current = false;

      const explorerUrl = buildExplorerUrl(txHash);

      setState({
        status: 'confirming',
        txHash,
        errorMessage: null,
        explorerUrl,
      });

      // Mark this poll session as active
      const sessionActive = { value: true };
      activeRef.current = true;

      const startTime = Date.now();
      let delay = INITIAL_DELAY_MS;

      async function poll(): Promise<void> {
        // Check for cancellation or timeout before each attempt
        if (!sessionActive.value) return;

        if (Date.now() - startTime >= POLL_TIMEOUT_MS) {
          setState((prev) => ({ ...prev, status: 'timeout' }));
          onTimeout?.(txHash, explorerUrl);
          return;
        }

        // Wait for the current backoff delay
        await sleep(delay);

        // Re-check after the sleep
        if (!sessionActive.value) return;

        let response: SorobanRpc.Api.GetTransactionResponse;
        try {
          response = await server.getTransaction(txHash);
        } catch (err) {
          // RPC call itself failed — treat as retriable unless we've timed out
          if (Date.now() - startTime >= POLL_TIMEOUT_MS) {
            const msg =
              err instanceof Error ? err.message : 'RPC error while polling';
            setState((prev) => ({
              ...prev,
              status: 'failed',
              errorMessage: msg,
            }));
            onFailed?.(msg, txHash);
            return;
          }
          // Otherwise back off and retry
          delay = Math.min(delay * BACKOFF_FACTOR, MAX_DELAY_MS);
          void poll();
          return;
        }

        if (!sessionActive.value) return;

        if (response.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
          setState((prev) => ({ ...prev, status: 'success' }));
          onSuccess?.(txHash);
          return;
        }

        if (response.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
          const msg = extractFailureMessage(response);
          setState((prev) => ({
            ...prev,
            status: 'failed',
            errorMessage: msg,
          }));
          onFailed?.(msg, txHash);
          return;
        }

        // NOT_FOUND — still in mempool. Back off and retry.
        delay = Math.min(delay * BACKOFF_FACTOR, MAX_DELAY_MS);
        void poll();
      }

      void poll();

      // Return a cancel function that callers can invoke on unmount
      return () => {
        sessionActive.value = false;
        activeRef.current = false;
      };
    },
    [onSuccess, onFailed, onTimeout],
  );

  return { state, startPolling, reset };
}

// ── Utility ───────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
