'use client';

/**
 * SkeletonLoader.tsx
 *
 * Skeleton loading placeholders for the subscription form and wallet badge.
 * Used when async data (contract config, network info) is being fetched.
 */

// ─── Primitive skeleton block ─────────────────────────────────────────────────

interface SkeletonBlockProps {
  className?: string;
  'aria-label'?: string;
}

export function SkeletonBlock({ className = '', ...props }: SkeletonBlockProps) {
  return (
    <div
      role="status"
      aria-label={props['aria-label'] ?? 'Loading…'}
      className={`animate-pulse rounded bg-gray-700/60 ${className}`}
    />
  );
}

// ─── Wallet badge skeleton ────────────────────────────────────────────────────

export function WalletBadgeSkeleton() {
  return (
    <div
      className="w-full max-w-lg bg-gray-900 rounded-2xl p-4 sm:p-6 shadow-lg"
      aria-label="Loading wallet"
      role="status"
    >
      <SkeletonBlock className="h-11 w-full rounded-lg" aria-label="Loading connect button" />
    </div>
  );
}

// ─── Form field skeleton ──────────────────────────────────────────────────────

function SkeletonField() {
  return (
    <div className="space-y-2.5">
      <SkeletonBlock className="h-4 w-32" aria-label="Loading label" />
      <SkeletonBlock className="h-12 w-full rounded-lg" aria-label="Loading input" />
    </div>
  );
}

// ─── Subscription form skeleton ───────────────────────────────────────────────

export function SubscriptionFormSkeleton() {
  return (
    <div
      className="w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8"
      aria-label="Loading subscription form"
      role="status"
    >
      {/* Title */}
      <SkeletonBlock className="h-8 w-48 mb-2" aria-label="Loading title" />
      {/* Subtitle */}
      <SkeletonBlock className="h-4 w-72 mb-8" aria-label="Loading subtitle" />

      {/* Four form fields */}
      <div className="space-y-5 sm:space-y-6">
        <SkeletonField />
        <SkeletonField />
        <SkeletonField />
        <SkeletonField />

        {/* Submit button */}
        <SkeletonBlock className="h-14 w-full rounded-lg" aria-label="Loading submit button" />
      </div>
    </div>
  );
}

// ─── Page skeleton (wallet + form) ───────────────────────────────────────────

export function PageSkeleton() {
  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      {/* Header */}
      <div className="w-full max-w-lg mb-8 text-center space-y-2">
        <SkeletonBlock className="h-10 w-40 mx-auto" aria-label="Loading page title" />
        <SkeletonBlock className="h-4 w-64 mx-auto" aria-label="Loading page subtitle" />
      </div>

      {/* Wallet section */}
      <div className="w-full max-w-lg mb-6">
        <WalletBadgeSkeleton />
      </div>

      {/* Form */}
      <SubscriptionFormSkeleton />
    </main>
  );
}
