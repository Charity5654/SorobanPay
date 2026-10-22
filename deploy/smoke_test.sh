#!/usr/bin/env bash
# Offline deployment smoke test. All deploys run in disposable fixtures with
# stubbed build/CLI commands; no live network or wallet credentials are used.
set -euo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/deploy.sh"
TMP_ROOT="$(mktemp -d)"
PASS=0
FAIL=0
EXPECTED_CONTRACT_ID="CFAKECONTRACTID000000000000000000000000000000000000000000"

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT

pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# ── 1. Syntax check ───────────────────────────────────────────────────────────
if bash -n "$SCRIPT" 2>/dev/null; then
  pass "syntax check"
else
  fail "syntax check"
fi

# ── Isolated deployment fixture ──────────────────────────────────────────────
make_fixture() {
  local fixture="$TMP_ROOT/$1"
  mkdir -p "$fixture/deploy" "$fixture/stubs"
  cp "$SCRIPT" "$fixture/deploy/deploy.sh"
  printf '{}\n' > "$fixture/deploy/deployments.json"

  cat > "$fixture/stubs/make" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
mkdir -p contracts/target/wasm32-unknown-unknown/release
touch contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm
STUB
  chmod +x "$fixture/stubs/make"

  cat > "$fixture/stubs/stellar" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
if [[ "${1:-}" == "version" ]]; then
  echo "stellar 21.3.0"
elif [[ "${1:-}" == "contract" && "${2:-}" == "inspect" ]]; then
  echo "hash: smoke-wasm-hash"
elif [[ "${1:-}" == "contract" && "${2:-}" == "deploy" ]]; then
  [[ "${SMOKE_FAIL_DEPLOY:-0}" != "1" ]] || exit 1
  echo "CFAKECONTRACTID000000000000000000000000000000000000000000"
else
  echo "Unexpected stellar command" >&2
  exit 2
fi
STUB
  chmod +x "$fixture/stubs/stellar"
  printf '%s\n' "$fixture"
}

run_deploy() {
  local fixture="$1"
  shift
  (
    export PATH="$fixture/stubs:$PATH"
    cd "$fixture"
    env "$@" bash deploy/deploy.sh
  )
}

manifest_matches() {
  python3 - "$1/deploy/deployments.json" "$2" "$3" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as manifest_file:
    manifest = json.load(manifest_file)
entry = manifest.get(sys.argv[2], {})
raise SystemExit(0 if entry.get("contract_id") == sys.argv[3]
                 and entry.get("wasm_hash") == "smoke-wasm-hash" else 1)
PY
}

manifest_is_empty() {
  python3 - "$1/deploy/deployments.json" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf-8") as manifest_file:
    raise SystemExit(0 if json.load(manifest_file) == {} else 1)
PY
}

# ── Positive paths ───────────────────────────────────────────────────────────
if bash -n "$SCRIPT"; then
  pass "deployment script syntax"
else
  fail "deployment script syntax"
fi

fixture="$(make_fixture testnet)"
if output="$(run_deploy "$fixture" STELLAR_NETWORK=testnet STELLAR_IDENTITY=ci-smoke 2>/dev/null)" \
  && [[ "$output" == "$EXPECTED_CONTRACT_ID" ]] \
  && manifest_matches "$fixture" testnet "$EXPECTED_CONTRACT_ID"; then
  pass "testnet deploy writes contract ID and manifest"
else
  fail "testnet deploy writes contract ID and manifest"
fi

fixture="$(make_fixture mainnet)"
if output="$(run_deploy "$fixture" STELLAR_NETWORK=mainnet STELLAR_IDENTITY=ci-smoke 2>/dev/null)" \
  && [[ "$output" == "$EXPECTED_CONTRACT_ID" ]] \
  && manifest_matches "$fixture" mainnet "$EXPECTED_CONTRACT_ID"; then
  pass "mainnet configuration runs against stubs only"
else
  fail "mainnet configuration runs against stubs only"
fi

# ── Negative and boundary paths ──────────────────────────────────────────────
fixture="$(make_fixture invalid-network)"
if run_deploy "$fixture" STELLAR_NETWORK=badnet 2>/dev/null; then
  fail "unsupported network is rejected"
else
  pass "unsupported network is rejected"
fi

fixture="$(make_fixture unchanged-wasm)"
printf '{"testnet":{"contract_id":"CPREVIOUS","wasm_hash":"smoke-wasm-hash"}}\n' \
  > "$fixture/deploy/deployments.json"
if run_deploy "$fixture" STELLAR_NETWORK=testnet 2>/dev/null; then
  fail "unchanged WASM requires explicit override"
else
  pass "unchanged WASM requires explicit override"
fi
if output="$(run_deploy "$fixture" STELLAR_NETWORK=testnet FORCE_DEPLOY=1 2>/dev/null)" \
  && [[ "$output" == "$EXPECTED_CONTRACT_ID" ]]; then
  pass "FORCE_DEPLOY recovers unchanged-WASM boundary"
else
  fail "FORCE_DEPLOY recovers unchanged-WASM boundary"
fi

# ── Recovery path ────────────────────────────────────────────────────────────
fixture="$(make_fixture deploy-retry)"
if run_deploy "$fixture" STELLAR_NETWORK=testnet SMOKE_FAIL_DEPLOY=1 2>/dev/null; then
  fail "failed deploy leaves manifest untouched"
else
  if manifest_is_empty "$fixture"; then
    pass "failed deploy leaves manifest untouched"
  else
    fail "failed deploy leaves manifest untouched"
  fi
fi
if output="$(run_deploy "$fixture" STELLAR_NETWORK=testnet 2>/dev/null)" \
  && [[ "$output" == "$EXPECTED_CONTRACT_ID" ]] \
  && manifest_matches "$fixture" testnet "$EXPECTED_CONTRACT_ID"; then
  pass "successful retry updates deployment manifest"
else
  fail "successful retry updates deployment manifest"
fi

# Promotion workflows may supply a health URL; PR runs never need a secret or
# contact a deployed service.
if [[ -n "${SMOKE_TARGET_URL:-}" ]]; then
  if python3 - "$SMOKE_TARGET_URL" <<'PY'
import sys
from urllib.parse import urlparse

url = urlparse(sys.argv[1])
raise SystemExit(0 if url.scheme == "https" and url.hostname
                 and not url.username and not url.password
                 and not url.query and not url.fragment else 1)
PY
  then
    if curl --fail --silent --show-error --max-time 10 \
      "${SMOKE_TARGET_URL%/}/health" --output /dev/null 2>/dev/null; then
      pass "configured deployment health endpoint responds"
    else
      fail "configured deployment health endpoint responds"
    fi
  else
    fail "SMOKE_TARGET_URL must be an HTTPS URL without credentials or query data"
  fi
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
