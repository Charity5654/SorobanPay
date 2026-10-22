"use client";

/**
 * CancelSubscriptionModal.tsx
 *
 * User flow for canceling a subscription with confirmation and error handling.
 * Provides clear warning about subscription removal and transaction confirmation.
 */

import { useState } from "react";
import { getRuntimeConfig } from "@/lib/runtime_config";
import { buildSignAndSubmitCancel } from "@/lib/transaction_builder";
import { normalizeRpcError } from "@/lib/rpc_error_normalizer";
import { useToast } from "@/components/Toast";
import { useWallet } from "@/hooks/useWallet";

export interface CancelSubscriptionModalProps {
  /** Merchant Stellar G-address */
  merchantAddress: string;
  /** Token contract C-address */
  tokenAddress: string;
  /** Subscriber Stellar G-address (usually from wallet) */
  subscriberAddress: string;
  /** Whether modal is open */
  isOpen: boolean;
  /** Callback when modal closes */
  onClose: () => void;
  /** Callback when cancel succeeds */
  onSuccess?: (txHash: string) => void;
  /** Callback when cancel fails */
  onError?: (error: Error) => void;
}

export function CancelSubscriptionModal({
  merchantAddress,
  tokenAddress,
  subscriberAddress,
  isOpen,
  onClose,
  onSuccess,
  onError,
}: CancelSubscriptionModalProps) {
  const { publicKey } = useWallet();
  const { showToast } = useToast();
  const config = getRuntimeConfig();

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  if (!isOpen) {
    return null;
  }

  const handleCancel = async () => {
    if (!publicKey) {
      setError("Wallet not connected");
      return;
    }

    if (publicKey !== subscriberAddress) {
      setError("Connected wallet does not match this subscription. Connect the subscriber wallet to continue.");
      return;
    }

    if (!confirmed) {
      setError("Please confirm you want to cancel this subscription");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      const result = await buildSignAndSubmitCancel(
        {
          subscriber: subscriberAddress,
          merchant: merchantAddress,
        },
        config.contractId,
        publicKey,
        config.networkPassphrase,
        config.rpcUrl
      );

      showToast({
        type: "success",
        title: "Subscription Canceled",
        message: `Transaction: ${result.txHash.slice(0, 16)}...`,
        duration: 5000,
      });

      onSuccess?.(result.txHash);
      
      // Reset and close modal
      setConfirmed(false);
      setTimeout(() => {
        onClose();
      }, 1000);
    } catch (err) {
      const normalizedError = normalizeRpcError(err);
      const errorMessage = `${normalizedError.summary} Your subscription is still active. ${normalizedError.action}`;
      setError(errorMessage);
      showToast({
        type: "error",
        title: normalizedError.title,
        message: errorMessage,
        duration: 5000,
      });
      onError?.(err instanceof Error ? err : new Error(errorMessage));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div
        className="bg-white dark:bg-gray-900 rounded-lg shadow-xl max-w-md w-full p-6 border border-gray-200 dark:border-gray-800"
        role="alertdialog"
        aria-labelledby="cancel-title"
        aria-describedby="cancel-description"
        aria-busy={isSubmitting}
      >
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2
              id="cancel-title"
              className="text-xl font-bold text-gray-900 dark:text-white"
            >
              Cancel Subscription
            </h2>
          </div>
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 p-1"
            aria-label="Close modal"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {isSubmitting && (
          <p role="status" aria-live="polite" className="mb-4 text-sm text-blue-700 dark:text-blue-300">
            Cancellation pending. Waiting for network confirmation.
          </p>
        )}

        {/* Description */}
        <div id="cancel-description" className="mb-6">
          <p className="text-sm text-gray-600 dark:text-gray-300 mb-3">
            Are you sure you want to cancel this recurring subscription?
          </p>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3 mb-4">
            <p className="text-sm text-yellow-800 dark:text-yellow-200">
              <span className="font-semibold">⚠️ Warning:</span> This action will permanently remove this subscription. Future payments will not be collected.
            </p>
          </div>

          {/* Subscription Details */}
          <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg p-3 space-y-2 text-sm mb-4">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Merchant:</span>
              <span className="font-mono text-gray-900 dark:text-white truncate">
                {merchantAddress.slice(0, 10)}...
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Token:</span>
              <span className="font-mono text-gray-900 dark:text-white truncate">
                {tokenAddress.slice(0, 10)}...
              </span>
            </div>
          </div>

          {/* Error Message */}
          {error && (
            <div role="alert" className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3 mb-4">
              <p className="text-sm text-red-800 dark:text-red-200">
                <span className="font-semibold">Error:</span> {error}
              </p>
            </div>
          )}
        </div>

        {/* Confirmation Checkbox */}
        <div className="mb-6">
          <label className="flex items-start gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              disabled={isSubmitting}
              className="mt-1 w-4 h-4 accent-blue-600"
              aria-label="I understand this action cannot be undone"
            />
            <span className="text-sm text-gray-700 dark:text-gray-300">
              I understand this action cannot be undone and no further payments will be collected
            </span>
          </label>
        </div>

        {/* Buttons */}
        <div className="flex gap-3">
          <button
            onClick={onClose}
            disabled={isSubmitting}
            className="flex-1 px-4 py-2 rounded-lg border border-gray-300 dark:border-gray-700 text-gray-900 dark:text-white hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Keep Subscription
          </button>
          <button
            onClick={handleCancel}
            disabled={isSubmitting || !confirmed}
            className="flex-1 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors font-medium flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <svg className="w-4 h-4 animate-spin" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                Canceling...
              </>
            ) : (
              "Cancel Subscription"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
