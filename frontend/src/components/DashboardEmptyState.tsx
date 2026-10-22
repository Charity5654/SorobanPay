'use client';

/**
 * DashboardEmptyState.tsx
 *
 * Shown on the dashboard when the connected wallet has no active subscriptions.
 * Provides a call-to-action link back to the subscription creation form.
 *
 * Dashboard feature – subscriber view
 */

import Link from 'next/link';

export default function DashboardEmptyState() {
  return (
    <div
      className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-10 text-center"
      aria-label="No active subscriptions"
      data-testid="dashboard-empty-state"
    >
      {/* Icon */}
      <div
        className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gray-800 text-2xl"
        aria-hidden="true"
      >
        📭
      </div>

      {/* Heading */}
      <h2 className="text-lg font-bold text-white mb-2">
        No active subscriptions
      </h2>

      {/* Body */}
      <p className="text-gray-400 text-sm max-w-xs mx-auto mb-6 leading-relaxed">
        You don&apos;t have any active subscriptions yet. Create one to start making
        recurring payments on Stellar.
      </p>

      {/* CTA */}
      <Link
        href="/"
        className="
          inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5
          text-sm font-semibold text-white
          hover:bg-blue-500 transition-colors
          focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
        "
        aria-label="Go to home page to create a new subscription"
      >
        <span aria-hidden="true">+</span>
        Create a subscription
      </Link>
    </div>
  );
}
