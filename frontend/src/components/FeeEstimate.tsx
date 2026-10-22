"use client";

/**
 * FeeEstimate.tsx
 *
 * Displays the pre-submission fee estimate returned by useSimulateFee.
 *
 * States:
 *  - idle        → renders nothing (form not yet valid)
 *  - loading     → animated loading skeleton
 *  - success     → estimated fee in XLM + collapsible breakdown
 *  - error       → inline error message (simulation failed)
 *
 * Props:
 *  - status       SimulateFeeStatus
 *  - minResourceFee   Stroop string | null
 *  - breakdown    SimulateFeeBreakdown | null
 *  - error        string | null
 */

import { useState } from "react";
import { stroopsToXlm } from "@/hooks/useSimulateFee";
import type {
  SimulateFeeStatus,
  SimulateFeeBreakdown,
} from "@/hooks/useSimulateFee";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface FeeEstimateProps {
  status: SimulateFeeStatus;
  minResourceFee: string | null;
  breakdown: SimulateFeeBreakdown | null;
  error: string | null;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

/** Animated loading skeleton shown during simulation. */
function FeeSkeleton() {
  return (
    <div
      role="status"
      aria-label="Estimating transaction fee…"
      aria-busy="true"
      className="rounded-lg bg-gray-800/60 border border-gray-700/60 p-3 space-y-2 animate-pulse"
    >
      <div className="flex items-center gap-2">
        {/* Icon placeholder */}
        <div className="h-4 w-4 rounded bg-gray-700 shrink-0" aria-hidden="true" />
        {/* Label placeholder */}
        <div className="h-3 w-32 rounded bg-gray-700" aria-hidden="true" />
        {/* Value placeholder */}
        <div className="ml-auto h-3 w-20 rounded bg-gray-700" aria-hidden="true" />
      </div>
      <div className="h-2.5 w-48 rounded bg-gray-700/70" aria-hidden="true" />
      <span className="sr-only">Estimating transaction fee…</span>
    </div>
  );
}

/** One breakdown row. */
function BreakdownRow({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="flex items-center justify-between text-xs py-1 border-b border-gray-700/50 last:border-0">
      <span className="text-gray-400">{label}</span>
      <span className="font-mono text-gray-200 tabular-nums">
        {typeof value === "number" ? value.toLocaleString() : value}
      </span>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function FeeEstimate({
  status,
  minResourceFee,
  breakdown,
  error,
}: FeeEstimateProps) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (status === "idle") return null;

  if (status === "loading") return <FeeSkeleton />;

  if (status === "error") {
    return (
      <div
        role="alert"
        className="rounded-lg bg-yellow-900/30 border border-yellow-600/40 px-3 py-2.5 text-xs text-yellow-300"
      >
        <div className="flex items-start gap-2">
          <span aria-hidden="true" className="shrink-0 mt-0.5">
            ⚠
          </span>
          <div>
            <span className="font-semibold">Fee estimation unavailable: </span>
            <span className="text-yellow-200/80">{error}</span>
          </div>
        </div>
        <p className="mt-1.5 text-yellow-200/60">
          You can still submit — Freighter will show the final fee before you
          approve.
        </p>
      </div>
    );
  }

  // success
  if (status === "success" && minResourceFee !== null) {
    const xlm = stroopsToXlm(minResourceFee);
    // +15 % safety margin
    const bufferedXlm = ((Number(minResourceFee) * 1.15) / 10_000_000).toFixed(7);

    return (
      <div
        className="rounded-lg bg-blue-900/20 border border-blue-700/40 px-3 py-2.5 text-xs"
        aria-label="Estimated transaction fee"
      >
        {/* Fee summary row */}
        <div className="flex items-center gap-2">
          {/* Info icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4 text-blue-400 shrink-0"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
              clipRule="evenodd"
            />
          </svg>

          <span className="text-blue-300 font-medium">Estimated fee</span>

          <span
            aria-label={`Estimated fee: ${xlm} XLM`}
            className="ml-auto font-mono text-blue-100 font-semibold tabular-nums"
          >
            ~{xlm} XLM
          </span>
        </div>

        {/* Buffer note */}
        <p className="mt-1 text-blue-300/70 leading-snug">
          Minimum resource fee from simulation.{" "}
          <span className="text-blue-300/50">
            With +15% safety buffer: ~{bufferedXlm} XLM.
          </span>
        </p>

        {/* Collapsible breakdown */}
        <button
          type="button"
          onClick={() => setDetailsOpen((v) => !v)}
          aria-expanded={detailsOpen}
          aria-controls="fee-breakdown"
          className="mt-2 inline-flex items-center gap-1 text-blue-400/80 hover:text-blue-300 transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-blue-400 rounded"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className={`h-3 w-3 transition-transform ${detailsOpen ? "rotate-90" : ""}`}
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
              clipRule="evenodd"
            />
          </svg>
          {detailsOpen ? "Hide" : "Show"} fee details
        </button>

        {detailsOpen && breakdown && (
          <div
            id="fee-breakdown"
            className="mt-2 bg-gray-900/60 rounded p-2 space-y-0"
            aria-label="Fee breakdown details"
          >
            <BreakdownRow
              label="CPU instructions"
              value={breakdown.instructions}
            />
            <BreakdownRow label="Read bytes" value={breakdown.readBytes} />
            <BreakdownRow label="Write bytes" value={breakdown.writeBytes} />
            <BreakdownRow
              label="Min resource fee (stroops)"
              value={minResourceFee}
            />
          </div>
        )}
      </div>
    );
  }

  return null;
}
