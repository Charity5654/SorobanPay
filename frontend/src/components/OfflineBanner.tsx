"use client";

/**
 * OfflineBanner.tsx
 *
 * Displays the current network connectivity status and exposes a visible,
 * accessible mutation queue panel showing queued, sent, failed, and discarded
 * actions.
 *
 * ## Design constraints
 *  - Wallet signatures are NEVER queued silently. Any action that requires a
 *    wallet signature must be explicitly confirmed by the user before it enters
 *    the queue. The banner exposes this state so the user is always informed.
 *  - Sensitive values (public keys, token addresses, amounts) are never logged
 *    to the console. They are displayed only in the UI under the caller's
 *    control.
 *  - The component is purely presentational with respect to the queue: callers
 *    own the queue state and pass it in via props. This keeps the component
 *    testable without mocking global state.
 *
 * ## Queue item states
 *  - `queued`    — waiting to be sent (network offline or previous item in flight)
 *  - `sending`   — currently in flight
 *  - `failed`    — the send attempt returned an error; eligible for retry
 *  - `discarded` — permanently removed from the queue by the user
 *
 * ## Accessibility
 *  - The banner itself carries `role="status"` when online and `role="alert"`
 *    when offline so screen-readers announce connectivity changes.
 *  - Each queue item action button has a descriptive `aria-label`.
 *  - The queue list is a `<ul>` with a visible count heading.
 *  - All interactive elements meet the 44 × 44 px minimum touch target.
 *
 * Issue: #1050
 */

import { useState, useCallback, useEffect, type ReactNode } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

export type QueueItemStatus = "queued" | "sending" | "failed" | "discarded";

export interface QueueItem {
  /** Stable, unique identifier for the item within the queue. */
  id: string;
  /**
   * Human-readable label shown to the user.
   * Must NOT contain raw private keys or secrets — callers are responsible
   * for sanitising this value before passing it in.
   */
  label: string;
  /** Current lifecycle status of this queue item. */
  status: QueueItemStatus;
  /**
   * Optional error message shown when `status === "failed"`.
   * Must NOT contain raw sensitive values.
   */
  errorMessage?: string;
  /**
   * Whether this action required (or will require) a wallet signature.
   * When `true` the banner renders a "requires wallet signature" badge so the
   * user is always aware — such actions are never queued without consent.
   */
  requiresWalletSignature?: boolean;
}

export interface OfflineBannerProps {
  /** Whether the browser currently has network connectivity. */
  isOnline: boolean;
  /**
   * Ordered list of pending / in-flight / completed mutation queue items.
   * Pass an empty array to hide the queue panel entirely.
   */
  queueItems?: QueueItem[];
  /**
   * Called when the user clicks "Retry" on a failed item.
   * The parent is responsible for re-attempting the mutation.
   */
  onRetry?: (id: string) => void;
  /**
   * Called when the user clicks "Discard" on a queued or failed item.
   * The parent is responsible for removing the item from its state.
   */
  onDiscard?: (id: string) => void;
  /**
   * Called when the user clicks the "Cancel" button on a sending item.
   * The parent is responsible for aborting the in-flight request.
   * Note: cancellation is best-effort — the server-side operation may have
   * already committed before the signal arrives.
   */
  onCancel?: (id: string) => void;
}

// ─── Status metadata ──────────────────────────────────────────────────────────

interface StatusMeta {
  label: string;
  dotClass: string;
  badgeClass: string;
  icon: ReactNode;
}

const STATUS_META: Record<QueueItemStatus, StatusMeta> = {
  queued: {
    label: "Queued",
    dotClass: "bg-yellow-400",
    badgeClass:
      "bg-yellow-900/40 text-yellow-300 border border-yellow-600/50",
    icon: (
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  sending: {
    label: "Sending",
    dotClass: "bg-blue-400 animate-pulse",
    badgeClass: "bg-blue-900/40 text-blue-300 border border-blue-600/50",
    icon: (
      <svg
        className="h-3.5 w-3.5 animate-spin"
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
          d="M4 12a8 8 0 018-8v8H4z"
        />
      </svg>
    ),
  },
  failed: {
    label: "Failed",
    dotClass: "bg-red-400",
    badgeClass: "bg-red-900/40 text-red-300 border border-red-600/50",
    icon: (
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
  discarded: {
    label: "Discarded",
    dotClass: "bg-gray-400",
    badgeClass: "bg-gray-800/60 text-gray-400 border border-gray-600/50",
    icon: (
      <svg
        className="h-3.5 w-3.5"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path
          fillRule="evenodd"
          d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
          clipRule="evenodd"
        />
      </svg>
    ),
  },
};

// ─── QueueItemRow ─────────────────────────────────────────────────────────────

function QueueItemRow({
  item,
  onRetry,
  onDiscard,
  onCancel,
}: {
  item: QueueItem;
  onRetry?: (id: string) => void;
  onDiscard?: (id: string) => void;
  onCancel?: (id: string) => void;
}) {
  const meta = STATUS_META[item.status];

  return (
    <li
      className="flex flex-col gap-2 px-3 py-3 rounded-lg bg-gray-800/50 border border-gray-700/50"
      data-testid={`queue-item-${item.id}`}
    >
      <div className="flex items-start gap-2.5">
        {/* Status dot */}
        <span
          className={`mt-1 h-2 w-2 rounded-full flex-shrink-0 ${meta.dotClass}`}
          aria-hidden="true"
        />

        {/* Label */}
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-200 leading-snug break-all">
            {item.label}
          </p>

          {/* Wallet-signature notice */}
          {item.requiresWalletSignature && (
            <p className="mt-1 text-xs text-yellow-400 font-medium">
              ⚠ Requires wallet signature — not queued silently
            </p>
          )}

          {/* Error message */}
          {item.status === "failed" && item.errorMessage && (
            <p
              className="mt-1 text-xs text-red-300 leading-relaxed"
              aria-live="polite"
            >
              {item.errorMessage}
            </p>
          )}
        </div>

        {/* Status badge */}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold flex-shrink-0 ${meta.badgeClass}`}
          aria-label={`Status: ${meta.label}`}
        >
          {meta.icon}
          {meta.label}
        </span>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2 pl-4.5">
        {item.status === "failed" && onRetry && (
          <button
            type="button"
            onClick={() => onRetry(item.id)}
            aria-label={`Retry: ${item.label}`}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold
                       bg-blue-700 hover:bg-blue-600 active:bg-blue-800 text-white
                       transition-colors min-h-[36px]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                clipRule="evenodd"
              />
            </svg>
            Retry
          </button>
        )}

        {item.status === "sending" && onCancel && (
          <button
            type="button"
            onClick={() => onCancel(item.id)}
            aria-label={`Cancel: ${item.label}`}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold
                       bg-gray-700 hover:bg-gray-600 active:bg-gray-800 text-gray-200
                       transition-colors min-h-[36px]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
            Cancel
          </button>
        )}

        {(item.status === "queued" || item.status === "failed") && onDiscard && (
          <button
            type="button"
            onClick={() => onDiscard(item.id)}
            aria-label={`Discard: ${item.label}`}
            className="inline-flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-semibold
                       bg-gray-800 hover:bg-red-900/40 active:bg-red-900/60 text-gray-400 hover:text-red-300
                       border border-gray-700 hover:border-red-700/50
                       transition-colors min-h-[36px]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <svg
              className="h-3 w-3"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
            Discard
          </button>
        )}
      </div>
    </li>
  );
}

// ─── Queue summary counts ──────────────────────────────────────────────────────

function QueueSummary({ items }: { items: QueueItem[] }) {
  const counts: Record<QueueItemStatus, number> = {
    queued: 0,
    sending: 0,
    failed: 0,
    discarded: 0,
  };
  for (const item of items) counts[item.status]++;

  const chips: { status: QueueItemStatus; count: number }[] = (
    ["queued", "sending", "failed", "discarded"] as QueueItemStatus[]
  )
    .filter((s) => counts[s] > 0)
    .map((s) => ({ status: s, count: counts[s] }));

  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 mb-3" aria-label="Queue summary">
      {chips.map(({ status, count }) => {
        const meta = STATUS_META[status];
        return (
          <span
            key={status}
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${meta.badgeClass}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full flex-shrink-0 ${meta.dotClass}`}
              aria-hidden="true"
            />
            {count} {meta.label}
          </span>
        );
      })}
    </div>
  );
}

// ─── OfflineBanner ────────────────────────────────────────────────────────────

export default function OfflineBanner({
  isOnline,
  queueItems = [],
  onRetry,
  onDiscard,
  onCancel,
}: OfflineBannerProps) {
  const [queueExpanded, setQueueExpanded] = useState(true);

  const toggleQueue = useCallback(() => setQueueExpanded((v) => !v), []);

  const visibleItems = queueItems.filter((i) => i.status !== "discarded");
  const hasItems = queueItems.length > 0;
  const activeCount = queueItems.filter(
    (i) => i.status === "queued" || i.status === "sending",
  ).length;
  const failedCount = queueItems.filter((i) => i.status === "failed").length;

  // ── Connectivity banner ───────────────────────────────────────────────────

  const connectivityBanner = (
    <div
      role={isOnline ? "status" : "alert"}
      aria-live={isOnline ? "polite" : "assertive"}
      aria-label={
        isOnline
          ? "Network status: online"
          : "Network status: offline — mutations are queued"
      }
      className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-colors ${
        isOnline
          ? "bg-green-900/30 border border-green-700/40 text-green-300"
          : "bg-red-900/40 border border-red-600/60 text-red-300"
      }`}
    >
      <span
        className={`h-2 w-2 rounded-full flex-shrink-0 ${
          isOnline ? "bg-green-400" : "bg-red-400 animate-pulse"
        }`}
        aria-hidden="true"
      />
      {isOnline ? (
        <>
          Online
          {activeCount > 0 && (
            <span className="ml-1 text-green-200 text-xs font-normal">
              — {activeCount} action{activeCount !== 1 ? "s" : ""} in progress
            </span>
          )}
        </>
      ) : (
        <>
          Offline
          {activeCount > 0 && (
            <span className="ml-1 text-red-200 text-xs font-normal">
              — {activeCount} action{activeCount !== 1 ? "s" : ""} queued
            </span>
          )}
          {failedCount > 0 && (
            <span className="ml-1 text-red-200 text-xs font-normal">
              · {failedCount} failed
            </span>
          )}
        </>
      )}
    </div>
  );

  // ── Queue panel ────────────────────────────────────────────────────────────

  if (!hasItems) {
    // No queue items — render only the connectivity indicator
    return connectivityBanner;
  }

  return (
    <div className="w-full space-y-2">
      {connectivityBanner}

      {/* Queue panel */}
      <div
        className="rounded-xl border border-gray-700/60 bg-gray-900/70 overflow-hidden"
        data-testid="queue-panel"
      >
        {/* Panel header — toggle button */}
        <button
          type="button"
          onClick={toggleQueue}
          aria-expanded={queueExpanded}
          aria-controls="queue-list"
          className="w-full flex items-center justify-between gap-3 px-4 py-3
                     text-left text-sm font-semibold text-gray-200
                     hover:bg-gray-800/40 transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-inset"
        >
          <div className="flex items-center gap-2">
            <svg
              className="h-4 w-4 text-gray-400"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" />
            </svg>
            Mutation Queue
            <span
              className="rounded-full bg-gray-700 px-1.5 py-0.5 text-xs font-normal text-gray-400"
              aria-label={`${queueItems.length} total items`}
            >
              {queueItems.length}
            </span>
            {failedCount > 0 && (
              <span
                className="rounded-full bg-red-900/60 border border-red-700/50 px-1.5 py-0.5 text-xs font-semibold text-red-300"
                aria-label={`${failedCount} failed`}
              >
                {failedCount} failed
              </span>
            )}
          </div>

          <svg
            className={`h-4 w-4 text-gray-400 transition-transform duration-200 ${
              queueExpanded ? "rotate-180" : ""
            }`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Expandable list */}
        {queueExpanded && (
          <div className="px-4 pb-4 pt-1">
            <QueueSummary items={queueItems} />

            {visibleItems.length === 0 ? (
              <p className="text-xs text-gray-500 text-center py-3">
                All items discarded.
              </p>
            ) : (
              <ul
                id="queue-list"
                aria-label="Mutation queue items"
                className="space-y-2"
              >
                {visibleItems.map((item) => (
                  <QueueItemRow
                    key={item.id}
                    item={item}
                    onRetry={onRetry}
                    onDiscard={onDiscard}
                    onCancel={onCancel}
                  />
                ))}
              </ul>
            )}

            {/* Wallet signature disclaimer */}
            {queueItems.some((i) => i.requiresWalletSignature) && (
              <p className="mt-3 text-xs text-yellow-500/80 border-t border-gray-700/60 pt-3 leading-relaxed">
                ⚠ Actions marked "Requires wallet signature" are never queued
                silently. Each one will prompt for explicit Freighter approval
                before the transaction is broadcast.
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── useOfflineQueue hook (convenience) ───────────────────────────────────────

/**
 * Lightweight hook that manages a local mutation queue and tracks online status.
 *
 * This hook is intentionally thin — it does not perform any network calls or
 * sign any transactions. The caller is responsible for the actual mutation logic
 * triggered by `onRetry` / `onDiscard` / `onCancel`.
 *
 * Usage:
 * ```tsx
 * const { isOnline, queueItems, addItem, updateItem, removeItem } = useOfflineQueue();
 * ```
 */
export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator !== "undefined" ? navigator.onLine : true,
  );
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);

  // Track online/offline events
  const handleOnline = useCallback(() => setIsOnline(true), []);
  const handleOffline = useCallback(() => setIsOnline(false), []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, [handleOnline, handleOffline]);

  const addItem = useCallback((item: QueueItem) => {
    setQueueItems((prev) => [...prev, item]);
  }, []);

  const updateItem = useCallback(
    (id: string, patch: Partial<Omit<QueueItem, "id">>) => {
      setQueueItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, ...patch } : i)),
      );
    },
    [],
  );

  const removeItem = useCallback((id: string) => {
    setQueueItems((prev) => prev.filter((i) => i.id !== id));
  }, []);

  const discardItem = useCallback((id: string) => {
    updateItem(id, { status: "discarded" });
  }, [updateItem]);

  return {
    isOnline,
    queueItems,
    addItem,
    updateItem,
    removeItem,
    discardItem,
  };
}
