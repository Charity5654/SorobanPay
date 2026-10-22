#!/usr/bin/env bash
# =============================================================================
# scripts/scan-docker.sh
#
# Local container vulnerability scanner using Trivy or Docker Scout.
#
# Usage:
#   bash scripts/scan-docker.sh [backend | frontend | all]
# =============================================================================

set -euo pipefail

TARGET="${1:-all}"

scan_service() {
  local service="$1"
  local dockerfile="$2"
  local tag="sorobanpay-${service}:local-scan"

  echo "==> Building ${service} container image..."
  docker build -t "$tag" -f "$dockerfile" "$(dirname "$dockerfile")"

  echo "==> Scanning ${service} image for vulnerabilities..."
  if command -v trivy >/dev/null 2>&1; then
    trivy image --severity CRITICAL,HIGH "$tag"
  elif docker scout --help >/dev/null 2>&1; then
    docker scout cves "$tag"
  else
    echo "Notice: neither 'trivy' nor 'docker scout' installed locally. Install trivy to view live vulnerability reports."
  fi
}

case "$TARGET" in
  backend)
    scan_service "backend" "backend/Dockerfile"
    ;;
  frontend)
    scan_service "frontend" "frontend/Dockerfile"
    ;;
  *)
    scan_service "backend" "backend/Dockerfile"
    scan_service "frontend" "frontend/Dockerfile"
    ;;
esac

echo "Scanning routine complete."
