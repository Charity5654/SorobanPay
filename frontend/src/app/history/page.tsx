'use client';

/**
 * /history page
 *
 * Displays the full payment history for the connected wallet by polling
 * the Soroban RPC `getEvents()` endpoint for `executed` events emitted
 * by the SorobanPay contract.
 *
 * Features:
 *  - Cursor-based pagination via the usePaymentHistory hook
 *  - 60-second localStorage cache to reduce RPC calls
 *  - Accessible table (WCAG 2.1 AA) via PaymentHistoryTable component
 *  - Loading, empty, error, and disconnected states
 *  - Back-link to the home page
 *  - Network indicator (Testnet / Mainnet)
 *
 * Keyboard shortcut H on the home page scrolls to the placeholder section
 * which contains a link to this page.
 */

import Link from 'next/link';
import { useWallet } from '@/hooks/useWallet';
import { usePaymentHistory } from '@/hooks/usePaymentHistory';
import PaymentHistoryTable from '@/components/PaymentHistoryTable';
import { NETWORK_NAME } from '@/constants/network';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HistoryPage() {
  const { publicKey } = useWallet();

  const { events, isLoading, error, hasMore, loadMore, refresh } =
    usePaymentHistory({ publicKey });

  return (
    <main
      className="min-h-screen flex flex-col items-center px-4 py-12"
      aria-label="Payment history page"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="w-full max-w-4xl mb-8">
        {/* Back link */}
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          aria-label="Back to home page"
        >
          <span aria-hidden="true">←</span> Home
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">
              Payment History
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Executed payments from your SorobanPay subscriptions
            </p>
          </div>

          {/* Network badge */}
          <span
            className={`inline-flex items-center gap-1.5 self-start rounded-full border px-3 py-1 text-xs font-semibold ${
              NETWORK_NAME === 'Mainnet'
                ? 'border-green-600/40 bg-green-900/20 text-green-300'
                : 'border-blue-600/40 bg-blue-900/20 text-blue-300'
            }`}
            aria-label={`Network: ${NETWORK_NAME}`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                NETWORK_NAME === 'Mainnet' ? 'bg-green-400' : 'bg-blue-400'
              }`}
              aria-hidden="true"
            />
            {NETWORK_NAME}
          </span>
        </div>
      </div>

      {/* ── Wallet required notice ───────────────────────────────────────── */}
      {!publicKey && (
        <div className="w-full max-w-4xl mb-6">
          <div
            role="status"
            className="rounded-xl border border-yellow-700/40 bg-yellow-950/30 px-4 py-3 text-sm text-yellow-200"
          >
            <strong className="font-semibold">Wallet not connected.</strong>{' '}
            <Link
              href="/"
              className="underline hover:text-yellow-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-yellow-400 rounded"
            >
              Connect your Freighter wallet
            </Link>{' '}
            on the home page to view your payment history.
          </div>
        </div>
      )}

      {/* ── Table section ───────────────────────────────────────────────── */}
      <section
        className="w-full max-w-4xl"
        aria-label="Payment history table"
        aria-live="polite"
      >
        <PaymentHistoryTable
          events={events}
          isLoading={isLoading}
          error={error}
          hasMore={hasMore}
          onLoadMore={loadMore}
          onRefresh={refresh}
          isConnected={!!publicKey}
          networkName={NETWORK_NAME}
        />
      </section>

      {/* ── Footer note ─────────────────────────────────────────────────── */}
      <div className="w-full max-w-4xl mt-8">
        <p className="text-gray-600 text-xs text-center leading-relaxed">
          Showing{' '}
          <code className="rounded bg-gray-800 px-1 text-gray-400">executed</code>{' '}
          events for your account from the SorobanPay contract on{' '}
          <span className="text-gray-500">{NETWORK_NAME}</span>.{' '}
          Results are cached for 60 seconds. Use the refresh button to fetch the
          latest data.
        </p>
      </div>
    </main>
  );
}
