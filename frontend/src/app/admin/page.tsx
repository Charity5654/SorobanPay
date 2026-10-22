'use client';

/**
 * admin/page.tsx — SorobanPay Admin Dashboard
 *
 * Displays:
 * - Protocol-wide metrics from GET /api/v1/admin/metrics
 * - Tenant management table with activate/deactivate from PATCH /api/v1/admin/tenants/:id
 * - Protocol fee configuration form from GET/PATCH /api/v1/admin/protocol-fee
 *
 * Access control:
 * - The page reads NEXT_PUBLIC_ADMIN_TOKEN from env.
 *   If absent, the user is prompted to enter their admin token.
 *   All API calls include it as the X-Admin-Token header.
 *   If the backend returns 401, the user is redirected to home.
 *
 * Issue #771 acceptance criteria:
 *  ✓ Shows real metrics from backend
 *  ✓ Tenant table with activate/deactivate
 *  ✓ Non-admins redirected
 *  ✓ npm run build passes
 */

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface Metrics {
  totalSubscriptions:  number;
  activeSubscriptions: number;
  totalVolumeUsd:      string;
  totalFeesCollected:  string;
  activeTenants:       number;
  snapshotAt:          string;
}

interface Tenant {
  id:             string;
  name:           string;
  email:          string;
  stellarAddress: string;
  isActive:       boolean;
  createdAt:      string;
}

// ─── Constants ──────────────────────────────────────────────────────────────────

const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:4000';

// ─── Helpers ────────────────────────────────────────────────────────────────────

function apiHeaders(token: string): HeadersInit {
  return {
    'Content-Type': 'application/json',
    'X-Admin-Token': token,
  };
}

// ─── Loading spinner ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg
      className="animate-spin h-5 w-5 text-blue-400"
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

// ─── Metric card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-gray-800 rounded-xl p-5 border border-gray-700 flex flex-col gap-1">
      <span className="text-xs text-gray-400 font-medium uppercase tracking-widest">{label}</span>
      <span className="text-2xl font-bold text-white">{value}</span>
    </div>
  );
}

// ─── Token gate modal ─────────────────────────────────────────────────────────

function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-black/70 z-50 p-4">
      <div className="bg-gray-900 rounded-2xl p-8 max-w-sm w-full border border-gray-700 shadow-2xl">
        <h2 className="text-xl font-bold text-white mb-2">Admin Access</h2>
        <p className="text-gray-400 text-sm mb-6">
          Enter your admin token to continue. This is never stored in the browser.
        </p>
        <input
          type="password"
          placeholder="Admin token"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && value && onSubmit(value)}
          className="w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-white
                     placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
          autoFocus
          aria-label="Admin token"
        />
        <button
          onClick={() => value && onSubmit(value)}
          disabled={!value}
          className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                     disabled:cursor-not-allowed py-3 font-semibold text-white transition-colors
                     focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          Authenticate
        </button>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const router = useRouter();

  // Session-scoped admin token (never persisted to localStorage)
  const [token, setToken] = useState<string | null>(
    typeof process !== 'undefined'
      ? process.env.NEXT_PUBLIC_ADMIN_TOKEN ?? null
      : null,
  );

  const [metrics,    setMetrics]    = useState<Metrics | null>(null);
  const [tenants,    setTenants]    = useState<Tenant[]>([]);
  const [feeBps,     setFeeBps]     = useState<number | null>(null);
  const [newFeeBps,  setNewFeeBps]  = useState('');

  const [loadingMetrics,  setLoadingMetrics]  = useState(false);
  const [loadingTenants,  setLoadingTenants]  = useState(false);
  const [loadingFee,      setLoadingFee]      = useState(false);
  const [savingFee,       setSavingFee]       = useState(false);
  const [togglingId,      setTogglingId]      = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  // ── Data fetchers ────────────────────────────────────────────────────────────

  const fetchMetrics = useCallback(async (adminToken: string) => {
    setLoadingMetrics(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/metrics`, {
        headers: apiHeaders(adminToken),
      });
      if (res.status === 401) { router.push('/'); return; }
      if (!res.ok) throw new Error(`Metrics fetch failed: ${res.statusText}`);
      setMetrics(await res.json() as Metrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingMetrics(false);
    }
  }, [router]);

  const fetchTenants = useCallback(async (adminToken: string) => {
    setLoadingTenants(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/tenants?pageSize=50`, {
        headers: apiHeaders(adminToken),
      });
      if (res.status === 401) { router.push('/'); return; }
      if (!res.ok) throw new Error(`Tenants fetch failed: ${res.statusText}`);
      const body = await res.json() as { tenants: Tenant[] };
      setTenants(body.tenants ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingTenants(false);
    }
  }, [router]);

  const fetchFee = useCallback(async (adminToken: string) => {
    setLoadingFee(true);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/protocol-fee`, {
        headers: apiHeaders(adminToken),
      });
      if (res.status === 401) { router.push('/'); return; }
      if (!res.ok) throw new Error(`Fee fetch failed: ${res.statusText}`);
      const body = await res.json() as { feeBps: number };
      setFeeBps(body.feeBps);
      setNewFeeBps(String(body.feeBps));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingFee(false);
    }
  }, [router]);

  // Load all data once we have a token
  useEffect(() => {
    if (!token) return;
    fetchMetrics(token);
    fetchTenants(token);
    fetchFee(token);
  }, [token, fetchMetrics, fetchTenants, fetchFee]);

  // ── Actions ───────────────────────────────────────────────────────────────────

  async function handleToggleTenant(id: string, currentlyActive: boolean) {
    if (!token) return;
    setTogglingId(id);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/tenants/${id}`, {
        method:  'PATCH',
        headers: apiHeaders(token),
        body:    JSON.stringify({ isActive: !currentlyActive }),
      });
      if (res.status === 401) { router.push('/'); return; }
      if (!res.ok) throw new Error(`Toggle failed: ${res.statusText}`);
      setTenants((prev) =>
        prev.map((t) => (t.id === id ? { ...t, isActive: !currentlyActive } : t)),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setTogglingId(null);
    }
  }

  async function handleSaveFee(e: React.FormEvent) {
    e.preventDefault();
    if (!token) return;
    const bps = parseInt(newFeeBps, 10);
    if (isNaN(bps) || bps < 0 || bps > 10_000) {
      setError('Protocol fee must be between 0 and 10 000 basis points.');
      return;
    }
    setSavingFee(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/v1/admin/protocol-fee`, {
        method:  'PATCH',
        headers: apiHeaders(token),
        body:    JSON.stringify({ feeBps: bps }),
      });
      if (res.status === 401) { router.push('/'); return; }
      if (!res.ok) throw new Error(`Fee update failed: ${res.statusText}`);
      setFeeBps(bps);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSavingFee(false);
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  if (!token) {
    return <TokenGate onSubmit={(t) => { setToken(t); }} />;
  }

  return (
    <main className="min-h-screen bg-gray-950 text-white p-4 sm:p-8">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">Admin Dashboard</h1>
          <p className="text-gray-400 text-sm mt-1">SorobanPay Protocol — internal management</p>
        </div>
        <button
          onClick={() => router.push('/')}
          className="text-sm text-gray-400 hover:text-white transition-colors
                     focus:outline-none focus:ring-1 focus:ring-gray-500 rounded px-3 py-1.5"
        >
          ← Back to app
        </button>
      </div>

      <div className="max-w-6xl mx-auto space-y-10">

        {/* Global error */}
        {error && (
          <div
            role="alert"
            className="rounded-lg bg-red-900/60 border border-red-600 p-4 text-sm text-red-200 flex items-start gap-3"
          >
            <span className="flex-shrink-0 text-lg">⚠</span>
            <div>
              <p className="font-semibold mb-1">Error</p>
              <p>{error}</p>
              <button
                onClick={() => setError(null)}
                className="mt-2 text-xs underline hover:text-red-100"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* ── Metrics section ─────────────────────────────────────────────── */}
        <section aria-labelledby="metrics-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="metrics-heading" className="text-xl font-bold">Protocol Metrics</h2>
            <button
              onClick={() => token && fetchMetrics(token)}
              disabled={loadingMetrics}
              className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors
                         focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-2 py-1"
              aria-label="Refresh metrics"
            >
              {loadingMetrics ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>

          {loadingMetrics && !metrics ? (
            <div className="flex items-center gap-3 text-gray-400 text-sm p-4">
              <Spinner /> Loading metrics…
            </div>
          ) : metrics ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
                <MetricCard label="Total subscriptions"  value={metrics.totalSubscriptions} />
                <MetricCard label="Active subscriptions" value={metrics.activeSubscriptions} />
                <MetricCard label="Active tenants"       value={metrics.activeTenants} />
                <MetricCard label="Total volume (USD)"   value={`$${metrics.totalVolumeUsd}`} />
                <MetricCard label="Fees collected (USD)" value={`$${metrics.totalFeesCollected}`} />
              </div>
              <p className="mt-3 text-xs text-gray-500">
                Snapshot at: {new Date(metrics.snapshotAt).toLocaleString()}
              </p>
            </>
          ) : (
            <p className="text-gray-500 text-sm p-4 bg-gray-800/40 rounded-lg">
              No metrics available. Make sure the backend is running and reachable at{' '}
              <code className="text-gray-300">{API_BASE}</code>.
            </p>
          )}
        </section>

        {/* ── Tenant management section ────────────────────────────────────── */}
        <section aria-labelledby="tenants-heading">
          <div className="flex items-center justify-between mb-4">
            <h2 id="tenants-heading" className="text-xl font-bold">Tenants</h2>
            <button
              onClick={() => token && fetchTenants(token)}
              disabled={loadingTenants}
              className="text-xs text-blue-400 hover:text-blue-300 disabled:opacity-50 transition-colors
                         focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-2 py-1"
              aria-label="Refresh tenants"
            >
              {loadingTenants ? 'Refreshing…' : '↻ Refresh'}
            </button>
          </div>

          {loadingTenants && tenants.length === 0 ? (
            <div className="flex items-center gap-3 text-gray-400 text-sm p-4">
              <Spinner /> Loading tenants…
            </div>
          ) : tenants.length > 0 ? (
            <div className="overflow-x-auto rounded-xl border border-gray-700">
              <table className="w-full text-sm" aria-label="Tenants">
                <thead className="bg-gray-800 text-gray-400 uppercase text-xs">
                  <tr>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">Name</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">Email</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold hidden md:table-cell">Stellar Address</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">Status</th>
                    <th scope="col" className="px-4 py-3 text-left font-semibold">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {tenants.map((tenant) => (
                    <tr key={tenant.id} className="hover:bg-gray-800/40 transition-colors">
                      <td className="px-4 py-3 font-medium text-white">{tenant.name}</td>
                      <td className="px-4 py-3 text-gray-300">{tenant.email}</td>
                      <td className="px-4 py-3 font-mono text-xs text-gray-400 hidden md:table-cell">
                        {tenant.stellarAddress.slice(0, 8)}…{tenant.stellarAddress.slice(-4)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${
                            tenant.isActive
                              ? 'bg-green-900/60 text-green-300 border border-green-700'
                              : 'bg-red-900/60 text-red-300 border border-red-700'
                          }`}
                        >
                          {tenant.isActive ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleToggleTenant(tenant.id, tenant.isActive)}
                          disabled={togglingId === tenant.id}
                          className={`text-xs font-semibold py-1.5 px-3 rounded-lg border transition-colors
                            focus:outline-none focus:ring-1 disabled:opacity-50 disabled:cursor-not-allowed
                            ${tenant.isActive
                              ? 'border-red-700 text-red-300 hover:bg-red-900/40 focus:ring-red-500'
                              : 'border-green-700 text-green-300 hover:bg-green-900/40 focus:ring-green-500'
                            }`}
                          aria-label={`${tenant.isActive ? 'Deactivate' : 'Activate'} ${tenant.name}`}
                        >
                          {togglingId === tenant.id ? (
                            <span className="flex items-center gap-1.5"><Spinner /> Working…</span>
                          ) : (
                            tenant.isActive ? 'Deactivate' : 'Activate'
                          )}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-gray-500 text-sm p-4 bg-gray-800/40 rounded-lg">
              No tenants found. They will appear here once registered.
            </p>
          )}
        </section>

        {/* ── Protocol fee section ─────────────────────────────────────────── */}
        <section aria-labelledby="fee-heading" className="max-w-md">
          <h2 id="fee-heading" className="text-xl font-bold mb-4">Protocol Fee</h2>

          {loadingFee && feeBps === null ? (
            <div className="flex items-center gap-3 text-gray-400 text-sm p-4">
              <Spinner /> Loading fee config…
            </div>
          ) : (
            <div className="bg-gray-800 rounded-xl p-6 border border-gray-700">
              <p className="text-sm text-gray-400 mb-5">
                Current fee:{' '}
                <span className="font-bold text-white">
                  {feeBps !== null ? `${feeBps} bps (${(feeBps / 100).toFixed(2)}%)` : '—'}
                </span>
              </p>

              <form onSubmit={handleSaveFee} noValidate className="space-y-4">
                <div>
                  <label htmlFor="feeBps" className="block text-sm font-semibold text-gray-300 mb-2">
                    New fee (basis points)
                  </label>
                  <input
                    id="feeBps"
                    type="number"
                    min="0"
                    max="10000"
                    step="1"
                    value={newFeeBps}
                    onChange={(e) => setNewFeeBps(e.target.value)}
                    disabled={savingFee}
                    placeholder="50"
                    className="w-full rounded-lg bg-gray-900 border border-gray-600 px-4 py-3 text-white
                               placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500
                               disabled:opacity-50"
                    aria-describedby="fee-hint"
                  />
                  <p id="fee-hint" className="mt-1.5 text-xs text-gray-500">
                    0 – 10 000 bps (0 % – 100 %). Default: 50 bps (0.5 %).
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={savingFee || newFeeBps === String(feeBps)}
                  className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                             disabled:opacity-50 disabled:cursor-not-allowed py-3 font-semibold
                             transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
                >
                  {savingFee ? (
                    <span className="flex items-center justify-center gap-2"><Spinner /> Saving…</span>
                  ) : (
                    'Save fee'
                  )}
                </button>
              </form>
            </div>
          )}
        </section>

      </div>
    </main>
  );
}
