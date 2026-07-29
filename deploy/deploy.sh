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

# ── Stellar CLI version pin ───────────────────────────────────────────────────
# Pin to a known-good CLI release so all deploys use identical tooling.
# Update this value deliberately after testing the new CLI version.
STELLAR_CLI_VERSION="21.3.0"

# ── Inputs ────────────────────────────────────────────────────────────────────
NETWORK="${STELLAR_NETWORK:-testnet}"
IDENTITY="${STELLAR_IDENTITY:-alice}"
WASM="contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm"
MANIFEST="deploy/deployments.json"

# Resolve repo root regardless of where the script is invoked from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
WASM="${REPO_ROOT}/${WASM#*/}"
WASM="${REPO_ROOT}/contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm"
MANIFEST="${REPO_ROOT}/deploy/deployments.json"

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

echo "Network:             ${NETWORK}" >&2
echo "Identity:            ${IDENTITY}" >&2
echo "RPC URL:             ${RPC_URL}" >&2
echo "Stellar CLI version: ${STELLAR_CLI_VERSION}" >&2

# ── Step 0: Verify Stellar CLI version ───────────────────────────────────────
echo "" >&2
echo "Checking Stellar CLI version..." >&2
INSTALLED_CLI_VERSION=$(stellar version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1 || true)

if [ -z "$INSTALLED_CLI_VERSION" ]; then
  echo "ERROR: Stellar CLI not found. Install with:" >&2
  echo "  cargo install --locked stellar-cli --version ${STELLAR_CLI_VERSION} --features opt" >&2
  exit 1
fi

if [ "$INSTALLED_CLI_VERSION" != "$STELLAR_CLI_VERSION" ]; then
  echo "ERROR: Stellar CLI version mismatch." >&2
  echo "  Required:  ${STELLAR_CLI_VERSION}" >&2
  echo "  Installed: ${INSTALLED_CLI_VERSION}" >&2
  echo "  To install the required version:" >&2
  echo "    cargo install --locked stellar-cli --version ${STELLAR_CLI_VERSION} --features opt" >&2
  exit 1
fi

echo "Stellar CLI ${INSTALLED_CLI_VERSION} — OK" >&2

# ── Step 1: Build ─────────────────────────────────────────────────────────────
echo "" >&2
echo "Building contract..." >&2
cd "${REPO_ROOT}"
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

# ── Step 2: Compute new WASM hash ─────────────────────────────────────────────
echo "" >&2
echo "Computing WASM hash..." >&2
NEW_WASM_HASH=$(stellar contract inspect --wasm "$WASM" 2>/dev/null \
  | grep -i "^hash:" | awk '{print $2}' || true)

# Fallback: compute SHA-256 if stellar contract inspect doesn't return a hash line
if [ -z "$NEW_WASM_HASH" ]; then
  NEW_WASM_HASH=$(sha256sum "$WASM" | awk '{print $1}')
  echo "  (computed via sha256sum — stellar contract inspect output did not include a hash line)" >&2
fi

echo "New WASM hash: ${NEW_WASM_HASH}" >&2

# ── Step 3: Upgrade safety check ─────────────────────────────────────────────
echo "" >&2
if [ -f "$MANIFEST" ] && command -v python3 &>/dev/null; then
  CURRENT_WASM_HASH=$(python3 - <<EOF
import json, sys
try:
    data = json.load(open('${MANIFEST}'))
    entry = data.get('${NETWORK}', {})
    print(entry.get('wasm_hash', ''))
except Exception:
    print('')
EOF
  )
  if [ -n "$CURRENT_WASM_HASH" ] && [ "$CURRENT_WASM_HASH" = "$NEW_WASM_HASH" ]; then
    echo "WARNING: The new WASM hash is identical to the currently deployed hash on ${NETWORK}." >&2
    echo "  Current: ${CURRENT_WASM_HASH}" >&2
    echo "  New:     ${NEW_WASM_HASH}" >&2
    echo "  This deployment will re-deploy an unchanged contract." >&2
    echo "  Set FORCE_DEPLOY=1 to suppress this warning and proceed." >&2
    if [ "${FORCE_DEPLOY:-0}" != "1" ]; then
      echo "  Aborting. Use FORCE_DEPLOY=1 to override." >&2
      exit 1
    fi
    echo "  FORCE_DEPLOY=1 set — proceeding with unchanged contract." >&2
  elif [ -n "$CURRENT_WASM_HASH" ]; then
    echo "WASM hash changed — new deployment required." >&2
    echo "  Previous: ${CURRENT_WASM_HASH}" >&2
    echo "  New:      ${NEW_WASM_HASH}" >&2
  else
    echo "No previous deployment recorded for ${NETWORK} — first deploy." >&2
  fi
else
  echo "No existing manifest found — first deploy." >&2
fi

# ── Step 4: Deploy ────────────────────────────────────────────────────────────
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

echo "Deployment successful. Contract ID: ${CONTRACT_ID}" >&2

# ── Step 5: Collect deployment metadata ──────────────────────────────────────
DEPLOYED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
GIT_COMMIT=$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo "unknown")

echo "" >&2
echo "Deployment metadata:" >&2
echo "  Deployed at:         ${DEPLOYED_AT}" >&2
echo "  Git commit:          ${GIT_COMMIT}" >&2
echo "  WASM hash:           ${NEW_WASM_HASH}" >&2
echo "  Stellar CLI version: ${STELLAR_CLI_VERSION}" >&2

# ── Step 6: Update deployment manifest ───────────────────────────────────────
echo "" >&2
echo "Updating deployment manifest: ${MANIFEST}" >&2

# Use python3 to safely merge the new entry into the JSON manifest
python3 - <<EOF
import json, os

manifest_path = '${MANIFEST}'

# Load existing manifest or start fresh
if os.path.exists(manifest_path):
    with open(manifest_path, 'r') as f:
        data = json.load(f)
else:
    data = {}

# Preserve history: move current entry to a history array
network = '${NETWORK}'
if network in data and isinstance(data[network], dict):
    existing = data[network]
    # Only archive if it has a contract_id (i.e., it's a real past deployment)
    if 'contract_id' in existing:
        history = data.setdefault(network + '_history', [])
        history.append(existing)

data[network] = {
    'contract_id':          '${CONTRACT_ID}',
    'wasm_hash':            '${NEW_WASM_HASH}',
    'deployed_at':          '${DEPLOYED_AT}',
    'stellar_cli_version':  '${STELLAR_CLI_VERSION}',
    'git_commit':           '${GIT_COMMIT}',
}

with open(manifest_path, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')

print(f'Manifest updated: {manifest_path}')
EOF

echo "" >&2

# ── Output: Contract address on stdout (ONLY line on stdout) ──────────────────
echo "$CONTRACT_ID"
