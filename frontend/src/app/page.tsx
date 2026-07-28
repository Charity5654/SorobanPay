'use client';

/**
 * page.tsx — Home page (Dashboard)
 *
 * Renders the wallet connect/disconnect button and the subscription form.
 * When the wallet is not connected, shows the EmptySubscriptions empty state
 * to guide users toward their first action (#453 UX-118).
 *
 * Requirements: 9.1, 9.5, 9.6, 10.1
 */

import SubscriptionForm from '@/components/SubscriptionForm';
import { EmptySubscriptions } from '@/components/EmptyState';
import { StatusBadge } from '@/components/StatusBadge';
import { useWallet } from '@/hooks/useWallet';

export default function Home() {
  const {
    publicKey,
    isConnecting,
    connectError,
    freighterInstalled,
    connect,
    disconnect,
  } = useWallet();

  const shortKey = publicKey
    ? `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
    : null;

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      {/* Header */}
      <div className="w-full max-w-lg mb-8 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight mb-2">SorobanPay</h1>
        <p className="text-content-secondary text-sm">
          Decentralized recurring payments on Stellar
        </p>
      </div>

      {/* Wallet section */}
      <div className="w-full max-w-lg mb-6">
        {!publicKey ? (
          <div className="bg-surface-raised rounded-2xl p-6 shadow-lg">
            {/* Freighter install prompt */}
            {!freighterInstalled && (
              <div
                role="alert"
                className="mb-4 rounded-lg bg-status-warning-surface border border-status-warning-border p-3 text-sm"
              >
                <span className="text-status-warning-text flex items-center gap-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Freighter wallet is not installed.{' '}
                  <a
                    href="https://www.freighter.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:opacity-80"
                  >
                    Install Freighter
                  </a>{' '}
                  to continue.
                </span>
              </div>
            )}

            {/* Connection error */}
            {connectError && (
              <div
                role="alert"
                className="mb-4 rounded-lg bg-status-error-surface border border-status-error-border p-3 text-sm text-status-error-text"
              >
                {connectError}
              </div>
            )}

            <button
              onClick={connect}
              disabled={isConnecting}
              className="w-full rounded-lg bg-interactive-primary hover:bg-interactive-primary-hover
                         disabled:opacity-50 disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold
                         text-white transition-colors duration-150 min-h-[48px]
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-interactive-focus
                         focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base"
            >
              {isConnecting ? 'Connecting…' : 'Connect Freighter Wallet'}
            </button>
          </div>
        ) : (
          /* Show address and enable form actions */
          <div className="bg-surface-raised rounded-2xl p-4 shadow-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <StatusBadge variant="success" srLabel="Wallet connected">
                Connected
              </StatusBadge>
              <span className="font-mono text-sm text-content-primary truncate">{shortKey}</span>
            </div>
            <button
              onClick={disconnect}
              className="text-xs text-content-tertiary hover:text-status-error-text transition-colors
                         focus:outline-none focus-visible:ring-1 focus-visible:ring-status-error-border
                         rounded px-2 py-1 shrink-0"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Subscription form — only rendered when wallet is connected */}
      {publicKey ? (
        <SubscriptionForm />
      ) : (
        /*
         * #453 UX-118: Empty state for dashboard when wallet is not connected.
         * Guides users toward their first action with illustration + CTA.
         */
        <div className="w-full max-w-lg rounded-2xl border border-surface-border bg-surface-raised/50 shadow-lg">
          <EmptySubscriptions
            onCreate={connect}
            onBrowse={undefined}
          />
          <p className="pb-5 text-center text-xs text-content-tertiary">
            Connect your Freighter wallet above to get started.
          </p>
        </div>
      )}
    </main>
  );
}
