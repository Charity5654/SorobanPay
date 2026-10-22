"use client";

/**
 * SubscriptionSummary.tsx
 *
 * Compact summary component for subscription details before submission.
 * Displays the subscription parameters in a clear, scannable format
 * so users can confirm they're about to submit the correct values.
 *
 * Used in: SubscriptionForm before the submit button to improve UX
 * and reduce accidental misconfigurations.
 */

import { AddressDisplay } from "@/components/AddressDisplay";

export interface SubscriptionSummaryProps {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
  isValid: boolean;
  getLabel?: (address: string) => string | null;
}

/**
 * Displays a compact summary of subscription parameters.
 * Only shown when all form fields are valid.
 */
export function SubscriptionSummary({
  merchantAddress,
  tokenAddress,
  amount,
  interval,
  isValid,
  getLabel,
}: SubscriptionSummaryProps) {
  if (!isValid || !merchantAddress || !tokenAddress || !amount || !interval) {
    return null;
  }

  // Calculate days for display
  const days = Math.round(Number(interval) / 86400);
  const dayLabel = days === 1 ? "day" : "days";

  return (
    <div
      role="region"
      aria-labelledby="summary-heading"
      className="mb-4 rounded-lg bg-blue-900/20 border border-blue-600/40 p-4 space-y-3"
    >
      <h3
        id="summary-heading"
        className="text-xs font-semibold uppercase tracking-widest text-blue-300"
      >
        Subscription Summary
      </h3>

      <div className="grid grid-cols-1 gap-3 text-sm">
        {/* Merchant */}
        <div>
          <p className="text-xs text-gray-400 font-medium mb-1">Recipient (Merchant)</p>
          <p className="text-gray-200 break-all font-mono text-xs">
            <AddressDisplay
              address={merchantAddress}
              getLabel={getLabel}
              truncateLen={8}
            />
          </p>
        </div>

        {/* Token */}
        <div>
          <p className="text-xs text-gray-400 font-medium mb-1">Token Contract</p>
          <p className="text-gray-200 break-all font-mono text-xs">{tokenAddress}</p>
        </div>

        {/* Amount & Interval */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-xs text-gray-400 font-medium mb-1">Per Payment</p>
            <p className="text-gray-200 font-semibold">{amount}</p>
            <p className="text-xs text-gray-500">token units</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium mb-1">Frequency</p>
            <p className="text-gray-200 font-semibold">
              every {days} {dayLabel}
            </p>
            <p className="text-xs text-gray-500">
              {Number(interval).toLocaleString()} seconds
            </p>
          </div>
        </div>

        {/* Info box */}
        <div className="rounded-lg bg-gray-800/50 border border-gray-700/50 px-3 py-2.5 text-xs text-gray-300 space-y-1">
          <p className="text-blue-300 font-semibold">ℹ️ First payment collectible immediately after subscribing.</p>
          <p className="text-gray-400">
            Subsequent payments are collectible every {days} {dayLabel}.
          </p>
        </div>
      </div>
    </div>
  );
}
