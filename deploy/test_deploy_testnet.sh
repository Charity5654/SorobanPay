#!/usr/bin/env bash
# =============================================================================
# Integration test for deploy/deploy.sh — testnet mode (mocked)
#
# Validates that deploy.sh:
#   1. Accepts STELLAR_NETWORK=testnet / mainnet
#   2. Rejects unknown STELLAR_NETWORK with exit 1
#   3. Outputs a contract address (Cxxx…) on stdout — nothing else
#   4. Sends all diagnostic output to stderr
#   5. Propagates non-zero exit from 'stellar contract deploy'
#
# The 'stellar' CLI and 'make' are replaced by stubs so the test runs
# in CI without Rust, Stellar CLI, or real credentials.
#
# Usage:  bash deploy/test_deploy_testnet.sh
# =============================================================================
set -euo pipefail

PASS=0
FAIL=0

ok()   { echo "  PASS: $*"; PASS=$((PASS+1)); }
fail() { echo "  FAIL: $*"; FAIL=$((FAIL+1)); }

STUB_DIR="$(mktemp -d)"
MOCK_CONTRACT="CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"

# Fake WASM so the file-existence guard in deploy.sh passes
FAKE_WASM_DIR="contracts/target/wasm32-unknown-unknown/release"
mkdir -p "$FAKE_WASM_DIR"
touch "$FAKE_WASM_DIR/soroban_subscription_contract.wasm"

cleanup() { rm -rf "$STUB_DIR" "$FAKE_WASM_DIR/soroban_subscription_contract.wasm"; }
trap cleanup EXIT

# Stub 'make': no-op (skips real Rust build)
cat > "$STUB_DIR/make" << 'EOF'
#!/usr/bin/env bash
exit 0
EOF
chmod +x "$STUB_DIR/make"

# Stub 'stellar' that succeeds and prints the mock contract ID
write_stellar_stub_ok() {
  cat > "$STUB_DIR/stellar" << EOF
#!/usr/bin/env bash
echo "${MOCK_CONTRACT}"
EOF
  chmod +x "$STUB_DIR/stellar"
}

# Stub 'stellar' that fails
write_stellar_stub_fail() {
  cat > "$STUB_DIR/stellar" << 'EOF'
#!/usr/bin/env bash
exit 1
EOF
  chmod +x "$STUB_DIR/stellar"
}

run_deploy() {
  # $1 = STELLAR_NETWORK value; extra args forwarded to env
  STELLAR_NETWORK="$1" STELLAR_IDENTITY=test-id \
    PATH="$STUB_DIR:$PATH" \
    bash deploy/deploy.sh
}

# ── Test 1: stdout is a 56-char C-address ─────────────────────────────────────
write_stellar_stub_ok
OUTPUT=$(run_deploy testnet 2>/dev/null)
if [[ "$OUTPUT" == C* && ${#OUTPUT} -eq 56 ]]; then
  ok "testnet: stdout is a 56-char C-address"
else
  fail "testnet: unexpected stdout '${OUTPUT}'"
fi

# ── Test 2: contract ID matches the stub's output exactly ────────────────────
if [[ "$OUTPUT" == "$MOCK_CONTRACT" ]]; then
  ok "testnet: contract ID matches stub output exactly"
else
  fail "testnet: got '${OUTPUT}', expected '${MOCK_CONTRACT}'"
fi

# ── Test 3: contract ID does NOT appear on stderr ─────────────────────────────
write_stellar_stub_ok
STDERR_ONLY=$(run_deploy testnet 2>&1 1>/dev/null)
if [[ "$STDERR_ONLY" != *"$MOCK_CONTRACT"* ]]; then
  ok "testnet: contract ID not leaked to stderr"
else
  fail "testnet: contract ID appeared on stderr"
fi

# ── Test 4: mainnet mode also outputs a C-address ────────────────────────────
write_stellar_stub_ok
OUTPUT_MAIN=$(run_deploy mainnet 2>/dev/null)
if [[ "$OUTPUT_MAIN" == C* && ${#OUTPUT_MAIN} -eq 56 ]]; then
  ok "mainnet: outputs a C-address"
else
  fail "mainnet: unexpected output '${OUTPUT_MAIN}'"
fi

# ── Test 5: unknown STELLAR_NETWORK exits non-zero ───────────────────────────
write_stellar_stub_ok
set +e
run_deploy notanet > /dev/null 2>&1
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  ok "unknown network: exits non-zero (${EXIT_CODE})"
else
  fail "unknown network: expected non-zero exit, got 0"
fi

# ── Test 6: stellar CLI failure → deploy.sh exits non-zero ───────────────────
write_stellar_stub_fail
set +e
run_deploy testnet > /dev/null 2>&1
EXIT_CODE=$?
set -e
if [ "$EXIT_CODE" -ne 0 ]; then
  ok "stellar failure: deploy.sh exits non-zero"
else
  fail "stellar failure: expected non-zero exit, got 0"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
