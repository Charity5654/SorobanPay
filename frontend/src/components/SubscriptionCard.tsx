'use client';

/**
 * SubscriptionCard.tsx
 *
 * Displays a single active subscription for the subscriber dashboard.
 * Shows: merchant address, token, amount, interval, next payment date.
 * Provides a Cancel button that triggers the cancel() contract call with
 * optimistic UI — immediately marks the card as cancelled while awaiting
 * on-chain confirmation.
 *
 * Dashboard feature – subscriber view
 */

import { useState, useCallback } from 'react';
import { truncateAddress, formatInterval, stroopsToTokens } from '@/lib/utils';
import { buildAndSubmitCancel } from '@/lib/cancel_builder';
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
} from '@/constants/network';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SubscriptionCardProps {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** Token contract C-address */
  token: string;
  /** Payment amount in token's smallest unit (stroops) as BigInt */
  amount: bigint;
  /** Payment interval in seconds */
  interval: number;
  /** Unix timestamp (seconds) of the next scheduled payment */
  nextPayment: number;
  /** Unique key for this subscription */
  subscriptionKey: string;
  /** True when a cancel tx is already in flight */
  isCancelling: boolean;
  /** Non-null if already optimistically cancelled */
  cancelledAt: Date | null;
  /** Called when the cancel flow completes or the card should be hidden */
  onCancelled: (key: string) => void;
  /** Called when the cancel flow starts/ends to update isCancelling state */
  onCancelStateChange: (key: string, cancelling: boolean) => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(unixSeconds: number): string {
  if (!unixSeconds) return '—';
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isOverdue(unixSeconds: number): boolean {
  return unixSeconds > 0 && Date.now() / 1000 > unixSeconds;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SubscriptionCard({
  subscriber,
  merchant,
  token,
  amount,
  interval,
  nextPayment,
  subscriptionKey,
  isCancelling,
  cancelledAt,
  onCancelled,
  onCancelStateChange,
}: SubscriptionCardProps) {
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);

  const overdue = isOverdue(nextPayment);

  const handleCancelClick = useCallback(() => {
    setCancelError(null);
    setShowConfirm(true);
  }, []);

  const handleCancelDismiss = useCallback(() => {
    setShowConfirm(false);
  }, []);

  const handleConfirmCancel = useCallback(async () => {
    setShowConfirm(false);
    onCancelStateChange(subscriptionKey, true);
    setCancelError(null);

    try {
      await buildAndSubmitCancel(
        { subscriber, merchant },
        CONTRACT_ID,
        subscriber,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );
      // On-chain confirmed — notify parent to remove the card
      onCancelled(subscriptionKey);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setCancelError(msg);
      onCancelStateChange(subscriptionKey, false);
    }
  }, [subscriber, merchant, subscriptionKey, onCancelled, onCancelStateChange]);

  // Optimistic cancel already applied — show muted "cancelled" state
  if (cancelledAt) {
    return (
      <article
        aria-label={`Cancelled subscription to ${truncateAddress(merchant)}`}
        className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 opacity-60 transition-opacity"
      >
        <div className="flex items-center gap-2 mb-1">
          <span className="h-2 w-2 rounded-full bg-gray-500 flex-shrink-0" aria-hidden="true" />
          <span className="text-xs text-gray-500 font-semibold uppercase tracking-wide">
            Cancelled
          </span>
        </div>
        <p className="text-sm text-gray-500 font-mono">{truncateAddress(merchant, 8)}</p>
      </article>
    );
  }

  return (
    <>
      <article
        aria-label={`Active subscription to ${truncateAddress(merchant)}`}
        className="rounded-2xl border border-gray-800 bg-gray-900 p-5 shadow-md hover:border-gray-700 transition-colors"
      >
        {/* Header row */}
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-1">
              Merchant
            </p>
            <p
              className="font-mono text-white text-sm truncate"
              title={merchant}
            >
              {truncateAddress(merchant, 8)}
            </p>
          </div>

          {/* Status badge */}
          <span
            className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full bg-green-900/40 border border-green-700/50 px-2.5 py-1 text-xs font-semibold text-green-300"
            aria-label="Subscription status: Active"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden="true" />
            Active
          </span>
        </div>

        {/* Details grid */}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm mb-4">
          {/* Token */}
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Token</dt>
            <dd className="font-mono text-gray-200 text-xs truncate" title={token}>
              {truncateAddress(token, 6)}
            </dd>
          </div>

          {/* Amount */}
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Amount</dt>
            <dd className="text-white font-semibold">
              {stroopsToTokens(amount)}
            </dd>
          </div>

          {/* Interval */}
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Interval</dt>
            <dd className="text-gray-200">Every {formatInterval(interval)}</dd>
          </div>

          {/* Next payment */}
          <div>
            <dt className="text-xs text-gray-500 mb-0.5">Next payment</dt>
            <dd
              className={
                overdue
                  ? 'text-yellow-300 font-semibold'
                  : 'text-gray-200'
              }
              aria-label={
                overdue
                  ? `Next payment overdue: ${formatDate(nextPayment)}`
                  : `Next payment: ${formatDate(nextPayment)}`
              }
            >
              {formatDate(nextPayment)}
              {overdue && (
                <span
                  className="ml-1.5 text-xs text-yellow-400"
                  aria-hidden="true"
                >
                  (overdue)
                </span>
              )}
            </dd>
          </div>
        </dl>

        {/* Cancel error */}
        {cancelError && (
          <div
            role="alert"
            className="mb-3 rounded-lg bg-red-900/50 border border-red-700 p-3 text-xs text-red-200"
          >
            <span className="font-semibold">Cancel failed:</span> {cancelError}
          </div>
        )}

        {/* Cancel button */}
        <button
          type="button"
          onClick={handleCancelClick}
          disabled={isCancelling}
          aria-busy={isCancelling}
          className="
            w-full mt-1 rounded-lg border border-red-700/50 bg-red-900/20
            px-4 py-2.5 text-sm font-semibold text-red-300
            hover:bg-red-900/40 hover:border-red-600 hover:text-red-200
            disabled:opacity-50 disabled:cursor-not-allowed
            focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
            transition-colors
          "
        >
          {isCancelling ? (
            <span className="flex items-center justify-center gap-2">
              <span
                aria-hidden="true"
                className="h-3.5 w-3.5 rounded-full border-2 border-red-400 border-t-transparent animate-spin"
              />
              Cancelling…
            </span>
          ) : (
            'Cancel Subscription'
          )}
        </button>
      </article>

      {/* Confirmation dialog */}
      {showConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-dialog-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 px-4"
        >
          <div className="w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl">
            <h2
              id="cancel-dialog-title"
              className="text-lg font-bold text-white mb-2"
            >
              Cancel subscription?
            </h2>
            <p className="text-sm text-gray-400 mb-1">
              You are about to cancel your subscription to:
            </p>
            <p className="font-mono text-sm text-white mb-4" aria-label={`Merchant: ${merchant}`}>
              {truncateAddress(merchant, 12)}
            </p>
            <p className="text-xs text-gray-500 mb-6">
              This will submit a{' '}
              <code className="bg-gray-800 px-1 rounded text-gray-300">cancel</code>{' '}
              transaction to the Soroban contract. You will need to approve it in
              Freighter. The subscription will be removed on-chain and no further
              payments will be collected.
            </p>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={handleCancelDismiss}
                className="
                  flex-1 rounded-lg border border-gray-700 bg-gray-800
                  px-4 py-2.5 text-sm font-semibold text-gray-300
                  hover:bg-gray-700 hover:text-white
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500
                  transition-colors
                "
              >
                Keep subscription
              </button>
              <button
                type="button"
                onClick={handleConfirmCancel}
                className="
                  flex-1 rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white
                  hover:bg-red-600
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
                  transition-colors
                "
              >
                Yes, cancel it
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
