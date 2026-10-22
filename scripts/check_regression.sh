#!/usr/bin/env bash
# =============================================================================
# SorobanPay — Performance Regression Check
# =============================================================================
# Compares a current benchmark result against a stored baseline and emits
# GitHub Actions warning annotations if any metric exceeds the alert threshold.
#
# Usage:
#   bash scripts/check_regression.sh [--baseline PATH] [--current PATH]
#
# Options:
#   --baseline PATH   Path to the baseline JSON (default: docs/performance-baseline.json)
#   --current  PATH   Path to the current benchmark JSON (default: /tmp/benchmark-current.json)
#
# Exit codes:
#   0 — comparison ran successfully (regressions only emit warnings, never fail)
#   1 — argument or file error
# =============================================================================
set -euo pipefail

BASELINE="${BASELINE_PATH:-docs/performance-baseline.json}"
CURRENT="${CURRENT_PATH:-/tmp/benchmark-current.json}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --baseline) BASELINE="$2"; shift 2 ;;
    --current)  CURRENT="$2";  shift 2 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
done

if ! command -v jq &>/dev/null; then
  echo "ERROR: jq is required for regression checks." >&2
  exit 1
fi

if [ ! -f "$BASELINE" ]; then
  echo "::warning::Baseline file not found at '${BASELINE}'. Skipping regression check."
  echo "  No baseline found — skipping regression comparison." >&2
  exit 0
fi

if [ ! -f "$CURRENT" ]; then
  echo "::warning::Current benchmark result not found at '${CURRENT}'. Skipping regression check."
  echo "  No current results found — skipping regression comparison." >&2
  exit 0
fi

THRESHOLD=$(jq -r '.thresholds.alert_on_increase_pct // 20' "$BASELINE")
REGRESSIONS=0

echo "Comparing metrics against baseline (alert threshold: +${THRESHOLD}%)" >&2
echo "" >&2

# ── Helper: compare one metric ───────────────────────────────────────────────
check_metric() {
  local entry_point="$1"
  local metric="$2"
  local baseline_val current_val

  baseline_val=$(jq -r ".entry_points.${entry_point}.${metric} // 0" "$BASELINE")
  current_val=$(jq  -r ".entry_points.${entry_point}.${metric} // 0" "$CURRENT")

  # Skip comparison if baseline is zero (unset / not measured)
  if [ "$baseline_val" -eq 0 ] 2>/dev/null; then
    echo "  [SKIP] ${entry_point}.${metric}: baseline=0 (not measured)" >&2
    return
  fi

  # Compute percentage change using awk for floating-point arithmetic
  local pct_change
  pct_change=$(awk -v b="$baseline_val" -v c="$current_val" \
    'BEGIN { printf "%.1f", (c - b) / b * 100 }')

  local status="OK"
  # Extract integer part for comparison
  local pct_int
  pct_int=$(awk -v p="$pct_change" 'BEGIN { printf "%d", p }')

  if [ "$pct_int" -gt "$THRESHOLD" ] 2>/dev/null; then
    status="ALERT"
    REGRESSIONS=$((REGRESSIONS + 1))
    echo "::warning file=contracts/subscription/src/lib.rs::Performance regression detected: ${entry_point}.${metric} increased by ${pct_change}% (baseline=${baseline_val}, current=${current_val}, threshold=+${THRESHOLD}%)"
  fi

  printf "  %-20s %-16s baseline=%-10s current=%-10s change=%+s%%  [%s]\n" \
    "${entry_point}" "${metric}" "${baseline_val}" "${current_val}" "${pct_change}" "${status}" >&2
}

# ── Run comparisons for all entry points and metrics ─────────────────────────
for ep in subscribe execute_payment cancel; do
  echo "Entry point: ${ep}" >&2
  check_metric "$ep" "instructions"
  check_metric "$ep" "readBytes"
  check_metric "$ep" "writeBytes"
  check_metric "$ep" "minResourceFee"
  echo "" >&2
done

# ── Summary ───────────────────────────────────────────────────────────────────
if [ "$REGRESSIONS" -gt 0 ]; then
  echo "::warning::${REGRESSIONS} performance metric(s) exceeded the +${THRESHOLD}% alert threshold. Review the benchmark results above."
  echo "" >&2
  echo "SUMMARY: ${REGRESSIONS} regression(s) detected — warnings emitted (build continues)." >&2
else
  echo "SUMMARY: All metrics within threshold (+${THRESHOLD}%). No regressions detected." >&2
fi

# Always exit 0 — regressions are warnings only, not build failures.
exit 0
