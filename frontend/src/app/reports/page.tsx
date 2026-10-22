'use client';

/**
 * /reports page — Issue #798
 *
 * Merchant-facing payment reports, backed by GET /api/v1/reports (BE-58).
 *
 * Features:
 *  - Date range picker (from / to) plus a status filter (all / success / failed)
 *  - Payment table loaded from the backend, paginated via limit/offset
 *  - CSV export button that opens the same endpoint with format=csv, so the
 *    browser streams and downloads the file directly (no buffering client-side)
 *  - Loading, empty, error, and wallet-disconnected states, matching the
 *    conventions used on /history and /admin
 *
 * The connected wallet's public key is used as the merchant identity, same
 * convention as /merchant and /dashboard.
 */

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useWallet } from '@/hooks/useWallet';
import { NETWORK_NAME } from '@/constants/network';

// ─── Types ──────────────────────────────────────────────────────────────────

interface PaymentRow {
  date: string;
  subscriber: string;
  token: string;
  amountHuman: string;
  amountRaw: string;
  txHash: string;
  status: string;
}

type StatusFilter = 'all' | 'success' | 'failed';

// ─── Constants ──────────────────────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

const PAGE_SIZE = 50;

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Build the /api/v1/reports query string shared by the JSON fetch and the CSV link. */
function buildReportUrl(params: {
  merchant: string;
  from: string;
  to: string;
  status: StatusFilter;
  format: 'json' | 'csv';
  limit: number;
  offset: number;
}): string {
  const qs = new URLSearchParams({
    merchant: params.merchant,
    status: params.status,
    format: params.format,
    limit: String(params.limit),
    offset: String(params.offset),
  });
  if (params.from) qs.set('from', params.from);
  if (params.to) qs.set('to', params.to);
  return `${API_BASE}/api/v1/reports?${qs.toString()}`;
}

function shortHash(value: string, lead = 6, tail = 4): string {
  if (value.length <= lead + tail + 1) return value;
  return `${value.slice(0, lead)}…${value.slice(-tail)}`;
}

// ─── Loading spinner ────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="animate-spin h-4 w-4 text-blue-400"
      xmlns="http://www.w3.org/2000/svg"
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
    </svg>
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const { publicKey } = useWallet();

  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [status, setStatus] = useState<StatusFilter>('all');

  const [rows, setRows] = useState<PaymentRow[]>([]);
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchPage = useCallback(
    async (nextOffset: number, replace: boolean) => {
      if (!publicKey) return;
      setIsLoading(true);
      setError(null);
      try {
        const url = buildReportUrl({
          merchant: publicKey,
          from,
          to,
          status,
          format: 'json',
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        const res = await fetch(url);
        if (!res.ok) throw new Error(`Report fetch failed: ${res.statusText}`);
        const page = (await res.json()) as PaymentRow[];
        setRows((prev) => (replace ? page : [...prev, ...page]));
        setOffset(nextOffset + page.length);
        setHasMore(page.length === PAGE_SIZE);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [publicKey, from, to, status],
  );

  // Reload from the top whenever the wallet or filters change.
  useEffect(() => {
    setRows([]);
    setOffset(0);
    setHasMore(false);
    if (publicKey) fetchPage(0, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, from, to, status]);

  const csvHref = publicKey
    ? buildReportUrl({ merchant: publicKey, from, to, status, format: 'csv', limit: 100_000, offset: 0 })
    : null;

  return (
    <main
      className="min-h-screen flex flex-col items-center px-4 py-12"
      aria-label="Payment reports page"
    >
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="w-full max-w-5xl mb-8">
        <Link
          href="/"
          className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
          aria-label="Back to home page"
        >
          <span aria-hidden="true">←</span> Home
        </Link>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-white">Reports</h1>
            <p className="text-gray-400 text-sm mt-1">
              Payment history and payout export for your merchant account
            </p>
          </div>

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

      {/* ── Wallet required notice ─────────────────────────────────────── */}
      {!publicKey && (
        <div className="w-full max-w-5xl mb-6">
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
            on the home page to view your reports.
          </div>
        </div>
      )}

      {/* ── Error banner ────────────────────────────────────────────────── */}
      {error && (
        <div className="w-full max-w-5xl mb-6">
          <div
            role="alert"
            className="rounded-lg bg-red-900/60 border border-red-600 p-4 text-sm text-red-200 flex items-start gap-3"
          >
            <span className="flex-shrink-0 text-lg" aria-hidden="true">⚠</span>
            <div>
              <p className="font-semibold mb-1">Error</p>
              <p>{error}</p>
            </div>
          </div>
        </div>
      )}

      {/* ── Filters ─────────────────────────────────────────────────────── */}
      <section className="w-full max-w-5xl mb-6" aria-label="Report filters">
        <div className="flex flex-wrap items-end gap-4 bg-gray-800/40 border border-gray-700 rounded-xl p-4">
          <div>
            <label htmlFor="report-from" className="block text-xs font-semibold text-gray-400 mb-1.5">
              From
            </label>
            <input
              id="report-from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-lg bg-gray-900 border border-gray-600 px-3 py-2 text-sm text-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="report-to" className="block text-xs font-semibold text-gray-400 mb-1.5">
              To
            </label>
            <input
              id="report-to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-lg bg-gray-900 border border-gray-600 px-3 py-2 text-sm text-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label htmlFor="report-status" className="block text-xs font-semibold text-gray-400 mb-1.5">
              Status
            </label>
            <select
              id="report-status"
              value={status}
              onChange={(e) => setStatus(e.target.value as StatusFilter)}
              className="rounded-lg bg-gray-900 border border-gray-600 px-3 py-2 text-sm text-white
                         focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              <option value="success">Success</option>
              <option value="failed">Failed</option>
            </select>
          </div>

          <div className="flex-1" />

          <a
            href={csvHref ?? undefined}
            aria-disabled={!csvHref}
            onClick={(e) => { if (!csvHref) e.preventDefault(); }}
            className={`inline-flex items-center gap-2 rounded-lg border border-gray-600 px-4 py-2 text-sm font-semibold
                       transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400
                       ${csvHref ? 'text-white hover:bg-gray-700' : 'text-gray-500 cursor-not-allowed opacity-50'}`}
          >
            ⭳ Export CSV
          </a>
        </div>
      </section>

      {/* ── Table ───────────────────────────────────────────────────────── */}
      <section className="w-full max-w-5xl" aria-label="Payment report table" aria-live="polite">
        {isLoading && rows.length === 0 ? (
          <div className="flex items-center gap-3 text-gray-400 text-sm p-6">
            <Spinner /> Loading report…
          </div>
        ) : rows.length > 0 ? (
          <>
            <div className="overflow-x-auto rounded-xl border border-gray-700">
              <table className="w-full text-sm" aria-label="Payments">
                <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">Date</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">Subscriber</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold hidden md:table-cell">Token</th>
                    <th scope="col" className="px-4 py-3 text-right font-semibold">Amount</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold hidden lg:table-cell">Tx Hash</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {rows.map((row, i) => (
                    <tr key={`${row.txHash}-${i}`} className="hover:bg-gray-800/40 transition-colors">
                      <td className="px-4 py-3 text-gray-300 whitespace-nowrap">
                        {new Date(row.date).toLocaleString()}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400">
                        {shortHash(row.subscriber)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 hidden md:table-cell">
                        {shortHash(row.token)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-white">
                        {row.amountHuman}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 hidden lg:table-cell">
                        {shortHash(row.txHash, 8, 6)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            row.status === 'executed'
                              ? 'bg-green-900/60 text-green-300 border border-green-700'
                              : 'bg-red-900/60 text-red-300 border border-red-700'
                          }`}
                        >
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {hasMore && (
              <div className="flex justify-center mt-4">
                <button
                  onClick={() => fetchPage(offset, false)}
                  disabled={isLoading}
                  className="text-sm text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors
                             focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-3 py-1.5"
                >
                  {isLoading ? <span className="flex items-center gap-2"><Spinner /> Loading…</span> : 'Load more'}
                </button>
              </div>
            )}
          </>
        ) : publicKey ? (
          <p className="text-gray-500 text-sm p-6 bg-gray-800/40 rounded-lg text-center">
            No payments found for the selected filters.
          </p>
        ) : null}
      </section>
    </main>
  );
}
