"use client";

/**
 * Skeleton.tsx
 *
 * Reusable skeleton loading components for async data fetch areas.
 * Uses Tailwind's `animate-pulse` utility for a pulsing shimmer effect.
 *
 * FE-46: Add skeleton loading states for all async data fetches.
 *
 * ## Components
 * - `SkeletonLine`  — a single line of placeholder text
 * - `SkeletonCard`  — a card-shaped block (subscription card, history entry)
 * - `SkeletonRow`   — a horizontal row (table/list item)
 * - `SkeletonBadge` — a small badge / pill placeholder
 * - `SkeletonForm`  — a full form skeleton (used by SubscriptionForm pre-mount)
 * - `SkeletonPaymentHistory` — payment history section placeholder
 *
 * All skeletons carry `aria-busy="true"` and `aria-label="Loading…"` so screen
 * readers announce that content is being loaded.
 */

import React from "react";

// ─── Base skeleton block ───────────────────────────────────────────────────────

interface SkeletonBaseProps {
  className?: string;
  /** Override the default aria-label */
  label?: string;
}

/** A single skeleton block — the primitive for all other skeleton components. */
export function SkeletonBlock({ className = "", label = "Loading…" }: SkeletonBaseProps) {
  return (
    <div
      className={`animate-pulse rounded bg-gray-200 dark:bg-gray-800 ${className}`}
      aria-hidden="true"
      role="presentation"
    >
      <span className="sr-only">{label}</span>
    </div>
  );
}

// ─── SkeletonLine ──────────────────────────────────────────────────────────────

interface SkeletonLineProps {
  /** Width as a Tailwind class, e.g. "w-1/2", "w-full" */
  width?: string;
  /** Height as a Tailwind class, e.g. "h-4", "h-3" */
  height?: string;
  className?: string;
}

/** A single line of placeholder text. */
export function SkeletonLine({
  width = "w-full",
  height = "h-4",
  className = "",
}: SkeletonLineProps) {
  return <SkeletonBlock className={`${height} ${width} ${className}`} />;
}

// ─── SkeletonBadge ─────────────────────────────────────────────────────────────

/** A small pill/badge skeleton. */
export function SkeletonBadge({ className = "" }: { className?: string }) {
  return <SkeletonBlock className={`h-6 w-20 rounded-full ${className}`} />;
}

// ─── SkeletonRow ──────────────────────────────────────────────────────────────

interface SkeletonRowProps {
  /** Number of column blocks to render */
  columns?: number;
  className?: string;
}

/** A horizontal row of skeleton blocks — suitable for table rows or list items. */
export function SkeletonRow({ columns = 3, className = "" }: SkeletonRowProps) {
  return (
    <div
      className={`flex items-center gap-3 ${className}`}
      aria-busy="true"
      aria-label="Loading row…"
    >
      {/* Leading icon/avatar placeholder */}
      <SkeletonBlock className="h-8 w-8 rounded-full flex-shrink-0" />
      {/* Column blocks */}
      <div className="flex-1 flex gap-3">
        {Array.from({ length: columns }).map((_, i) => (
          <SkeletonBlock
            key={i}
            className={`h-4 ${i === 0 ? "w-1/3" : i === columns - 1 ? "w-1/4" : "flex-1"}`}
          />
        ))}
      </div>
    </div>
  );
}

// ─── SkeletonCard ─────────────────────────────────────────────────────────────

interface SkeletonCardProps {
  /** Number of content lines to render inside the card */
  lines?: number;
  /** Whether to show a header area */
  showHeader?: boolean;
  className?: string;
}

/** A card-shaped skeleton — suitable for subscription cards and history entries. */
export function SkeletonCard({
  lines = 3,
  showHeader = true,
  className = "",
}: SkeletonCardProps) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/40 p-5 sm:p-6 space-y-3 ${className}`}
      aria-busy="true"
      aria-label="Loading…"
    >
      {showHeader && (
        <div className="flex items-center justify-between gap-3 pb-2">
          <SkeletonBlock className="h-5 w-40" />
          <SkeletonBadge />
        </div>
      )}
      <div className="space-y-2.5">
        {Array.from({ length: lines }).map((_, i) => (
          <SkeletonLine
            key={i}
            width={i % 2 === 0 ? "w-full" : i % 3 === 1 ? "w-3/4" : "w-1/2"}
          />
        ))}
      </div>
    </div>
  );
}

// ─── SkeletonForm ─────────────────────────────────────────────────────────────

/**
 * Full-form skeleton — shown while SubscriptionForm is loading (pre-mount).
 * Matches the approximate dimensions of the real form to prevent layout shift.
 */
export function SkeletonForm({ className = "" }: { className?: string }) {
  return (
    <div
      className={`w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 space-y-5 ${className}`}
      aria-busy="true"
      aria-label="Loading subscription form…"
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <SkeletonBlock className="h-7 w-48" />
        <SkeletonBadge />
      </div>

      {/* Subtitle */}
      <SkeletonLine width="w-3/4" height="h-3" />

      {/* Four field groups */}
      {[1, 2, 3, 4].map((i) => (
        <div key={i} className="space-y-2">
          <SkeletonLine width="w-28" height="h-3" />
          <SkeletonBlock className="h-12 w-full rounded-lg" />
          <SkeletonLine width="w-3/4" height="h-3" />
        </div>
      ))}

      {/* Submit button */}
      <SkeletonBlock className="h-12 w-full rounded-lg bg-gray-700" />
    </div>
  );
}

// ─── SkeletonPaymentHistory ───────────────────────────────────────────────────

interface SkeletonPaymentHistoryProps {
  /** Number of rows to render */
  rows?: number;
  className?: string;
}

/**
 * Payment history section skeleton — displayed while transaction history is
 * being fetched from the Soroban RPC.
 */
export function SkeletonPaymentHistory({
  rows = 4,
  className = "",
}: SkeletonPaymentHistoryProps) {
  return (
    <section
      className={`w-full max-w-lg mt-6 ${className}`}
      aria-busy="true"
      aria-label="Loading payment history…"
    >
      <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-5 sm:p-6">
        {/* Section header */}
        <div className="flex items-center justify-between mb-4">
          <SkeletonBlock className="h-5 w-36" />
          <SkeletonBadge />
        </div>

        {/* Rows */}
        <div className="space-y-3" role="list" aria-label="Loading history rows">
          {Array.from({ length: rows }).map((_, i) => (
            <div
              key={i}
              className="rounded-lg border border-gray-800 bg-gray-900/60 p-3"
              role="listitem"
            >
              <SkeletonRow columns={3} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ─── SkeletonTokenBalance ─────────────────────────────────────────────────────

/** Token balance display skeleton. */
export function SkeletonTokenBalance({ className = "" }: { className?: string }) {
  return (
    <div
      className={`flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-900/40 px-4 py-3 ${className}`}
      aria-busy="true"
      aria-label="Loading token balance…"
    >
      <SkeletonBlock className="h-8 w-8 rounded-full flex-shrink-0" />
      <div className="flex-1 space-y-1.5">
        <SkeletonLine width="w-24" height="h-3" />
        <SkeletonLine width="w-16" height="h-5" />
      </div>
      <SkeletonBadge className="w-16" />
    </div>
  );
}

// ─── SkeletonFeeSimulation ────────────────────────────────────────────────────

/** Fee simulation result skeleton. */
export function SkeletonFeeSimulation({ className = "" }: { className?: string }) {
  return (
    <div
      className={`rounded-lg border border-gray-800 bg-gray-900/40 p-4 space-y-2 ${className}`}
      aria-busy="true"
      aria-label="Simulating transaction fee…"
    >
      <SkeletonLine width="w-40" height="h-4" />
      <div className="flex items-center gap-3">
        <SkeletonLine width="w-24" height="h-6" />
        <SkeletonLine width="w-16" height="h-3" />
      </div>
    </div>
  );
}

// ─── SkeletonWallet ───────────────────────────────────────────────────────────

/**
 * Wallet connection area skeleton — shown while wallet state is being
 * determined after mount. (FE-47 + FE-46 combined)
 */
export function SkeletonWallet({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-gray-900 rounded-2xl p-6 shadow-lg ${className}`}
      aria-busy="true"
      aria-label="Loading wallet status…"
    >
      <SkeletonBlock className="h-11 w-full rounded-lg" />
    </div>
  );
}
