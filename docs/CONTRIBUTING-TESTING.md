# Testing & Validation Guide

How to verify that SorobanPay builds, tests, and runs correctly on **Linux** and **macOS** after cloning or making changes.

---

## Prerequisites

Install these tools before running any tests.

| Tool | Version | Install |
|------|---------|---------|
| Rust (stable) | ≥ 1.76 | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Node.js | ≥ 18 | https://nodejs.org or `nvm install 18` |
| Stellar CLI | ≥ 21.x | `cargo install --locked stellar-cli --features opt` |

Verify your setup:

```bash
rustc --version          # rustc 1.xx.x (...)
node --version           # v18.x.x or higher
stellar --version        # stellar 21.x.x
```

## Deterministic tests without credentials

Frontend and backend tests can replace wallets, network responses, databases,
and time. These controls use synthetic values; do not put private keys, real
wallet seeds, access tokens, production database URLs, or signed transactions
in test fixtures or logs.

| Dependency | Existing control | What it isolates |
|------------|------------------|------------------|
| Freighter wallet | `frontend/tests/freighter-mock.ts` and `frontend/e2e/helpers/freighter-mock.ts` | Supplies a synthetic public key and sentinel transaction response in the browser. It does not connect to an installed wallet. |
| Soroban RPC/network | `frontend/src/test-utils/msw-server.ts` | MSW intercepts the testnet RPC URL with JSON-RPC success, network-error, timeout, account, and simulation responses. Add a per-test handler with `server.use(...)`. |
| Backend API | `frontend/tests/pact/api.consumer.pact.test.ts` | Pact's local mock server returns the responses declared by each consumer interaction; it does not call a deployed backend. |
| Database | `backend/tests/helpers/inMemoryDb.ts`; the Pact provider test also uses in-memory Prisma mocks | Stores test records in process memory rather than PostgreSQL. The helper implements only the methods its tests exercise. |
| Clock | Jest fake timers in frontend unit tests | Freezes or advances JavaScript timers and `Date` without waiting for wall-clock time. |

Run one of these commands from the repository root:

```bash
(cd frontend && npm test -- --runInBand)
```

```bash
(cd frontend && npx playwright test tests/subscription-form.spec.ts --project=chromium)
```

```bash
(cd backend && npm run test:integration -- --runInBand)
```

Playwright starts the frontend using the dummy contract address in
`frontend/playwright.config.ts`; a wallet extension, funded account, RPC
credential, and `.env.local` are not required for that configured test run.
Expected results are Jest `PASS` output or Playwright passing tests. The
integration suite uses its in-memory database helper, so it does not require a
live database.

### Isolating failures

- For RPC cases, override only the needed MSW handler with `server.use(...)`.
  Unhandled requests are warned about; add a mock for the exact URL and method
  rather than allowing a test to reach a live service. Use
  `rpcNetworkErrorHandler` or `rpcTimeoutHandler` to cover failures explicitly.
- Keep each test's database state local and clear it between cases with the
  helper's `clear()` method. If a mock Prisma method is involved, reset its
  mocked state in the test lifecycle too.
- Pair `jest.useFakeTimers()` with `jest.useRealTimers()` in cleanup. Advance
  the clock deliberately with `jest.advanceTimersByTime(...)`; do not add real
  sleeps to tests.
- Use the wallet mock when exercising wallet-dependent browser flows. If a
  test still reports that no wallet is connected, confirm its init script runs
  before page code; do not work around it with a real wallet or real secret.
- When failures include request or application details, inspect the sanitized
  error and correlation context. Never print credentials or full secret
  material to make a failure easier to diagnose.

---

## 1. Smart Contract Tests

Run the full Rust/Soroban test suite from the repo root.

```bash
make test
```

Equivalent to:

```bash
cargo test --manifest-path contracts/subscription/Cargo.toml
```

**Expected output** (all tests pass):

```
running N tests
test test_subscribe ... ok
test test_execute_payment ... ok
test test_cancel ... ok
...
test result: ok. N passed; 0 failed
```

**macOS note:** If you see a linker error mentioning `cc`, install Xcode Command Line Tools:

```bash
xcode-select --install
```

**Linux note:** On Debian/Ubuntu, ensure `build-essential` is installed:

```bash
sudo apt-get install -y build-essential
```

---

## 2. Frontend Type Check

Verify that the TypeScript compilation is clean (no type errors).

```bash
cd frontend
npm install
npm run type-check
```

**Expected output:**

```
> soroban-pay-frontend@1.0.0 type-check
> tsc --noEmit
```

No output after the command means no type errors. Any `error TS...` lines indicate a problem.

---

## 3. Frontend Unit Tests

Run Jest unit tests (validation logic, hooks, utilities):

```bash
cd frontend
npm install
npm test
```

**Expected output:**

```
PASS  lib/validation.test.ts
Test Suites: 1 passed, 1 total
Tests:       N passed, N total
```

---

## 4. Frontend Linter

```bash
cd frontend
npm run lint
```

**Expected output:** No warnings or errors. Any `Error:` lines must be resolved before opening a PR.

---

## 5. Frontend E2E Tests (Playwright)

End-to-end tests exercise the subscription form in a real browser.

**Prerequisites:** Start the dev server in a separate terminal first.

```bash
# Terminal 1 — dev server
cd frontend
cp .env.example .env.local   # only needed once
npm run dev
```

```bash
# Terminal 2 — run Playwright tests
cd frontend
npx playwright install --with-deps   # only needed once
npx playwright test
```

**Expected output:**

```
Running N tests using N workers
  N passed (Xs)
```

**macOS note:** If Playwright browser installs fail, try:

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=0 npx playwright install chromium
```

**Linux note:** Playwright needs system libraries. On Debian/Ubuntu:

```bash
npx playwright install-deps
```

---

## 6. Full Build Verification

Build the contract WASM and the frontend production bundle to catch any compilation errors that tests might not surface.

```bash
# Contract
make build

# Frontend
cd frontend
npm run build
```

**Contract expected output:**

```
Compiling soroban_subscription_contract ...
Finished release [optimized] target(s)
```

**Frontend expected output:**

```
Route (app) ...
✓ Compiled successfully
```

---

## 7. Deployment Smoke Test

After deploying to testnet you can verify the contract is live:

```bash
# Deploy (one-time per environment)
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet
CONTRACT_ID=$(bash deploy/deploy.sh)

# Smoke test — calls subscribe with test values
bash deploy/smoke_test.sh "$CONTRACT_ID"
```

**Expected output:** No `ERROR` lines; the script prints the contract ID and confirms the call succeeded.

---

## Validation Checklist (Linux & macOS)

Run through this checklist before opening a PR that touches the contract or frontend:

- [ ] `make test` — all Rust tests pass
- [ ] `npm run type-check` — zero TypeScript errors
- [ ] `npm test` — all Jest unit tests pass
- [ ] `npm run lint` — no ESLint errors
- [ ] `make build` — contract WASM compiles cleanly
- [ ] `npm run build` — Next.js production build succeeds

If any step fails, fix the issue before pushing. CI runs the same checks and will block the PR.

---

## CI/CD

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs the contract tests and frontend type-check on every push and pull request. The steps mirror this document exactly — if your local checks pass, CI will pass.
