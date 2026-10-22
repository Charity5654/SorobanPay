/**
 * useAnalyticsData — FE-50
 *
 * Fetches payment events from the backend and derives analytics metrics:
 *   - Monthly recurring revenue (MRR) per calendar month
 *   - Active subscriber count over time (cumulative unique subscribers per month)
 *   - Payment success rate (executed vs. payment_transfer_failure)
 *
 * Polls every 5 minutes automatically.  Exposes `refetch` for manual refresh.
 */

import { useState, useEffect, useCallback, useRef } from 'react';

export type DateRange = '30d' | '90d' | 'all';

export interface MrrDataPoint {
  month: string;       // e.g. "2024-01"
  label: string;       // e.g. "Jan 24"
  revenue: number;     // sum of payment amounts in stroops (as JS number)
  paymentCount: number;
}

export interface SubscriberDataPoint {
  month: string;       // e.g. "2024-01"
  label: string;
  activeCount: number; // cumulative unique subscribers up to this month
}

export interface SuccessRateData {
  executed: number;       // count
  failed: number;         // count
  successRate: number;    // 0-100
}

export interface AnalyticsData {
  mrrData: MrrDataPoint[];
  subscriberData: SubscriberDataPoint[];
  successRateData: SuccessRateData;
}

interface RawEvent {
  type: string;
  subscriber: string;
  merchant: string;
  token: string;
  amount: string;
  ledgerTimestamp: number | string;
  createdAt?: string;
}

const POLL_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function cutoffFromRange(range: DateRange): Date | null {
  if (range === 'all') return null;
  const days = range === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d;
}

/** Format a Date into "MMM YY" label (e.g. "Jan 24"). */
function monthLabel(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

/** Format a Date into "YYYY-MM" key. */
function monthKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function deriveAnalytics(events: RawEvent[], range: DateRange): AnalyticsData {
  const cutoff = cutoffFromRange(range);

  // Timestamp helper — ledgerTimestamp is a Unix epoch (seconds) as BigInt string or number
  function eventDate(e: RawEvent): Date {
    const ts = typeof e.ledgerTimestamp === 'string'
      ? parseInt(e.ledgerTimestamp, 10)
      : Number(e.ledgerTimestamp);
    // Soroban ledger timestamps are Unix seconds
    return new Date(ts * 1000);
  }

  const filtered = cutoff
    ? events.filter((e) => eventDate(e) >= cutoff)
    : events;

  // ── MRR ────────────────────────────────────────────────────────────────────
  const mrrMap = new Map<string, { revenue: number; paymentCount: number }>();

  for (const e of filtered) {
    if (e.type !== 'executed') continue;
    const d = eventDate(e);
    const key = monthKey(d);
    const existing = mrrMap.get(key) ?? { revenue: 0, paymentCount: 0 };
    const amount = parseInt(e.amount, 10) || 0;
    mrrMap.set(key, {
      revenue: existing.revenue + amount,
      paymentCount: existing.paymentCount + 1,
    });
  }

  const mrrData: MrrDataPoint[] = Array.from(mrrMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => {
      const [year, month] = key.split('-').map(Number);
      const d = new Date(year, month - 1, 1);
      return { month: key, label: monthLabel(d), ...val };
    });

  // ── Active subscribers over time ────────────────────────────────────────────
  const subscribedByMonth = new Map<string, Set<string>>();

  for (const e of filtered) {
    if (e.type !== 'subscribe') continue;
    const d = eventDate(e);
    const key = monthKey(d);
    if (!subscribedByMonth.has(key)) subscribedByMonth.set(key, new Set());
    subscribedByMonth.get(key)!.add(e.subscriber);
  }

  const sortedSubMonths = Array.from(subscribedByMonth.keys()).sort();
  const cumulativeSubs = new Set<string>();
  const subscriberData: SubscriberDataPoint[] = sortedSubMonths.map((key) => {
    subscribedByMonth.get(key)!.forEach((s) => cumulativeSubs.add(s));
    const [year, month] = key.split('-').map(Number);
    const d = new Date(year, month - 1, 1);
    return { month: key, label: monthLabel(d), activeCount: cumulativeSubs.size };
  });

  // ── Success rate ────────────────────────────────────────────────────────────
  const executed = filtered.filter((e) => e.type === 'executed').length;
  const failed = filtered.filter((e) => e.type === 'payment_transfer_failure').length;
  const total = executed + failed;
  const successRate = total > 0 ? Math.round((executed / total) * 100) : 100;

  return {
    mrrData,
    subscriberData,
    successRateData: { executed, failed, successRate },
  };
}

const BACKEND_URL =
  process.env.NEXT_PUBLIC_BACKEND_URL ?? 'http://localhost:3001';

export function useAnalyticsData(
  merchantAddress: string | null,
  dateRange: DateRange,
) {
  const [data, setData] = useState<AnalyticsData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchData = useCallback(async () => {
    if (!merchantAddress) return;
    setIsLoading(true);
    setError(null);

    try {
      // Fetch both subscribe events and payment events in parallel
      const [subRes, payRes] = await Promise.all([
        fetch(
          `${BACKEND_URL}/api/v1/subscriptions/merchant/${merchantAddress}`,
        ),
        fetch(
          `${BACKEND_URL}/api/v1/subscriptions/merchant/${merchantAddress}/payments`,
        ),
      ]);

      const subscriptions: RawEvent[] = subRes.ok ? await subRes.json() : [];
      const payments: RawEvent[] = payRes.ok ? await payRes.json() : [];

      // Also try the analytics endpoint for richer data
      let analyticsEvents: RawEvent[] = [];
      try {
        const analyticsRes = await fetch(
          `${BACKEND_URL}/api/v1/analytics/revenue?merchant=${merchantAddress}&period=${dateRange}`,
        );
        if (analyticsRes.ok) {
          const analyticsJson = await analyticsRes.json();
          // If the analytics endpoint returns raw events, use them
          if (Array.isArray(analyticsJson.events)) {
            analyticsEvents = analyticsJson.events;
          }
        }
      } catch {
        // analytics endpoint optional — fall back to subscription+payment events
      }

      const allEvents: RawEvent[] =
        analyticsEvents.length > 0
          ? analyticsEvents
          : [
              ...subscriptions.map((s) => ({ ...s, type: 'subscribe' })),
              ...payments.map((p) => ({ ...p, type: 'executed' })),
            ];

      setData(deriveAnalytics(allEvents, dateRange));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load analytics');
    } finally {
      setIsLoading(false);
    }
  }, [merchantAddress, dateRange]);

  // Initial fetch + auto-poll every 5 minutes
  useEffect(() => {
    fetchData();
    intervalRef.current = setInterval(fetchData, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchData]);

  return { data, isLoading, error, refetch: fetchData };
}
