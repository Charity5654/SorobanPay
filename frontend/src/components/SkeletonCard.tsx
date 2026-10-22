'use client';

/**
 * SkeletonCard.tsx — Issue #824
 *
 * Reusable animated-pulse placeholder shown in place of a metric card or
 * chart while dashboard data is loading. Sized by the caller via `className`
 * / `style` so it can be rendered at the exact dimensions of the real content
 * it stands in for — that's what avoids layout shift when data arrives.
 *
 * Works in both themes: `bg-gray-200` (light) / `dark:bg-gray-700` (dark).
 */

import type { CSSProperties } from 'react';

interface SkeletonCardProps {
  /**
   * Extra classes — set width/height and rounding to match the real content
   * (e.g. `rounded-full w-36 h-36` for a circular chart, `rounded-xl w-full`
   * for a card). Rounding is intentionally NOT defaulted here: two `rounded-*`
   * utilities both present in the class list resolve by Tailwind's generated
   * stylesheet order, not by which one appears later in `className`, so a
   * default here could silently outrank a caller's override.
   */
  className?: string;
  /** Inline style escape hatch, e.g. a pixel height matching a specific chart. */
  style?: CSSProperties;
  /** Accessible label for the loading region. */
  label?: string;
}

export default function SkeletonCard({
  className = '',
  style,
  label = 'Loading…',
}: SkeletonCardProps) {
  return (
    <div
      role="status"
      aria-label={label}
      style={style}
      className={`animate-pulse bg-gray-200 dark:bg-gray-700 ${className}`}
    />
  );
}

/**
 * SkeletonMetricCard — a composed skeleton matching a full metric-card
 * layout (bordered container + label line + value line), for dashboards
 * whose loading state needs to stand in for a whole card rather than just
 * its inner content.
 */
export function SkeletonMetricCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-2xl border border-gray-200 dark:border-slate-800 bg-white dark:bg-slate-900/60 p-5 space-y-3 ${className}`}
    >
      <SkeletonCard className="rounded h-3.5 w-2/5" label="Loading metric label" />
      <SkeletonCard className="rounded h-7 w-1/3" label="Loading metric value" />
    </div>
  );
}
