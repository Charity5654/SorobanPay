'use client';

/**
 * PaymentHistoryTable.tsx
 *
 * Accessible table component for displaying executed SorobanPay payment events.
 *
 * Features:
 *  - WCAG 2.1 AA compliant: proper <table> semantics, th scope, aria-labels
 *  - Loading state: skeleton rows with aria-busy
 *  - Empty state: friendly message for zero events
 *  - Error state: accessible error alert
 *  - Disconnected state: prompt to connect wallet
 *  - "Load more" button for cursor-based pagination
 *  - Each tx hash links to Stellar Expert
 *
 * Usage:
 *   <PaymentHistoryTable
 *     events={events}
 *     isLoading={isLoading}
 *     error={error}
 *     hasMore={hasMore}
 *     onLoadMore={loadMore}
 *     onRefresh={refresh}
 *     isConnected={!!publicKey}
 *     networkName="Testnet"
 *   />
 */

import { type PaymentEvent } from '@/hooks/usePaymentHistory';
import { truncateAddress } from '@/lib/utils';
import { AddressDisplay } from '@/components/AddressDisplay';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PaymentHistoryTableProps {
  events: PaymentEvent[];
  isLoading: boolean;
  error: string | null;
  hasMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  /** True when a wallet is connected — shows table vs. disconnected prompt */
  isConnected: boolean;
  /** "Testnet" or "Mainnet" — used for Stellar Expert links */
  networkName?: string;
  /**
   * Address book label lookup function.
   * When provided, merchant addresses are displayed with their saved label.
   */
  getLabel?: (address: string) => string | null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a Stellar Expert link for the given tx hash */
function stellarExpertTxUrl(txHash: string, networkName: string): string {
  const net = networkName.toLowerCase() === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${net}/tx/${txHash}`;
}

/** Format an ISO-8601 timestamp for display */
function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return iso;
  }
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr aria-hidden="true" className="border-b border-gray-800">
      {[60, 44, 36, 28, 28, 20].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div
            className={`h-3.5 w-${w} animate-pulse rounded bg-gray-700`}
            style={{ width: `${w * 4}px` }}
          />
        </td>
      ))}
    </tr>
  );
}

// ── Disconnected state ────────────────────────────────────────────────────────

function DisconnectedState() {
  return (
    <div
      role="status"
      aria-label="Payment history unavailable — wallet not connected"
      className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-10 text-center space-y-3"
    >
      <p className="text-3xl" aria-hidden="true">🔌</p>
      <p className="text-gray-300 font-semibold">Connect your wallet to view payment history</p>
      <p className="text-gray-500 text-sm leading-relaxed max-w-xs mx-auto">
        Your executed payments will appear here once you connect a Freighter wallet.
      </p>
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onRefresh }: { onRefresh: () => void }) {
  return (
    <div
      role="status"
      aria-label="No payment history found"
      className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-10 text-center space-y-3"
    >
      <p className="text-3xl" aria-hidden="true">📭</p>
      <p className="text-gray-300 font-semibold">No payments found</p>
      <p className="text-gray-500 text-sm leading-relaxed max-w-xs mx-auto">
        Executed payments will appear here after a merchant collects a payment
        from your subscription.
      </p>
      <button
        type="button"
        onClick={onRefresh}
        className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
      >
        <span aria-hidden="true">↺</span> Refresh
      </button>
    </div>
  );
}

// ── Error state ───────────────────────────────────────────────────────────────

function ErrorState({
  message,
  onRefresh,
}: {
  message: string;
  onRefresh: () => void;
}) {
  return (
    <div
      role="alert"
      aria-label="Error loading payment history"
      className="rounded-2xl border border-red-700/50 bg-red-950/30 p-6 space-y-3"
    >
      <p className="text-red-300 font-semibold text-sm">Failed to load payment history</p>
      <p className="text-red-400/80 text-xs leading-relaxed font-mono break-all">
        {message}
      </p>
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex items-center gap-1.5 rounded-lg border border-red-700/50 bg-red-900/20 px-4 py-2 text-xs font-medium text-red-300 hover:bg-red-900/40 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
      >
        <span aria-hidden="true">↺</span> Try again
      </button>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function PaymentHistoryTable({
  events,
  isLoading,
  error,
  hasMore,
  onLoadMore,
  onRefresh,
  isConnected,
  networkName = 'Testnet',
  getLabel = () => null,
}: PaymentHistoryTableProps) {
  // 1. Disconnected
  if (!isConnected) {
    return <DisconnectedState />;
  }

  // 2. Error (with no events loaded yet)
  if (error && events.length === 0) {
    return <ErrorState message={error} onRefresh={onRefresh} />;
  }

  // 3. Loading skeleton (first load, no events yet)
  if (isLoading && events.length === 0) {
    return (
      <div
        aria-label="Loading payment history"
        aria-busy="true"
        className="overflow-hidden rounded-2xl border border-gray-800"
      >
        <table
          className="w-full border-collapse text-sm"
          aria-label="Payment history — loading"
        >
          <thead>
            <TableHead />
          </thead>
          <tbody>
            {Array.from({ length: 5 }).map((_, i) => (
              <SkeletonRow key={i} />
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  // 4. Empty state
  if (!isLoading && events.length === 0) {
    return <EmptyState onRefresh={onRefresh} />;
  }

  // 5. Table with events
  return (
    <div className="space-y-4">
      {/* Refresh / status row */}
      <div className="flex items-center justify-between gap-2">
        <p className="text-gray-500 text-xs">
          {events.length} payment{events.length !== 1 ? 's' : ''} loaded
          {error && (
            <span className="ml-2 text-yellow-400">(partial load — some pages may have failed)</span>
          )}
        </p>
        <button
          type="button"
          onClick={onRefresh}
          disabled={isLoading}
          aria-label="Refresh payment history"
          className="inline-flex items-center gap-1 rounded-lg border border-gray-700 bg-gray-800/60 px-3 py-1.5 text-xs font-medium text-gray-400 hover:bg-gray-700 hover:text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
        >
          <span aria-hidden="true">↺</span>
          {isLoading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {/* Table */}
      <div
        className="overflow-x-auto rounded-2xl border border-gray-800"
        role="region"
        aria-label="Payment history table"
      >
        <table
          className="w-full min-w-[640px] border-collapse text-sm"
          aria-label="Payment history"
          aria-busy={isLoading}
          aria-rowcount={events.length}
        >
          <thead>
            <TableHead />
          </thead>
          <tbody>
            {events.map((event, idx) => (
              <EventRow
                key={event.id}
                event={event}
                rowIndex={idx + 1}
                networkName={networkName}
                getLabel={getLabel}
              />
            ))}

            {/* Loading more rows — skeleton appended at bottom */}
            {isLoading && events.length > 0 &&
              Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={`load-more-${i}`} />)}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {hasMore && !isLoading && (
        <div className="flex justify-center">
          <button
            type="button"
            onClick={onLoadMore}
            aria-label="Load more payment history events"
            className="rounded-lg border border-gray-700 bg-gray-800 px-6 py-2.5 text-sm font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            Load more
          </button>
        </div>
      )}

      {isLoading && events.length > 0 && (
        <p role="status" aria-live="polite" className="text-center text-xs text-gray-500">
          Loading more payments…
        </p>
      )}

      {!hasMore && events.length > 0 && !isLoading && (
        <p className="text-center text-xs text-gray-600" aria-label="All payments loaded">
          All payments loaded
        </p>
      )}
    </div>
  );
}

// ── Table head ────────────────────────────────────────────────────────────────

function TableHead() {
  return (
    <tr className="border-b border-gray-700 bg-gray-900/80">
      <th
        scope="col"
        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400"
      >
        Date
      </th>
      <th
        scope="col"
        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400"
      >
        Merchant
      </th>
      <th
        scope="col"
        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400"
      >
        Token
      </th>
      <th
        scope="col"
        className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wider text-gray-400"
      >
        Amount
      </th>
      <th
        scope="col"
        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400"
      >
        Ledger
      </th>
      <th
        scope="col"
        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wider text-gray-400"
      >
        Transaction
      </th>
    </tr>
  );
}

// ── Event row ─────────────────────────────────────────────────────────────────

function EventRow({
  event,
  rowIndex,
  networkName,
  getLabel,
}: {
  event: PaymentEvent;
  rowIndex: number;
  networkName: string;
  getLabel: (address: string) => string | null;
}) {
  const txUrl = stellarExpertTxUrl(event.txHash, networkName);

  return (
    <tr
      aria-rowindex={rowIndex}
      className="border-b border-gray-800/60 hover:bg-gray-800/30 transition-colors"
    >
      {/* Date */}
      <td className="px-4 py-3 text-gray-300 text-xs whitespace-nowrap">
        <time dateTime={event.timestamp}>{formatTimestamp(event.timestamp)}</time>
      </td>

      {/* Merchant */}
      <td className="px-4 py-3 text-xs text-gray-300">
        <AddressDisplay
          address={event.merchant}
          getLabel={getLabel}
          truncateLen={6}
        />
      </td>

      {/* Token */}
      <td className="px-4 py-3 font-mono text-xs text-gray-400">
        <span
          title={event.token}
          aria-label={`Token contract: ${event.token}`}
        >
          {truncateAddress(event.token, 6)}
        </span>
      </td>

      {/* Amount */}
      <td className="px-4 py-3 text-right font-mono text-xs text-green-400 whitespace-nowrap">
        <span aria-label={`Amount: ${event.amount} tokens`}>
          {event.amount}
        </span>
      </td>

      {/* Ledger */}
      <td className="px-4 py-3 text-gray-500 text-xs tabular-nums">
        {event.ledger.toLocaleString()}
      </td>

      {/* Transaction hash */}
      <td className="px-4 py-3 font-mono text-xs">
        {event.txHash ? (
          <a
            href={txUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View transaction ${event.txHash} on Stellar Expert (opens in new tab)`}
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          >
            {truncateAddress(event.txHash, 6)}
          </a>
        ) : (
          <span className="text-gray-600" aria-label="Transaction hash not available">
            —
          </span>
        )}
      </td>
    </tr>
  );
}
