"use client";

/**
 * SubscriptionHistory.tsx
 *
 * Displays a list of previously created subscriptions with status,
 * next payment time, and active indicators. Gives users visibility
 * into their on-chain recurring payments.
 *
 * Features:
 * - Shows all active and paused subscriptions
 * - Real-time next payment countdown
 * - Payment status indicators (Active, Paused, Overdue)
 * - Merchant and token information
 * - Payment frequency and amount
 * - Last payment tracking
 */

import { useState, useEffect, useCallback } from "react";
import { Address } from "@stellar/stellar-sdk";
import { AddressDisplay } from "@/components/AddressDisplay";
import { formatTokenWithSymbol } from "@/lib/token_decimals";

// ─── Types ─────────────────────────────────────────────────────────────────────

/** Subscription entry from contract query */
export interface SubscriptionEntry {
  subscriber: string;
  data: {
    token: string;
    amount: bigint;
    interval: u64;
    next_payment: u64;
    is_paused: boolean;
    grace_period: u64;
    overdue_since: u64 | null;
    payment_nonce: u64;
    paused_until: u64 | null;
  };
}

/** Computed subscription status */
export interface SubscriptionStatus {
  subscription: SubscriptionEntry;
  status: "active" | "paused" | "overdue" | "pending";
  nextPaymentIn: string; // e.g., "2 days, 3 hours"
  isOverdue: boolean;
  isPaused: boolean;
}

// ─── Status Calculation ─────────────────────────────────────────────────────────

/**
 * Calculate the current status of a subscription.
 * Status is computed based on timestamps and grace period.
 */
function getSubscriptionStatus(
  subscription: SubscriptionEntry,
  currentTimestamp: number,
): SubscriptionStatus {
  const { data } = subscription;
  const now = currentTimestamp;

  // Check if overdue
  const isOverdue = data.overdue_since !== null;
  const isPaused = data.is_paused;

  let status: "active" | "paused" | "overdue" | "pending" = "active";
  if (isPaused) {
    status = "paused";
  } else if (isOverdue) {
    status = "overdue";
  } else if (now < data.next_payment) {
    status = "pending";
  }

  // Calculate time until next payment
  const secondsUntilPayment = Math.max(0, data.next_payment - now);
  const nextPaymentIn = formatTimeRemaining(secondsUntilPayment);

  return {
    subscription,
    status,
    nextPaymentIn,
    isOverdue,
    isPaused,
  };
}

/**
 * Format seconds into human-readable "time remaining" format.
 * e.g., "2 days, 3 hours" or "1 hour, 30 minutes"
 */
function formatTimeRemaining(seconds: number): string {
  if (seconds <= 0) {
    return "Now";
  }

  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days} day${days !== 1 ? "s" : ""}`);
  if (hours > 0) parts.push(`${hours} hour${hours !== 1 ? "s" : ""}`);
  if (minutes > 0 && days === 0) parts.push(`${minutes} minute${minutes !== 1 ? "s" : ""}`);

  if (parts.length === 0) return "< 1 minute";
  if (parts.length === 1) return parts[0];
  return parts.slice(0, 2).join(", "); // Show max 2 units
}

/**
 * Format payment frequency (interval in seconds) to readable format.
 * e.g., "Every 7 days" or "Daily"
 */
function formatFrequency(intervalSeconds: number): string {
  const days = intervalSeconds / 86400;

  if (Number.isInteger(days)) {
    if (days === 1) return "Daily";
    if (days === 7) return "Weekly";
    if (days === 30) return "Monthly (approx)";
    return `Every ${Math.round(days)} days`;
  }

  const hours = intervalSeconds / 3600;
  if (Number.isInteger(hours)) {
    return `Every ${Math.round(hours)} hours`;
  }

  return `Every ${intervalSeconds} seconds`;
}

// ─── Status Indicator Components ────────────────────────────────────────────────

function StatusBadge({ status }: { status: "active" | "paused" | "overdue" | "pending" }) {
  const styles = {
    active: "bg-green-900/50 border-green-600/50 text-green-300",
    paused: "bg-yellow-900/50 border-yellow-600/50 text-yellow-300",
    overdue: "bg-red-900/50 border-red-600/50 text-red-300",
    pending: "bg-blue-900/50 border-blue-600/50 text-blue-300",
  };

  const labels = {
    active: "Active",
    paused: "Paused",
    overdue: "Overdue",
    pending: "Pending",
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold border ${styles[status]}`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          status === "active"
            ? "bg-green-400"
            : status === "paused"
              ? "bg-yellow-400"
              : status === "overdue"
                ? "bg-red-400"
                : "bg-blue-400"
        }`}
        aria-hidden="true"
      />
      {labels[status]}
    </span>
  );
}

// ─── Subscription Card ──────────────────────────────────────────────────────────

interface SubscriptionCardProps {
  status: SubscriptionStatus;
  getLabel?: (address: string) => string | null;
  onCancel?: (subscription: SubscriptionEntry) => void;
  onPause?: (subscription: SubscriptionEntry) => void;
}

function SubscriptionCard({
  status,
  getLabel,
  onCancel,
  onPause,
}: SubscriptionCardProps) {
  const { subscription, status: subscriptionStatus, nextPaymentIn, isPaused } = status;
  const { data } = subscription;

  const days = Math.round(data.interval / 86400);
  const dayLabel = days === 1 ? "day" : "days";

  return (
    <div className="rounded-lg border border-gray-700 bg-gray-900/50 p-4 space-y-3">
      {/* Header: Status and Merchant */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-200 mb-1">
            Subscription to{" "}
            <AddressDisplay
              address={data.token}
              getLabel={getLabel}
              truncateLen={8}
            />
          </p>
          <p className="text-xs text-gray-400 truncate">
            Merchant:{" "}
            <AddressDisplay
              address={subscription.subscriber}
              getLabel={getLabel}
              truncateLen={8}
            />
          </p>
        </div>
        <StatusBadge status={subscriptionStatus} />
      </div>

      {/* Payment Details Grid */}
      <div className="grid grid-cols-2 gap-3 text-xs">
        {/* Amount */}
        <div className="rounded bg-gray-800/30 p-2.5">
          <p className="text-gray-400 font-medium mb-0.5">Per Payment</p>
          <p className="font-mono text-gray-200 font-semibold">
            {formatTokenWithSymbol(BigInt(data.amount), 7)}
          </p>
        </div>

        {/* Frequency */}
        <div className="rounded bg-gray-800/30 p-2.5">
          <p className="text-gray-400 font-medium mb-0.5">Frequency</p>
          <p className="font-semibold text-gray-200">{formatFrequency(data.interval)}</p>
        </div>
      </div>

      {/* Next Payment / Status Info */}
      {isPaused && data.paused_until ? (
        <div className="rounded bg-yellow-900/20 border border-yellow-600/30 p-2.5 text-xs">
          <p className="text-yellow-300 font-medium">
            ⏸ Resumes on {new Date(data.paused_until * 1000).toLocaleDateString()}
          </p>
        </div>
      ) : subscriptionStatus === "overdue" ? (
        <div className="rounded bg-red-900/20 border border-red-600/30 p-2.5 text-xs">
          <p className="text-red-300 font-medium">
            ⚠ Overdue - Merchant can collect payment
          </p>
        </div>
      ) : (
        <div className="rounded bg-blue-900/20 border border-blue-600/30 p-2.5 text-xs">
          <p className="text-blue-300 font-medium">
            Next payment in {nextPaymentIn}
          </p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        {onPause && (
          <button
            onClick={() => onPause(subscription)}
            className="flex-1 rounded px-3 py-2 text-xs font-medium
                       border border-yellow-600/50 text-yellow-300
                       hover:bg-yellow-900/20 transition-colors"
          >
            {isPaused ? "Resume" : "Pause"}
          </button>
        )}
        {onCancel && (
          <button
            onClick={() => onCancel(subscription)}
            className="flex-1 rounded px-3 py-2 text-xs font-medium
                       border border-red-600/50 text-red-300
                       hover:bg-red-900/20 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </div>
  );
}

// ─── Main Component ────────────────────────────────────────────────────────────

export interface SubscriptionHistoryProps {
  /** List of subscriptions to display */
  subscriptions: SubscriptionEntry[];
  /** Optional callback to get display labels for addresses */
  getLabel?: (address: string) => string | null;
  /** Optional callback when user clicks pause */
  onPause?: (subscription: SubscriptionEntry) => void;
  /** Optional callback when user clicks cancel */
  onCancel?: (subscription: SubscriptionEntry) => void;
  /** Loading state */
  isLoading?: boolean;
  /** Error state */
  error?: string | null;
}

/**
 * Displays a list of user's active and paused subscriptions.
 * Shows payment status, next collection time, and actions.
 */
export function SubscriptionHistory({
  subscriptions,
  getLabel,
  onPause,
  onCancel,
  isLoading = false,
  error = null,
}: SubscriptionHistoryProps) {
  const [currentTime, setCurrentTime] = useState<number>(Math.floor(Date.now() / 1000));

  // Update current time every 10 seconds for real-time countdown
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Math.floor(Date.now() / 1000));
    }, 10000);

    return () => clearInterval(interval);
  }, []);

  // Compute statuses
  const statuses = subscriptions.map((sub) => getSubscriptionStatus(sub, currentTime));

  // Sort: active/overdue first, then by next payment time
  statuses.sort((a, b) => {
    const priorityA = a.status === "overdue" ? 0 : a.status === "active" ? 1 : 2;
    const priorityB = b.status === "overdue" ? 0 : b.status === "active" ? 1 : 2;

    if (priorityA !== priorityB) return priorityA - priorityB;
    return a.subscription.data.next_payment - b.subscription.data.next_payment;
  });

  if (isLoading) {
    return (
      <div className="w-full space-y-3">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-32 rounded-lg border border-gray-700 bg-gray-900/50 animate-pulse"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-600/50 bg-red-900/20 p-4 text-sm text-red-300"
      >
        Failed to load subscriptions: {error}
      </div>
    );
  }

  if (subscriptions.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-gray-700 bg-gray-900/30 p-8 text-center">
        <p className="text-sm text-gray-400">
          No subscriptions found. Create one to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="w-full space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-200">
          Your Subscriptions
        </h3>
        <span className="text-sm text-gray-400">
          {subscriptions.length} active
        </span>
      </div>

      <div className="space-y-3">
        {statuses.map((status, idx) => (
          <SubscriptionCard
            key={`${status.subscription.subscriber}-${idx}`}
            status={status}
            getLabel={getLabel}
            onCancel={onCancel}
            onPause={onPause}
          />
        ))}
      </div>
    </div>
  );
}
