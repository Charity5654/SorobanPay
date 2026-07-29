'use client';

/**
 * /merchant page
 *
 * Merchant portal for SorobanPay.
 *
 * Features:
 *   - Wallet connect / disconnect header (connects as merchant)
 *   - MerchantSubscriptionsTable showing all subscribers and their due status
 *   - Per-row "Collect" button triggers execute_payment via Freighter
 *   - Batch "Collect Selected" triggers sequential collection for all selected
 *     due rows
 *   - Transaction success / error feedback per row (inline + toast summary)
 *   - Empty / loading / error states
 *   - Network indicator badge
 *
 * Acceptance criteria:
 *   ✓ Accessible at /merchant
 *   ✓ Due/not-due computed correctly from on-chain next_payment
 *   ✓ Individual and batch collection flows
 *   ✓ Per-row success / error feedback
 *   ✓ Warning shown when no subscriptions found for the connected merchant
 */

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useWallet } from '@/hooks/useWallet';
import { useMerchantSubscriptions } from '@/hooks/useMerchantSubscriptions';
import MerchantSubscriptionsTable, {
  type RowResult,
} from '@/components/MerchantSubscriptionsTable';
import {
  buildAndSubmitExecutePayment,
  buildAndSubmitBatchExecutePayment,
} from '@/lib/transaction_builder';
import { mapError } from '@/lib/errors';
import { CONTRACT_ID, NETWORK_PASSPHRASE, NETWORK_NAME, RPC_URL } from '@/constants/network';
import { truncateAddress } from '@/lib/utils';

// ── Page ──────────────────────────────────────────────────────────────────────

export default function MerchantPage() {
  const {
    publicKey,
    isConnecting,
    connectError,
    freighterInstalled,
    connect,
    disconnect,
  } = useWallet();

  const { subscriptions, isLoading, error, refresh } = useMerchantSubscriptions({
    publicKey,
  });

  // Per-row collection state
  const [collectingRows, setCollectingRows] = useState<Set<string>>(new Set());
  const [rowResults, setRowResults] = useState<Map<string, RowResult>>(new Map());

  // ── Single collect ──────────────────────────────────────────────────────────
  const handleCollect = useCallback(
    async (subscriber: string) => {
      if (!publicKey || !CONTRACT_ID) return;

      const merchant = publicKey;
      setCollectingRows((prev) => new Set(prev).add(subscriber));
      setRowResults((prev) => {
        const next = new Map(prev);
        next.delete(subscriber); // clear previous result for this row
        return next;
      });

      try {
        const { txHash } = await buildAndSubmitExecutePayment(
          { subscriber, merchant },
          CONTRACT_ID,
          publicKey,
          NETWORK_PASSPHRASE,
          RPC_URL,
        );
        setRowResults((prev) => {
          const next = new Map(prev);
          next.set(subscriber, { txHash });
          return next;
        });
        // Refresh the list after a successful collection so status updates
        setTimeout(refresh, 2000);
      } catch (err) {
        const mapped = mapError(err);
        setRowResults((prev) => {
          const next = new Map(prev);
          next.set(subscriber, { error: mapped.message });
          return next;
        });
      } finally {
        setCollectingRows((prev) => {
          const next = new Set(prev);
          next.delete(subscriber);
          return next;
        });
      }
    },
    [publicKey, refresh],
  );

  // ── Batch collect ───────────────────────────────────────────────────────────
  const handleBatchCollect = useCallback(
    async (subscribers: string[]) => {
      if (!publicKey || !CONTRACT_ID || subscribers.length === 0) return;

      const merchant = publicKey;

      // Mark all selected rows as collecting
      setCollectingRows((prev) => {
        const next = new Set(prev);
        for (const s of subscribers) next.add(s);
        return next;
      });
      // Clear previous results for selected rows
      setRowResults((prev) => {
        const next = new Map(prev);
        for (const s of subscribers) next.delete(s);
        return next;
      });

      const batchResult = await buildAndSubmitBatchExecutePayment(
        subscribers.map((s) => ({ subscriber: s, merchant })),
        CONTRACT_ID,
        publicKey,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );

      // Apply per-entry results progressively
      setRowResults((prev) => {
        const next = new Map(prev);
        for (const r of batchResult.results) {
          if (r.txHash) {
            next.set(r.subscriber, { txHash: r.txHash });
          } else if (r.error) {
            const mapped = mapError(new Error(r.error));
            next.set(r.subscriber, { error: mapped.message });
          }
        }
        return next;
      });

      setCollectingRows((prev) => {
        const next = new Set(prev);
        for (const s of subscribers) next.delete(s);
        return next;
      });

      // Refresh after batch completes
      if (batchResult.successCount > 0) {
        setTimeout(refresh, 2000);
      }
    },
    [publicKey, refresh],
  );

  // ── Render ─────────────────────────────────────────────────────────────────
  const shortKey = publicKey
    ? `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
    : null;

  const contractConfigured = !!CONTRACT_ID;

  return (
    <main
      className="min-h-screen flex flex-col items-center px-4 py-12"
      aria-label="Merchant portal"
    >
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="w-full max-w-5xl mb-8">
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
              Merchant Portal
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              View subscriber payment schedules and collect due payments
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

      {/* ── Contract not configured warning ───────────────────────────── */}
      {!contractConfigured && (
        <div className="w-full max-w-5xl mb-6">
          <div
            role="alert"
            className="rounded-xl border border-yellow-700/40 bg-yellow-950/30 px-4 py-4 text-sm text-yellow-200"
          >
            <p className="font-semibold mb-1">⚠ Contract not configured</p>
            <p className="text-yellow-300/70 text-xs">
              Set{' '}
              <code className="rounded bg-yellow-900/40 px-1">
                NEXT_PUBLIC_CONTRACT_ID
              </code>{' '}
              in{' '}
              <code className="rounded bg-yellow-900/40 px-1">
                frontend/.env.local
              </code>{' '}
              and restart the dev server.
            </p>
          </div>
        </div>
      )}

      {/* ── Wallet connect section ─────────────────────────────────────── */}
      <div className="w-full max-w-5xl mb-6">
        {!publicKey ? (
          <div
            className="rounded-2xl border border-gray-800 bg-gray-900/60 p-6 space-y-4"
            aria-labelledby="connect-wallet-heading"
          >
            <div>
              <h2
                id="connect-wallet-heading"
                className="text-base font-semibold text-white mb-1"
              >
                Connect your merchant wallet
              </h2>
              <p className="text-gray-400 text-sm">
                Connect the Freighter wallet that acts as the merchant in your
                SorobanPay subscriptions. The connected address will be used to
                query subscriber state and sign payment collection transactions.
              </p>
            </div>

            {!freighterInstalled && (
              <div
                role="alert"
                className="rounded-lg border border-yellow-700/40 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-200"
              >
                Freighter wallet is not installed.{' '}
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
                className="rounded-lg border border-red-700/40 bg-red-900/20 px-4 py-3 text-sm text-red-300"
              >
                {connectError}
              </div>
            )}

            <button
              type="button"
              onClick={connect}
              disabled={isConnecting}
              className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-5 py-2.5 text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              {isConnecting ? 'Connecting…' : 'Connect Freighter Wallet'}
            </button>
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-800 bg-gray-900/60 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <span
                className="h-2 w-2 rounded-full bg-green-400 flex-shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-xs text-gray-500 leading-none mb-0.5">
                  Connected as merchant
                </p>
                <p
                  className="font-mono text-sm text-white truncate"
                  title={publicKey}
                >
                  {shortKey}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={disconnect}
              className="text-xs text-gray-500 hover:text-red-400 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-red-400 rounded px-2 py-1"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* ── Wallet required notice ─────────────────────────────────────── */}
      {!publicKey && (
        <div className="w-full max-w-5xl">
          <div className="rounded-2xl border border-gray-800 bg-gray-900/40 px-6 py-12 text-center">
            <p className="text-4xl mb-3" aria-hidden="true">🔐</p>
            <p className="text-gray-300 font-semibold mb-2">
              Wallet connection required
            </p>
            <p className="text-gray-500 text-sm leading-relaxed max-w-sm mx-auto">
              Connect your Freighter wallet above to view your subscriber list
              and collect payments.
            </p>
          </div>
        </div>
      )}

      {/* ── Subscriptions table ────────────────────────────────────────── */}
      {publicKey && (
        <section
          className="w-full max-w-5xl"
          aria-label="Subscriber list"
          aria-live="polite"
        >
          <MerchantSubscriptionsTable
            subscriptions={subscriptions}
            isLoading={isLoading}
            error={error}
            onCollect={handleCollect}
            onBatchCollect={handleBatchCollect}
            collectingRows={collectingRows}
            rowResults={rowResults}
            onRefresh={refresh}
          />
        </section>
      )}

      {/* ── Footer note ───────────────────────────────────────────────── */}
      {publicKey && (
        <div className="w-full max-w-5xl mt-8">
          <p className="text-gray-600 text-xs text-center leading-relaxed">
            Subscriptions are discovered via{' '}
            <code className="rounded bg-gray-800 px-1 text-gray-400">subscribe</code>{' '}
            events on the SorobanPay contract. Payment status is fetched live
            from{' '}
            <code className="rounded bg-gray-800 px-1 text-gray-400">
              get_subscription
            </code>{' '}
            for each subscriber. Use Refresh to reload after on-chain changes.
          </p>
        </div>
      )}
    </main>
  );
}
