#!/usr/bin/env bash
# =============================================================================
# scripts/seed-and-reset.sh
#
# Convenient devops utility to reset and re-seed the local environment.
#
# Usage:
#   bash scripts/seed-and-reset.sh [--reset-only | --seed-only]
# =============================================================================

set -euo pipefail

MODE="${1:-all}"

case "$MODE" in
  --reset-only)
    echo "Executing database reset..."
    npx ts-node scripts/reset-local-db.ts
    ;;
  --seed-only)
    echo "Executing database seed..."
    npx ts-node scripts/seed-local-db.ts
    ;;
  *)
    echo "Executing clean reset and re-seed..."
    npx ts-node scripts/reset-local-db.ts
    npx ts-node scripts/seed-local-db.ts
    ;;
esac

echo "Done."
