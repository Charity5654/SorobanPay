#!/usr/bin/env bash
# =============================================================================
# SorobanPay — Contract Deployment Script
# =============================================================================
# Usage:
#   bash deploy/deploy.sh
#   STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-id bash deploy/deploy.sh
#
# ─── Environment variables ───────────────────────────────────────────────────
#
#   STELLAR_NETWORK   (optional) Target Stellar network.
#                     Allowed values: "testnet" (default) | "mainnet"
#                     Controls the RPC endpoint and network passphrase that
#                     the script selects automatically — you do not need to
#                     set RPC_URL or PASSPHRASE directly.
#                     Example:
#                       STELLAR_NETWORK=mainnet bash deploy/deploy.sh
#
#   STELLAR_IDENTITY  (optional) Stellar CLI identity alias used to sign and
#                     pay fees for the deploy transaction.
#                     Default: "alice"
#                     Must already be registered with `stellar keys generate`
#                     and funded before running this script.
#                     Example:
#                       STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh
#
# ─── Derived variables (set internally — do not set these yourself) ──────────
#
#   RPC_URL           Soroban RPC endpoint, derived from STELLAR_NETWORK:
#                       testnet → https://soroban-testnet.stellar.org
#                       mainnet → https://mainnet.stellar.validationcloud.io/v1/<key>
#
#   PASSPHRASE        Stellar network passphrase, derived from STELLAR_NETWORK:
#                       testnet → "Test SDF Network ; September 2015"
#                       mainnet → "Public Global Stellar Network ; September 2015"
#
# ─── Output ──────────────────────────────────────────────────────────────────
#
#   stdout — deployed contract address only (nothing else).
#            Capture with: CONTRACT_ID=$(bash deploy/deploy.sh)
#   stderr — all diagnostic messages and error details.
#   exit 0 — deployment succeeded.
#   exit 1 — any failure (invalid STELLAR_NETWORK, build error, deploy error).
#
# ─── Examples ────────────────────────────────────────────────────────────────
#
#   # Testnet (default)
#   bash deploy/deploy.sh
#
#   # Testnet — capture contract address
#   CONTRACT_ID=$(bash deploy/deploy.sh)
#   echo "Deployed: $CONTRACT_ID"
#
#   # Mainnet — explicit identity
#   STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh
#
#   # Mainnet — capture contract address
#   CONTRACT_ID=$(STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh)
#
# =============================================================================
set -euo pipefail

NETWORK="${STELLAR_NETWORK:-testnet}"
IDENTITY="${STELLAR_IDENTITY:-alice}"
WASM="contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm"

# ── Network configuration ────────────────────────────────────────────────────
case "$NETWORK" in
  testnet)
    RPC_URL="https://soroban-testnet.stellar.org"
    PASSPHRASE="Test SDF Network ; September 2015"
    ;;
  mainnet)
    RPC_URL="https://mainnet.stellar.validationcloud.io/v1/xyciqR7GmMO0UHcbCwqCgjovqv9IFr-mf0xmHdGP9sI="
    PASSPHRASE="Public Global Stellar Network ; September 2015"
    ;;
  *)
    echo "ERROR: Unknown STELLAR_NETWORK value: '${NETWORK}'. Allowed values: 'testnet', 'mainnet'." >&2
    exit 1
    ;;
esac

echo "Network:  ${NETWORK}" >&2
echo "Identity: ${IDENTITY}" >&2
echo "RPC URL:  ${RPC_URL}" >&2

# ── Step 1: Build ─────────────────────────────────────────────────────────────
echo "" >&2
echo "Building contract..." >&2
if ! make build; then
  echo "ERROR: Contract build failed. See output above for details." >&2
  exit 1
fi

# Verify WASM artifact is present
if [ ! -f "$WASM" ]; then
  echo "ERROR: WASM artifact not found at '${WASM}' after build." >&2
  exit 1
fi
echo "Build successful: ${WASM}" >&2

# ── Step 2: Deploy ────────────────────────────────────────────────────────────
echo "" >&2
echo "Deploying contract to ${NETWORK}..." >&2
CONTRACT_ID=$(
  stellar contract deploy \
    --wasm "$WASM" \
    --source "$IDENTITY" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$PASSPHRASE" \
    2>/dev/null
) || {
  echo "ERROR: Contract deployment failed. Ensure the Stellar CLI is installed and '${IDENTITY}' identity is configured and funded." >&2
  exit 1
}

if [ -z "$CONTRACT_ID" ]; then
  echo "ERROR: Deployment returned an empty contract ID." >&2
  exit 1
fi

echo "Deployment successful." >&2
echo "" >&2

# ── Output: Contract address on stdout (ONLY line on stdout) ──────────────────
echo "$CONTRACT_ID"
