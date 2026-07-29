'use client';

/**
 * /dashboard page
 *
 * Subscriber view: lists all active subscriptions for the connected wallet.
 * Provides a cancel flow for each subscription with Freighter signing and
 * optimistic UI updates.
 *
 * Acceptance criteria:
 *   - Lists all active subscriptions for connected wallet
 *   - Next payment date computed from on-chain get_subscription() query
 *   - Cancel flow: Freighter popup → success/error states
 *   - Empty state when no active subscriptions
 *   - Responsive layout (mobile + desktop)
 *   - Accessible: keyboard navigable, screen-reader friendly
 *
 * Dashboard feature – subscriber view
 */

import { useCallback } from 'react';
import Link from 'next/link';
import { useWallet } from '@/hooks/useWallet';
import {
  useSubscriptions,
  type UseSubscriptionsInternalReturn,
} from '@/hooks/useSubscriptions';
import SubscriptionCard from '@/components/SubscriptionCard';
import DashboardEmptyState from '@/components/DashboardEmptyState';

// ─── Wallet not connected state ────────────────────────────────────────────────

function NotConnectedState({
  connect,
  isConnecting,
  connectError,
  freighterInstalled,
}: {
  connect: () => Promise<void>;
  isConnecting: boolean;
  connectError: string | null;
  freighterInstalled: boolean;
}) {
  return (
    <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-10 text-center space-y-4">
      <p className="text-3xl" aria-hidden="true">🔒</p>
      <h2 className="text-lg font-bold text-white">Connect your wallet</h2>
      <p className="text-gray-400 text-sm max-w-xs mx-auto leading-relaxed">
        Connect your Freighter wallet to view and manage your active
        subscriptions.
      </p>

      {!freighterInstalled && (
        <div
          role="alert"
          className="rounded-lg bg-yellow-900/60 border border-yellow-600 p-3 text-sm text-yellow-200 max-w-xs mx-auto"
        >
          Freighter is not installed.{' '}
          <a
            href="https://www.freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-yellow-100"
          >
            Install Freighter
          </a>{' '}
          to continue.
        </div>
      )}

      {connectError && (
        <div
          role="alert"
          className="rounded-lg bg-red-900/60 border border-red-600 p-3 text-sm text-red-200 max-w-xs mx-auto"
        >
          {connectError}
        </div>
      )}

      <button
        type="button"
        onClick={connect}
        disabled={isConnecting}
        className="
          inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5
          text-sm font-semibold text-white
          hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed
          focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
          transition-colors
        "
      >
        {isConnecting ? 'Connecting…' : 'Connect Freighter Wallet'}
      </button>
    </div>
  );
}

// ─── Loading skeleton ──────────────────────────────────────────────────────────

function LoadingSkeleton() {
  return (
    <div
      aria-label="Loading subscriptions"
      aria-busy="true"
      className="grid gap-4 sm:grid-cols-2"
      data-testid="dashboard-loading"
    >
      {[1, 2, 3].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-gray-800 bg-gray-900 p-5 animate-pulse"
          aria-hidden="true"
        >
          <div className="flex justify-between mb-4">
            <div>
              <div className="h-3 w-14 rounded bg-gray-800 mb-2" />
              <div className="h-4 w-36 rounded bg-gray-700" />
            </div>
            <div className="h-6 w-16 rounded-full bg-gray-800" />
          </div>
          <div className="grid grid-cols-2 gap-3 mb-4">
            {[1, 2, 3, 4].map((j) => (
              <div key={j}>
                <div className="h-3 w-12 rounded bg-gray-800 mb-1" />
                <div className="h-4 w-20 rounded bg-gray-700" />
              </div>
            ))}
          </div>
          <div className="h-10 w-full rounded-lg bg-gray-800" />
        </div>
      ))}
    </div>
  );
}

// ─── Dashboard page ────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const {
    publicKey,
    isConnecting,
    connectError,
    freighterInstalled,
    connect,
    disconnect,
  } = useWallet();

  // Cast to internal type to access _updateSubscription
  const hookResult = useSubscriptions(publicKey) as UseSubscriptionsInternalReturn;
  const { subscriptions, isLoading, error, refetch, _updateSubscription } = hookResult;

  const shortKey = publicKey
    ? `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
    : null;

  // When a subscription is successfully cancelled on-chain, apply optimistic update
  const handleCancelled = useCallback(
    (key: string) => {
      _updateSubscription(key, { cancelledAt: new Date(), isCancelling: false });
    },
    [_updateSubscription],
  );

  const handleCancelStateChange = useCallback(
    (key: string, cancelling: boolean) => {
      _updateSubscription(key, { isCancelling: cancelling });
    },
    [_updateSubscription],
  );

  // Active subscriptions: not yet optimistically cancelled
  const visibleSubscriptions = subscriptions.filter(
    (s) => s.cancelledAt === null || s.isCancelling,
  );

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      {/* Back nav */}
      <div className="w-full max-w-2xl mb-6">
        <Link
          href="/"
          className="
            inline-flex items-center gap-1.5 text-sm text-gray-400
            hover:text-white transition-colors
            focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded
          "
          aria-label="Back to home page"
        >
          <span aria-hidden="true">←</span>
          Back to home
        </Link>
      </div>

      {/* Page header */}
      <div className="w-full max-w-2xl mb-8">
        <h1 className="text-3xl font-extrabold tracking-tight text-white mb-1">
          My Subscriptions
        </h1>
        <p className="text-gray-400 text-sm">
          View and manage your active recurring payments on Stellar.
        </p>
      </div>

      {/* Wallet bar */}
      <div className="w-full max-w-2xl mb-6">
        {publicKey ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-900 p-4 flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span
                className="h-2 w-2 rounded-full bg-green-400 flex-shrink-0"
                aria-hidden="true"
              />
              <span className="text-sm text-gray-300 flex-shrink-0">Connected:</span>
              <span
                className="font-mono text-white text-sm truncate"
                title={publicKey}
              >
                {shortKey}
              </span>
            </div>
            <div className="flex items-center gap-3 flex-shrink-0">
              <button
                type="button"
                onClick={refetch}
                disabled={isLoading}
                className="
                  text-xs text-gray-400 hover:text-white transition-colors
                  focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 rounded px-2 py-1
                  disabled:opacity-40
                "
                aria-label="Refresh subscriptions"
              >
                {isLoading ? (
                  <span
                    aria-hidden="true"
                    className="inline-block h-3 w-3 rounded-full border-2 border-gray-400 border-t-transparent animate-spin"
                  />
                ) : (
                  '↻ Refresh'
                )}
              </button>
              <button
                type="button"
                onClick={disconnect}
                className="
                  text-xs text-gray-400 hover:text-red-400 transition-colors
                  focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400 rounded px-2 py-1
                "
              >
                Disconnect
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {/* Main content area */}
      <div className="w-full max-w-2xl">
        {!publicKey ? (
          <NotConnectedState
            connect={connect}
            isConnecting={isConnecting}
            connectError={connectError}
            freighterInstalled={freighterInstalled}
          />
        ) : isLoading ? (
          <LoadingSkeleton />
        ) : error ? (
          <div
            role="alert"
            className="rounded-2xl border border-red-800 bg-red-900/20 p-6 space-y-3"
          >
            <p className="text-red-300 font-semibold text-sm">
              Failed to load subscriptions
            </p>
            <p className="text-red-400 text-xs leading-relaxed">{error}</p>
            <button
              type="button"
              onClick={refetch}
              className="
                rounded-lg border border-red-700 bg-red-900/40 px-4 py-2 text-xs
                font-semibold text-red-300 hover:bg-red-900/60 transition-colors
                focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
              "
            >
              Try again
            </button>
          </div>
        ) : visibleSubscriptions.length === 0 ? (
          <DashboardEmptyState />
        ) : (
          <section aria-label="Active subscriptions">
            {/* Count header */}
            <p className="text-xs text-gray-500 uppercase tracking-wide font-semibold mb-4">
              {visibleSubscriptions.length}{' '}
              {visibleSubscriptions.length === 1 ? 'subscription' : 'subscriptions'}
            </p>

            {/* Card grid — 1 col mobile, 2 col sm+ */}
            <ul
              className="grid gap-4 sm:grid-cols-2"
              aria-label="Subscription cards"
            >
              {subscriptions.map((sub) => (
                <li key={sub.key}>
                  <SubscriptionCard
                    subscriber={publicKey}
                    merchant={sub.merchant}
                    token={sub.token}
                    amount={sub.amount}
                    interval={sub.interval}
                    nextPayment={sub.nextPayment}
                    subscriptionKey={sub.key}
                    isCancelling={sub.isCancelling}
                    cancelledAt={sub.cancelledAt}
                    onCancelled={handleCancelled}
                    onCancelStateChange={handleCancelStateChange}
                  />
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>

      {/* Footer note */}
      <div className="w-full max-w-2xl mt-12 text-center">
        <p className="text-xs text-gray-600 leading-relaxed">
          Subscriptions are fetched from the Soroban event log.{' '}
          <button
            type="button"
            onClick={refetch}
            disabled={isLoading || !publicKey}
            className="
              text-gray-500 underline hover:text-gray-300 transition-colors
              focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 rounded
              disabled:opacity-40
            "
          >
            Refresh
          </button>{' '}
          if you just created or cancelled a subscription.
        </p>
      </div>
    </main>
  );
}
