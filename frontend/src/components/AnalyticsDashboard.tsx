'use client';

/**
 * AnalyticsDashboard — FE-50
 *
 * Three chart types rendered with pure SVG (no external chart library):
 *   1. MrrBarChart      — monthly recurring revenue bar chart
 *   2. SubscriberLineChart — active subscriber count over time
 *   3. PaymentSuccessDonut — executed vs. failure donut chart
 *
 * Accessibility: each chart has a visually-hidden ARIA table as fallback.
 * Loading: skeleton placeholders match chart dimensions.
 * Refresh: manual refresh button + 5-minute auto-poll via useAnalyticsData.
 */

import { useState, useId } from 'react';
import {
  useAnalyticsData,
  DateRange,
  MrrDataPoint,
  SubscriberDataPoint,
  SuccessRateData,
} from '@/hooks/useAnalyticsData';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v));
}

/** Format stroops to a human-readable XLM-like value (divides by 1e7). */
function fmtAmount(stroops: number): string {
  if (stroops === 0) return '0';
  const val = stroops / 1e7;
  if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(2)}M`;
  if (val >= 1_000) return `${(val / 1_000).toFixed(2)}K`;
  return val.toFixed(2);
}

// ─── Chart skeleton ────────────────────────────────────────────────────────────

function ChartSkeleton({ height = 160 }: { height?: number }) {
  return (
    <div
      className="animate-pulse rounded-xl bg-slate-800/60 w-full"
      style={{ height }}
      role="status"
      aria-label="Loading chart…"
    />
  );
}

// ─── 1. MRR Bar Chart ─────────────────────────────────────────────────────────

interface MrrBarChartProps {
  data: MrrDataPoint[];
  isLoading: boolean;
}

function MrrBarChart({ data, isLoading }: MrrBarChartProps) {
  const titleId = useId();
  const tableId = useId();

  if (isLoading) return <ChartSkeleton height={180} />;

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        No revenue data yet
      </div>
    );
  }

  const SVG_W = 560;
  const SVG_H = 160;
  const PAD_LEFT = 48;
  const PAD_RIGHT = 12;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 30;
  const chartW = SVG_W - PAD_LEFT - PAD_RIGHT;
  const chartH = SVG_H - PAD_TOP - PAD_BOTTOM;

  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  const barW = Math.max(4, (chartW / data.length) * 0.55);
  const gap = chartW / data.length;

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => ({
    y: PAD_TOP + chartH - f * chartH,
    label: fmtAmount(maxRev * f),
  }));

  return (
    <figure aria-labelledby={titleId} className="w-full">
      <figcaption id={titleId} className="sr-only">
        Monthly Recurring Revenue bar chart
      </figcaption>

      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full"
        aria-hidden="true"
        focusable="false"
      >
        {/* Y-axis ticks */}
        {yTicks.map((t) => (
          <g key={t.label}>
            <line
              x1={PAD_LEFT}
              x2={SVG_W - PAD_RIGHT}
              y1={t.y}
              y2={t.y}
              stroke="#334155"
              strokeDasharray="3 3"
              strokeWidth={0.8}
            />
            <text
              x={PAD_LEFT - 6}
              y={t.y + 4}
              textAnchor="end"
              fontSize={9}
              fill="#64748b"
            >
              {t.label}
            </text>
          </g>
        ))}

        {/* Bars */}
        {data.map((d, i) => {
          const barH = clamp((d.revenue / maxRev) * chartH, 2, chartH);
          const x = PAD_LEFT + gap * i + (gap - barW) / 2;
          const y = PAD_TOP + chartH - barH;
          return (
            <g key={d.month}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={barH}
                rx={3}
                fill="url(#barGrad)"
                className="transition-all duration-300"
              />
              <title>{`${d.label}: ${fmtAmount(d.revenue)} (${d.paymentCount} payments)`}</title>
              <text
                x={x + barW / 2}
                y={SVG_H - PAD_BOTTOM + 14}
                textAnchor="middle"
                fontSize={8.5}
                fill="#94a3b8"
              >
                {d.label}
              </text>
            </g>
          );
        })}

        <defs>
          <linearGradient id="barGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity="0.7" />
          </linearGradient>
        </defs>
      </svg>

      {/* ARIA fallback table */}
      <table id={tableId} className="sr-only" aria-label="Monthly Recurring Revenue data">
        <thead>
          <tr>
            <th>Month</th>
            <th>Revenue</th>
            <th>Payments</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <td>{d.label}</td>
              <td>{fmtAmount(d.revenue)}</td>
              <td>{d.paymentCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ─── 2. Subscriber Line Chart ─────────────────────────────────────────────────

interface SubscriberLineChartProps {
  data: SubscriberDataPoint[];
  isLoading: boolean;
}

function SubscriberLineChart({ data, isLoading }: SubscriberLineChartProps) {
  const titleId = useId();

  if (isLoading) return <ChartSkeleton height={160} />;

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40 text-gray-500 text-sm">
        No subscriber data yet
      </div>
    );
  }

  const SVG_W = 560;
  const SVG_H = 150;
  const PAD_LEFT = 40;
  const PAD_RIGHT = 12;
  const PAD_TOP = 12;
  const PAD_BOTTOM = 26;
  const chartW = SVG_W - PAD_LEFT - PAD_RIGHT;
  const chartH = SVG_H - PAD_TOP - PAD_BOTTOM;

  const maxCount = Math.max(...data.map((d) => d.activeCount), 1);

  const points = data.map((d, i) => {
    const x = PAD_LEFT + (i / Math.max(data.length - 1, 1)) * chartW;
    const y = PAD_TOP + chartH - (d.activeCount / maxCount) * chartH;
    return { x, y, d };
  });

  const polyline = points.map((p) => `${p.x},${p.y}`).join(' ');

  // Area fill path
  const areaPath =
    points.length > 0
      ? `M ${points[0].x},${PAD_TOP + chartH} ` +
        points.map((p) => `L ${p.x},${p.y}`).join(' ') +
        ` L ${points[points.length - 1].x},${PAD_TOP + chartH} Z`
      : '';

  return (
    <figure aria-labelledby={titleId} className="w-full">
      <figcaption id={titleId} className="sr-only">
        Active subscriber count over time line chart
      </figcaption>

      <svg
        viewBox={`0 0 ${SVG_W} ${SVG_H}`}
        className="w-full"
        aria-hidden="true"
        focusable="false"
      >
        <defs>
          <linearGradient id="lineAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#22d3ee" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Horizontal grid lines */}
        {[0, 0.5, 1].map((f) => {
          const y = PAD_TOP + chartH - f * chartH;
          return (
            <g key={f}>
              <line
                x1={PAD_LEFT}
                x2={SVG_W - PAD_RIGHT}
                y1={y}
                y2={y}
                stroke="#334155"
                strokeDasharray="3 3"
                strokeWidth={0.8}
              />
              <text
                x={PAD_LEFT - 6}
                y={y + 4}
                textAnchor="end"
                fontSize={9}
                fill="#64748b"
              >
                {Math.round(maxCount * f)}
              </text>
            </g>
          );
        })}

        {/* Area fill */}
        <path d={areaPath} fill="url(#lineAreaGrad)" />

        {/* Line */}
        <polyline
          points={polyline}
          fill="none"
          stroke="#22d3ee"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Dots */}
        {points.map((p) => (
          <g key={p.d.month}>
            <circle cx={p.x} cy={p.y} r={3} fill="#22d3ee" />
            <title>{`${p.d.label}: ${p.d.activeCount} active subscribers`}</title>
          </g>
        ))}

        {/* X-axis labels */}
        {points.map((p, i) => {
          // Only show every Nth label to avoid overlap
          const step = Math.ceil(data.length / 6);
          if (i % step !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={p.d.month}
              x={p.x}
              y={SVG_H - PAD_BOTTOM + 16}
              textAnchor="middle"
              fontSize={8.5}
              fill="#94a3b8"
            >
              {p.d.label}
            </text>
          );
        })}
      </svg>

      <table className="sr-only" aria-label="Active subscriber count over time">
        <thead>
          <tr>
            <th>Month</th>
            <th>Active Subscribers</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.month}>
              <td>{d.label}</td>
              <td>{d.activeCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// ─── 3. Payment Success Donut ─────────────────────────────────────────────────

interface DonutChartProps {
  data: SuccessRateData;
  isLoading: boolean;
}

function PaymentSuccessDonut({ data, isLoading }: DonutChartProps) {
  const titleId = useId();

  if (isLoading) {
    return (
      <div className="flex justify-center">
        <div className="animate-pulse rounded-full bg-slate-800/60 w-36 h-36" />
      </div>
    );
  }

  const R = 54;
  const CX = 70;
  const CY = 70;
  const STROKE_W = 18;
  const circumference = 2 * Math.PI * R;
  const successArc = (data.successRate / 100) * circumference;
  const failArc = circumference - successArc;

  return (
    <figure
      aria-labelledby={titleId}
      className="flex flex-col items-center gap-4"
    >
      <figcaption id={titleId} className="sr-only">
        Payment success rate donut chart
      </figcaption>

      <svg
        viewBox="0 0 140 140"
        width={140}
        height={140}
        aria-hidden="true"
        focusable="false"
      >
        {/* Background ring */}
        <circle
          cx={CX}
          cy={CY}
          r={R}
          fill="none"
          stroke="#1e293b"
          strokeWidth={STROKE_W}
        />

        {/* Failure arc (red) */}
        {failArc > 0 && (
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke="#f43f5e"
            strokeWidth={STROKE_W}
            strokeDasharray={`${failArc} ${circumference}`}
            strokeDashoffset={-successArc}
            transform={`rotate(-90 ${CX} ${CY})`}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        )}

        {/* Success arc (green) */}
        {successArc > 0 && (
          <circle
            cx={CX}
            cy={CY}
            r={R}
            fill="none"
            stroke="#10b981"
            strokeWidth={STROKE_W}
            strokeDasharray={`${successArc} ${circumference}`}
            transform={`rotate(-90 ${CX} ${CY})`}
            strokeLinecap="round"
            className="transition-all duration-700"
          />
        )}

        {/* Center text */}
        <text
          x={CX}
          y={CY - 6}
          textAnchor="middle"
          fontSize={22}
          fontWeight="bold"
          fill="white"
        >
          {data.successRate}%
        </text>
        <text
          x={CX}
          y={CY + 12}
          textAnchor="middle"
          fontSize={9}
          fill="#94a3b8"
        >
          success rate
        </text>
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-6 text-xs text-gray-400">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />
          <span>Executed ({data.executed})</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-rose-500 inline-block" />
          <span>Failed ({data.failed})</span>
        </div>
      </div>

      <table className="sr-only" aria-label="Payment success rate data">
        <thead>
          <tr>
            <th>Status</th>
            <th>Count</th>
            <th>Rate</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Executed</td>
            <td>{data.executed}</td>
            <td>{data.successRate}%</td>
          </tr>
          <tr>
            <td>Failed</td>
            <td>{data.failed}</td>
            <td>{100 - data.successRate}%</td>
          </tr>
        </tbody>
      </table>
    </figure>
  );
}

// ─── Date Range Selector ───────────────────────────────────────────────────────

const DATE_RANGES: { value: DateRange; label: string }[] = [
  { value: '30d', label: '30 days' },
  { value: '90d', label: '90 days' },
  { value: 'all', label: 'All time' },
];

// ─── Analytics Dashboard ───────────────────────────────────────────────────────

interface AnalyticsDashboardProps {
  merchantAddress: string | null;
}

export default function AnalyticsDashboard({
  merchantAddress,
}: AnalyticsDashboardProps) {
  const [dateRange, setDateRange] = useState<DateRange>('30d');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const { data, isLoading, error, refetch } = useAnalyticsData(
    merchantAddress,
    dateRange,
  );

  async function handleRefresh() {
    setIsRefreshing(true);
    await refetch();
    setIsRefreshing(false);
  }

  if (!merchantAddress) {
    return (
      <div
        className="flex flex-col items-center justify-center py-16 text-center space-y-3"
        role="status"
      >
        <span className="text-4xl" aria-hidden="true">📊</span>
        <p className="text-gray-300 font-semibold text-sm">
          Connect your wallet to view analytics
        </p>
        <p className="text-gray-500 text-xs max-w-xs">
          Your revenue charts and subscriber trends will appear here once you&apos;re
          connected.
        </p>
      </div>
    );
  }

  return (
    <section
      aria-label="Merchant analytics dashboard"
      className="space-y-6 w-full"
    >
      {/* ── Toolbar ──────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {/* Date range pills */}
        <div
          role="group"
          aria-label="Date range filter"
          className="flex items-center gap-1 bg-slate-900 border border-slate-700 rounded-xl p-1"
        >
          {DATE_RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              onClick={() => setDateRange(r.value)}
              aria-pressed={dateRange === r.value}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                dateRange === r.value
                  ? 'bg-indigo-600 text-white shadow'
                  : 'text-gray-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Refresh button */}
        <button
          type="button"
          onClick={handleRefresh}
          disabled={isLoading || isRefreshing}
          aria-label="Refresh analytics data"
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-700 bg-slate-900 text-xs text-gray-400 hover:text-white hover:bg-slate-800 disabled:opacity-50 transition-colors"
        >
          <svg
            className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Refresh
        </button>
      </div>

      {/* ── Error banner ─────────────────────────────────────────────────────── */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-3 rounded-xl border border-rose-800/60 bg-rose-950/40 px-4 py-3 text-sm text-rose-300"
        >
          <span aria-hidden="true">⚠️</span>
          <span>{error}</span>
          <button
            type="button"
            onClick={handleRefresh}
            className="ml-auto underline text-rose-400 hover:text-rose-200 text-xs"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── Charts grid ──────────────────────────────────────────────────────── */}

      {/* MRR Bar Chart */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Monthly Recurring Revenue
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Total payment volume collected per month
          </p>
        </div>
        <MrrBarChart data={data?.mrrData ?? []} isLoading={isLoading} />
      </div>

      {/* Subscriber Line Chart */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Active Subscriber Growth
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Cumulative unique subscribers over time
          </p>
        </div>
        <SubscriberLineChart
          data={data?.subscriberData ?? []}
          isLoading={isLoading}
        />
      </div>

      {/* Success Rate Donut */}
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-white">
            Payment Success Rate
          </h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Executed vs. transfer failure events
          </p>
        </div>
        <PaymentSuccessDonut
          data={
            data?.successRateData ?? {
              executed: 0,
              failed: 0,
              successRate: 100,
            }
          }
          isLoading={isLoading}
        />
      </div>
    </section>
  );
}
