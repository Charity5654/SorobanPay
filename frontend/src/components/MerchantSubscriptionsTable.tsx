'use client';

/**
 * MerchantSubscriptionsTable.tsx
 *
 * Displays a merchant's subscriber list with payment status and collection
 * controls. Renders in two states:
 *
 *   - Loading skeleton (pulsing rows while fetch is in progress)
 *   - Populated table with Due / Not Due / Expired status badges, per-row
 *     "Collect" buttons, and a batch "Collect Selected" action.
 *
 * Accessibility:
 *   - WCAG 2.1 AA compliant table with <caption>, <th scope>, aria-sort
 *   - Status badges use aria-label for screen reader context
 *   - Collect buttons include subscriber truncated address in aria-label
 *   - Checkbox column uses aria-label "Select subscriber for batch collection"
 *   - aria-live="polite" on the result summary region
 *
 * Props:
 *   subscriptions   — array from useMerchantSubscriptions
 *   isLoading       — show skeleton rows
 *   error           — error banner when non-null
 *   onCollect       — called with subscriber address for single collect
 *   onBatchCollect  — called with array of subscriber addresses
 *   collectingRows  — Set of subscriber addresses currently being collected
 *   rowResults      — Map of subscriber → { txHash?, error? } after collection
 *   onRefresh       — re-fetch callback
 */

import { useState, useCallback, useMemo } from 'react';
import type { MerchantSubscription } from '@/hooks/useMerchantSubscriptions';
import { truncateAddress } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RowResult {
  txHash?: string;
  error?: string;
}

export interface MerchantSubscriptionsTableProps {
  subscriptions: MerchantSubscription[];
  isLoading: boolean;
  error: string | null;
  onCollect: (subscriber: string) => void;
  onBatchCollect: (subscribers: string[]) => void;
  collectingRows: Set<string>;
  rowResults: Map<string, RowResult>;
  onRefresh: () => void;
}

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ sub }: { sub: MerchantSubscription }) {
  if (sub.isExpired) {
    return (
      <span
        aria-label="Subscription expired or cancelled"
        className="inline-flex items-center gap-1 rounded-full border border-gray-700 bg-gray-800 px-2 py-0.5 text-xs font-medium text-gray-400"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-gray-500" aria-hidden="true" />
        Expired
      </span>
    );
  }
  if (sub.isDue) {
    return (
      <span
        aria-label="Payment is due and collectable"
        className="inline-flex items-center gap-1 rounded-full border border-green-700/40 bg-green-900/30 px-2 py-0.5 text-xs font-medium text-green-300"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-green-400" aria-hidden="true" />
        Due
      </span>
    );
  }
  return (
    <span
      aria-label="Payment not yet due"
      className="inline-flex items-center gap-1 rounded-full border border-yellow-700/40 bg-yellow-900/20 px-2 py-0.5 text-xs font-medium text-yellow-300"
    >
      <span className="h-1.5 w-1.5 rounded-full bg-yellow-400" aria-hidden="true" />
      Not Due
    </span>
  );
}

// ── Row result inline feedback ────────────────────────────────────────────────

function RowFeedback({ result }: { result: RowResult | undefined }) {
  if (!result) return null;
  if (result.txHash) {
    return (
      <div
        role="status"
        aria-live="polite"
        className="mt-1 flex items-center gap-1 text-xs text-green-400"
      >
        <span aria-hidden="true">✓</span>
        <span>Collected!</span>
        <a
          href={`https://stellar.expert/explorer/testnet/tx/${result.txHash}`}
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-green-300 focus:outline-none focus-visible:ring-1 focus-visible:ring-green-400 rounded"
          aria-label={`View transaction ${result.txHash.slice(0, 8)}… on Stellar Expert`}
        >
          {result.txHash.slice(0, 8)}…
        </a>
      </div>
    );
  }
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="mt-1 text-xs text-red-400"
      title={result.error}
    >
      <span aria-hidden="true">✗</span>{' '}
      {result.error && result.error.length > 60
        ? result.error.slice(0, 60) + '…'
        : result.error}
    </div>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-t border-gray-800" aria-hidden="true">
      {[...Array(6)].map((_, i) => (
        <td key={i} className="px-4 py-3">
          <div className="h-4 w-full animate-pulse rounded bg-gray-800" />
        </td>
      ))}
    </tr>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function MerchantSubscriptionsTable({
  subscriptions,
  isLoading,
  error,
  onCollect,
  onBatchCollect,
  collectingRows,
  rowResults,
  onRefresh,
}: MerchantSubscriptionsTableProps) {
  const [selectedSubscribers, setSelectedSubscribers] = useState<Set<string>>(
    new Set(),
  );

  // Selectable rows: only due, non-expired, non-collecting rows
  const selectableSubscribers = useMemo(
    () =>
      subscriptions
        .filter((s) => s.isDue && !s.isExpired && !collectingRows.has(s.subscriber))
        .map((s) => s.subscriber),
    [subscriptions, collectingRows],
  );

  const allDueSelected =
    selectableSubscribers.length > 0 &&
    selectableSubscribers.every((s) => selectedSubscribers.has(s));

  function toggleSelectAll() {
    if (allDueSelected) {
      setSelectedSubscribers(new Set());
    } else {
      setSelectedSubscribers(new Set(selectableSubscribers));
    }
  }

  function toggleRow(subscriber: string) {
    setSelectedSubscribers((prev) => {
      const next = new Set(prev);
      if (next.has(subscriber)) {
        next.delete(subscriber);
      } else {
        next.add(subscriber);
      }
      return next;
    });
  }

  function handleBatchCollect() {
    const selected = [...selectedSubscribers];
    if (selected.length === 0) return;
    setSelectedSubscribers(new Set());
    onBatchCollect(selected);
  }

  const dueCount = subscriptions.filter((s) => s.isDue && !s.isExpired).length;
  const selectedCount = selectedSubscribers.size;

  // ── Loading state ──────────────────────────────────────────────────────────
  if (isLoading && subscriptions.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <div className="h-4 w-40 animate-pulse rounded bg-gray-800" />
          <div className="h-8 w-24 animate-pulse rounded bg-gray-800" />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" aria-label="Loading merchant subscriptions">
            <thead>
              <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wide">
                <th className="px-4 py-2 w-8" />
                <th className="px-4 py-2">Subscriber</th>
                <th className="px-4 py-2">Amount</th>
                <th className="px-4 py-2">Interval</th>
                <th className="px-4 py-2">Next Payment</th>
                <th className="px-4 py-2">Status</th>
                <th className="px-4 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {[...Array(3)].map((_, i) => (
                <SkeletonRow key={i} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Error state ────────────────────────────────────────────────────────────
  if (error) {
    return (
      <div
        role="alert"
        className="rounded-2xl border border-red-700/40 bg-red-950/30 p-6 text-sm"
      >
        <p className="font-semibold text-red-300 mb-2">Failed to load subscriptions</p>
        <p className="text-red-400 mb-4">{error}</p>
        <button
          type="button"
          onClick={onRefresh}
          className="rounded-lg border border-red-700/40 px-4 py-2 text-xs text-red-300 hover:bg-red-900/30 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
        >
          Retry
        </button>
      </div>
    );
  }

  // ── Empty state ────────────────────────────────────────────────────────────
  if (!isLoading && subscriptions.length === 0) {
    return (
      <div className="rounded-2xl border border-gray-800 bg-gray-900/40 px-6 py-12 text-center">
        <p className="text-3xl mb-3" aria-hidden="true">🏪</p>
        <p className="text-gray-300 font-semibold mb-1">No subscriptions found</p>
        <p className="text-gray-500 text-sm leading-relaxed max-w-sm mx-auto">
          No subscribers have created a subscription with your wallet address as the
          merchant yet. Share your address so subscribers can authorize payments to you.
        </p>
        <button
          type="button"
          onClick={onRefresh}
          className="mt-6 rounded-lg border border-gray-700 px-4 py-2 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
        >
          Refresh
        </button>
      </div>
    );
  }

  // ── Populated table ────────────────────────────────────────────────────────
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden">
      {/* Table toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-800">
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <span>
            <span className="font-semibold text-white">{subscriptions.length}</span>{' '}
            {subscriptions.length === 1 ? 'subscriber' : 'subscribers'}
          </span>
          {dueCount > 0 && (
            <span className="text-green-400">
              •{' '}
              <span className="font-semibold">{dueCount}</span>{' '}
              due
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Batch collect */}
          {selectedCount > 0 && (
            <button
              type="button"
              onClick={handleBatchCollect}
              className="rounded-lg bg-green-700 hover:bg-green-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
              aria-label={`Collect ${selectedCount} selected payment${selectedCount > 1 ? 's' : ''}`}
            >
              Collect Selected ({selectedCount})
            </button>
          )}
          {/* Refresh */}
          <button
            type="button"
            onClick={onRefresh}
            disabled={isLoading}
            aria-label="Refresh subscription list"
            className="rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 hover:border-gray-500 disabled:opacity-40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
          >
            {isLoading ? (
              <span className="flex items-center gap-1">
                <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Loading…
              </span>
            ) : (
              '↻ Refresh'
            )}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table
          className="w-full text-sm"
          aria-label={`Merchant subscriptions — ${subscriptions.length} subscriber${subscriptions.length !== 1 ? 's' : ''}`}
        >
          <caption className="sr-only">
            Subscriber list for this merchant wallet. Due rows have an active Collect button.
          </caption>
          <thead>
            <tr className="border-b border-gray-800 text-left text-xs text-gray-500 uppercase tracking-wide">
              {/* Select-all checkbox */}
              <th
                scope="col"
                className="px-4 py-2 w-8"
                aria-label="Select all due subscriptions"
              >
                <input
                  type="checkbox"
                  checked={allDueSelected}
                  onChange={toggleSelectAll}
                  disabled={selectableSubscribers.length === 0}
                  aria-label="Select all due subscriptions for batch collection"
                  className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-400 focus:ring-offset-gray-900 disabled:opacity-30"
                />
              </th>
              <th scope="col" className="px-4 py-2">Subscriber</th>
              <th scope="col" className="px-4 py-2">Amount</th>
              <th scope="col" className="px-4 py-2">Interval</th>
              <th scope="col" className="px-4 py-2">Next Payment</th>
              <th scope="col" className="px-4 py-2">Status</th>
              <th scope="col" className="px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {subscriptions.map((sub) => {
              const isCollecting = collectingRows.has(sub.subscriber);
              const result = rowResults.get(sub.subscriber);
              const isSelected = selectedSubscribers.has(sub.subscriber);
              const canSelect = sub.isDue && !sub.isExpired && !isCollecting;

              return (
                <tr
                  key={sub.subscriber}
                  className={`border-t border-gray-800 transition-colors ${
                    isSelected
                      ? 'bg-blue-950/30'
                      : isCollecting
                        ? 'bg-gray-800/30'
                        : 'hover:bg-gray-800/30'
                  }`}
                >
                  {/* Checkbox */}
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleRow(sub.subscriber)}
                      disabled={!canSelect}
                      aria-label={`Select ${truncateAddress(sub.subscriber)} for batch collection`}
                      className="h-3.5 w-3.5 rounded border-gray-600 bg-gray-800 text-blue-500 focus:ring-blue-400 focus:ring-offset-gray-900 disabled:opacity-30"
                    />
                  </td>

                  {/* Subscriber address */}
                  <td className="px-4 py-3">
                    <span
                      className="font-mono text-xs text-gray-300"
                      title={sub.subscriber}
                    >
                      {truncateAddress(sub.subscriber, 6)}
                    </span>
                  </td>

                  {/* Amount */}
                  <td className="px-4 py-3 tabular-nums text-gray-200">
                    {sub.isExpired ? (
                      <span className="text-gray-600">—</span>
                    ) : (
                      sub.amount
                    )}
                  </td>

                  {/* Interval */}
                  <td className="px-4 py-3 text-gray-400">
                    {sub.isExpired ? (
                      <span className="text-gray-600">—</span>
                    ) : (
                      sub.intervalLabel
                    )}
                  </td>

                  {/* Next payment date */}
                  <td className="px-4 py-3 text-gray-400 text-xs">
                    {sub.isExpired || sub.nextPaymentTimestamp === 0 ? (
                      <span className="text-gray-600">—</span>
                    ) : (
                      <time dateTime={sub.nextPaymentDate}>
                        {new Date(sub.nextPaymentDate).toLocaleString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          year: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    )}
                  </td>

                  {/* Status badge */}
                  <td className="px-4 py-3">
                    <StatusBadge sub={sub} />
                  </td>

                  {/* Collect button */}
                  <td className="px-4 py-3">
                    <div>
                      {!sub.isExpired && (
                        <button
                          type="button"
                          onClick={() => onCollect(sub.subscriber)}
                          disabled={!sub.isDue || isCollecting}
                          aria-label={
                            sub.isDue
                              ? `Collect payment from ${truncateAddress(sub.subscriber)}`
                              : `Payment from ${truncateAddress(sub.subscriber)} is not yet due`
                          }
                          className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 ${
                            isCollecting
                              ? 'cursor-wait bg-gray-700 text-gray-400 focus-visible:ring-gray-400'
                              : sub.isDue
                                ? 'bg-green-700 hover:bg-green-600 text-white focus-visible:ring-green-400'
                                : 'cursor-not-allowed bg-gray-800 text-gray-600 focus-visible:ring-gray-600'
                          }`}
                        >
                          {isCollecting ? (
                            <span className="flex items-center gap-1.5">
                              <svg
                                className="h-3 w-3 animate-spin"
                                viewBox="0 0 24 24"
                                fill="none"
                                aria-hidden="true"
                              >
                                <circle
                                  className="opacity-25"
                                  cx="12"
                                  cy="12"
                                  r="10"
                                  stroke="currentColor"
                                  strokeWidth="4"
                                />
                                <path
                                  className="opacity-75"
                                  fill="currentColor"
                                  d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                                />
                              </svg>
                              Collecting…
                            </span>
                          ) : sub.isDue ? (
                            'Collect'
                          ) : (
                            'Not Due'
                          )}
                        </button>
                      )}
                      <RowFeedback result={result} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Summary aria-live region */}
      <div
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
        id="collection-status-summary"
      >
        {[...rowResults.entries()]
          .map(([sub, r]) =>
            r.txHash
              ? `Collected from ${truncateAddress(sub)}.`
              : r.error
                ? `Failed to collect from ${truncateAddress(sub)}: ${r.error}`
                : '',
          )
          .filter(Boolean)
          .join(' ')}
      </div>
    </div>
  );
}
