# Developer Onboarding Guide

Complete reference for SorobanPay's build, test, and deployment workflows. Start here if you are setting up a local development environment or contributing code.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Initial Setup](#initial-setup)
3. [Smart Contract Workflow](#smart-contract-workflow)
4. [Frontend Workflow](#frontend-workflow)
5. [Deployment Workflow](#deployment-workflow)
6. [Running the Full Stack Locally](#running-the-full-stack-locally)
7. [Testing Strategy](#testing-strategy)
8. [Common Development Tasks](#common-development-tasks)
9. [Troubleshooting](#troubleshooting)

---

## Prerequisites

Install these tools before starting. All commands assume a Unix-like shell (bash/zsh on Linux or macOS). Windows users should use WSL2.

### Required tools

| Tool | Minimum Version | Purpose | Install Command |
|------|----------------|---------|-----------------|
| **Rust** (stable) | 1.76+ | Compile Soroban contracts | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| **wasm32 target** | — | WASM compilation | `rustup target add wasm32-unknown-unknown` |
| **Stellar CLI** | 21.0+ | Deploy contracts, manage identities | `cargo install --locked stellar-cli --features opt` |
| **Node.js** | 18.0+ | Frontend tooling | https://nodejs.org or use `nvm` |
| **npm** | 9.0+ | Dependency management | Included with Node.js |
| **GNU Make** | 3.81+ | Build orchestration | Pre-installed on macOS/Linux |
| **Freighter** | latest | Browser wallet for testing | https://www.freighter.app |

### Platform-specific notes

#### macOS
```bash
# Install Xcode Command Line Tools (required for Rust linker)
xcode-select --install
```

#### Linux (Debian/Ubuntu)
```bash
# Install build essentials
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libssl-dev
```

### Verify installation

Run these commands to confirm everything is installed correctly:

```bash
rustc --version          # Should show 1.76 or higher
cargo --version          # Bundled with Rust
stellar --version        # Should show 21.x.x or higher
node --version           # Should show v18.x.x or higher
npm --version            # Should show 9.x.x or higher
make --version           # Pre-installed on Unix systems
```

---

## Initial Setup

### 1. Clone the repository

```bash
git clone https://github.com/Chrisland58/SorobanPay.git
cd SorobanPay
```

### 2. Verify your environment

Run the contract test suite to confirm Rust and Soroban SDK are working:

```bash
make test
```

**Expected output:**
```
running N tests
test test_subscribe ... ok
test test_execute_payment ... ok
test test_cancel ... ok
...
test result: ok. N passed; 0 failed
```

If tests fail, see [Troubleshooting](#troubleshooting).

### 3. Set up Stellar identity

Create a testnet identity for deploying contracts:

```bash
# Generate a new keypair
stellar keys generate alice --network testnet

# Fund it with testnet XLM (required for transaction fees)
stellar keys fund alice --network testnet

# Verify the account was funded
stellar keys address alice
```

**Mainnet setup** (only needed for production deployment):
```bash
# Generate mainnet identity
stellar keys generate mainnet-deployer --network mainnet

# Print public key and fund it manually with real XLM (minimum 2 XLM)
stellar keys address mainnet-deployer
```

---

## Smart Contract Workflow

The contract lives in `contracts/subscription/` and is written in Rust using the Soroban SDK.

### Build

Compile the contract to WASM:

```bash
make build
```

**What it does:**
- Runs `cargo build --target wasm32-unknown-unknown --release`
- Optimizes binary size with `opt-level = "z"` and `lto = true`
- Outputs WASM to `contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm`
- Verifies the artifact exists and exits with error if missing

**Advanced build options:**

Override the compilation target or profile:
```bash
make build TARGET_TRIPLE=wasm32-unknown-unknown PROFILE=release  # defaults
make build TARGET_TRIPLE=x86_64-unknown-linux-gnu PROFILE=debug  # native debug build
```

> **Warning:** The `TARGET_TRIPLE` override is for experimentation only. Production deployments must use `wasm32-unknown-unknown`.

### Test

Run the full test suite:

```bash
make test
```

**What it does:**
- Runs `cargo test --manifest-path contracts/subscription/Cargo.toml`
- Executes tests on the **native host** (not WASM) using the Soroban test environment
- Tests cover:
  - Lifecycle (`subscribe` → `execute_payment` → `cancel`)
  - Error paths (invalid amounts, payment not due, no active subscription)
  - Authorization guards (subscriber/merchant auth checks)
  - Event emissions (`subscribe`, `executed`, `payment_transfer_failure`, `cancel`)
  - Property-based invariants (time-lock, double-payment prevention)

**Run a specific test:**
```bash
cargo test --manifest-path contracts/subscription/Cargo.toml test_subscribe
```

**Run tests with output:**
```bash
cargo test --manifest-path contracts/subscription/Cargo.toml -- --nocapture
```

### Coverage

Generate a coverage report to verify test quality:

```bash
make coverage
```

**Requirements:**
```bash
# Install cargo-llvm-cov (one-time setup)
cargo install cargo-llvm-cov
```

**What it does:**
- Runs tests with instrumentation
- Generates LCOV report at `contracts/target/lcov.info`
- Generates HTML report at `contracts/target/coverage-html/index.html`
- Enforces 95% line coverage threshold (configurable via `COVERAGE_THRESHOLD`)

**View the HTML report:**
```bash
open contracts/target/coverage-html/index.html  # macOS
xdg-open contracts/target/coverage-html/index.html  # Linux
```

**Override coverage threshold:**
```bash
make coverage COVERAGE_THRESHOLD=90
```

### Clean

Remove all build artifacts:

```bash
make clean
```

Equivalent to `cargo clean --manifest-path contracts/subscription/Cargo.toml`.

---

## Frontend Workflow

The frontend is a Next.js 14 TypeScript app in `frontend/` that connects to Freighter wallet and submits transactions to Soroban RPC.

### Install dependencies

```bash
cd frontend
npm install
```

### Configure environment

Copy the example environment file:

```bash
cp .env.example .env.local
```

Edit `.env.local` with your deployed contract address:

```env
# Contract address (from deploy step — see Deployment Workflow section)
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX

# Testnet configuration (default)
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Mainnet configuration (comment out testnet, uncomment these)
# NEXT_PUBLIC_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_KEY>
# NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

**Required variables:**
- `NEXT_PUBLIC_CONTRACT_ID` — Deployed contract address (starts with `C`)
- `NEXT_PUBLIC_RPC_URL` — Soroban RPC endpoint
- `NEXT_PUBLIC_NETWORK_PASSPHRASE` — Must match Freighter's network setting

If `NEXT_PUBLIC_CONTRACT_ID` is missing, the app shows a "Contract not configured" warning.

### Development server

Start the Next.js dev server with hot reload:

```bash
npm run dev
```

Open http://localhost:3000 in a browser with Freighter installed.

**Dev server features:**
- Hot module replacement (HMR) — changes appear instantly
- Error overlay — compilation/runtime errors shown in browser
- Fast refresh — preserves component state across edits

### Type checking

Verify TypeScript types without emitting files:

```bash
npm run type-check
```

**Expected output:** No output means success. Any `error TS...` lines indicate type errors.

**Recommended workflow:** Run this before committing changes to catch type errors early.

### Linting

Check code style and catch common issues:

```bash
npm run lint
```

Uses ESLint with Next.js's recommended config. Fix any errors before opening a PR.

**Auto-fix simple issues:**
```bash
npm run lint -- --fix
```

### Testing

#### Unit tests (Jest)

Run fast, isolated tests for validation logic and utilities:

```bash
npm test
```

**Run with coverage:**
```bash
npm run test:coverage
```

Coverage report is generated at `frontend/coverage/lcov-report/index.html`.

**Run specific test file:**
```bash
npm test -- validation.test.ts
```

**Watch mode (re-run on file changes):**
```bash
npm test -- --watch
```

#### End-to-end tests (Playwright)

Test the full subscription flow in a real browser:

```bash
# Install browsers (one-time setup)
npx playwright install --with-deps

# Run E2E tests (requires dev server running)
npm run test:e2e
```

**Prerequisites:**
1. Dev server must be running (`npm run dev` in another terminal)
2. Contract must be deployed and configured in `.env.local`

**List available tests:**
```bash
npm run test:e2e:list
```

**Debug mode (opens browser):**
```bash
npx playwright test --debug
```

### Production build

Build an optimized production bundle:

```bash
npm run build
```

**What it does:**
- Compiles TypeScript to JavaScript
- Bundles and minifies all code
- Optimizes images and fonts
- Generates static HTML for pre-rendered pages
- Outputs to `frontend/.next/`

**Serve the production build:**
```bash
npm start
```

Visit http://localhost:3000 to test the production build locally.

---

## Deployment Workflow

Deploy the contract to Stellar testnet or mainnet using the automated deployment script.

### Deploy to testnet

```bash
# From repository root
bash deploy/deploy.sh
```

**What it does:**
1. Builds the contract (`make build`)
2. Verifies WASM artifact exists
3. Deploys via `stellar contract deploy` to testnet RPC
4. Prints contract address to stdout

**Capture the contract address:**
```bash
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Deployed contract: $CONTRACT_ID"
```

**Configuration:**
- Network: `testnet` (default)
- Identity: `alice` (default, must be funded)
- RPC URL: `https://soroban-testnet.stellar.org`

### Deploy to mainnet

```bash
# Requires a funded mainnet identity
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=mainnet-deployer bash deploy/deploy.sh
```

**Prerequisites:**
1. Mainnet identity must exist: `stellar keys generate mainnet-deployer --network mainnet`
2. Identity must be funded with ≥2 XLM: `stellar keys address mainnet-deployer` (fund this address manually)

**Mainnet configuration:**
- Network: `mainnet`
- RPC URL: `https://mainnet.stellar.validationcloud.io/v1/...`
- Passphrase: `Public Global Stellar Network ; September 2015`

### Environment variables

| Variable | Default | Options | Description |
|----------|---------|---------|-------------|
| `STELLAR_NETWORK` | `testnet` | `testnet`, `mainnet` | Target network |
| `STELLAR_IDENTITY` | `alice` | Any CLI identity | Keypair for signing deployment transaction |

### Deployment output

**Success:**
```
Network:  testnet
Identity: alice
RPC URL:  https://soroban-testnet.stellar.org

Building contract...
Build successful: contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm

Deploying contract to testnet...
Deployment successful.

CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
```

The final line (contract address) is the only stdout output — diagnostic messages go to stderr.

**Failure scenarios:**

| Error | Cause | Fix |
|-------|-------|-----|
| `ERROR: Contract build failed` | Rust toolchain or wasm32 target missing | Run `rustup target add wasm32-unknown-unknown` |
| `ERROR: WASM artifact not found` | Build produced no output | Check Cargo.toml has release profile with `opt-level = "z"` |
| `ERROR: Contract deployment failed` | Identity not funded or CLI misconfigured | Fund account: `stellar keys fund <identity> --network testnet` |
| `ERROR: Unknown STELLAR_NETWORK value` | Typo in network name | Use exactly `testnet` or `mainnet` |

### Post-deployment

1. **Update frontend config:**
   ```bash
   echo "NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID" >> frontend/.env.local
   ```

2. **Verify deployment:**
   ```bash
   # Inspect contract on Stellar Expert
   # Testnet: https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID
   # Mainnet: https://stellar.expert/explorer/public/contract/$CONTRACT_ID
   ```

3. **Test contract invocation:**
   ```bash
   # Call subscribe (requires merchant address and token)
   stellar contract invoke \
     --id $CONTRACT_ID \
     --source alice \
     --network testnet \
     -- subscribe \
     --subscriber $(stellar keys address alice) \
     --merchant GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
     --token CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX \
     --amount 1000000 \
     --interval 2592000
   ```

---

## Running the Full Stack Locally

Complete end-to-end setup from clean checkout to working subscription form.

### Step-by-step

```bash
# 1. Clone and enter repository
git clone https://github.com/Chrisland58/SorobanPay.git
cd SorobanPay

# 2. Verify prerequisites
make test  # Should pass all contract tests

# 3. Set up Stellar identity
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet

# 4. Build and deploy contract
make build
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Contract deployed: $CONTRACT_ID"

# 5. Configure frontend
cd frontend
cp .env.example .env.local
echo "NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID" >> .env.local
cat .env.local  # Verify all three variables are set

# 6. Install frontend dependencies
npm install

# 7. Start development server
npm run dev
```

Open http://localhost:3000 in a browser with Freighter installed and set to **Testnet**.

### Freighter wallet setup

1. **Install:** https://www.freighter.app (Chrome, Brave, or Firefox)
2. **Create wallet:** Follow Freighter's setup wizard
3. **Switch to testnet:** Click network name in top-right → select "Testnet"
4. **Fund wallet:** Visit https://laboratory.stellar.org/#account-creator?network=test
5. **Connect to app:** Open http://localhost:3000 → Freighter prompts for connection approval

### Create your first subscription

1. Ensure Freighter shows "Connected" green badge in the form header
2. Fill in subscription details:
   - **Merchant Address:** Any valid G-address (can use your own for testing)
   - **Token Contract:** A testnet token contract address (C-address)
   - **Amount:** Payment amount in token's smallest unit (e.g., 1000000 for 1.00 USDC)
   - **Interval:** Time between payments in seconds (e.g., 2592000 = 30 days)
3. Click **Authorize Subscription**
4. Review details in confirmation modal → click **Confirm and Sign**
5. Approve transaction in Freighter popup
6. Wait for confirmation (progress bar shows status)
7. Success card displays transaction hash — click to view on Stellar Expert

---

## Testing Strategy

SorobanPay uses a three-layer testing strategy to ensure correctness at every level.

### 1. Smart contract tests (Rust)

**Location:** `contracts/subscription/src/test.rs`

**Coverage:**
- ✅ Lifecycle flows (`subscribe` → `execute_payment` → `cancel`)
- ✅ Error paths (invalid amounts, payment not due, no subscription)
- ✅ Authorization guards (require subscriber/merchant signatures)
- ✅ Event emissions (subscribe, executed, payment_transfer_failure, cancel)
- ✅ Edge cases (self-subscription, zero timestamp, overflow)
- ✅ Property-based invariants (time-lock, double-payment prevention)

**Run:** `make test`

**Goal:** 95%+ line coverage (enforced by `make coverage`)

### 2. Frontend unit tests (Jest)

**Location:** `frontend/src/**/*.test.ts`

**Coverage:**
- ✅ Validation logic (`isValidGAddress`, `isValidCAddress`, `validateSubscriptionForm`)
- ✅ Wallet connection state (`useWallet` hook)
- ✅ Form field validation (amount bounds, interval ranges)
- ✅ Error message formatting

**Run:** `npm test`

**Goal:** Fast, isolated tests for pure functions and hooks

### 3. End-to-end tests (Playwright)

**Location:** `frontend/e2e/**/*.spec.ts`

**Coverage:**
- ✅ Full subscription flow (connect wallet → fill form → submit → confirm)
- ✅ Error handling (network unreachable, missing contract, validation errors)
- ✅ Wallet disconnection handling
- ✅ Cross-browser compatibility (Chromium, Firefox, WebKit)

**Run:** `npm run test:e2e`

**Goal:** Verify integration points and user-facing behavior

### CI/CD integration

All tests run automatically on every push via GitHub Actions (`.github/workflows/ci.yml`):

```yaml
jobs:
  contract-tests:
    - make build
    - make test
    - make coverage
  
  frontend-tests:
    - npm run type-check
    - npm run lint
    - npm test
    - npm run build
```

Pull requests are blocked if any test fails.

---

## Common Development Tasks

### Add a new contract entry point

1. **Define the function signature** in `contracts/subscription/src/lib.rs`:
   ```rust
   #[contractimpl]
   impl SubscriptionProtocol {
       pub fn my_new_function(env: Env, arg: Address) -> Result<(), ContractError> {
           // Implementation
       }
   }
   ```

2. **Add event emission** in `src/events.rs`:
   ```rust
   pub fn emit_my_event(env: &Env, arg: &Address) {
       env.events().publish(
           (Symbol::new(env, "my_event"), arg.clone()),
           ()
       );
   }
   ```

3. **Write tests** in `src/test.rs`:
   ```rust
   #[test]
   fn test_my_new_function() {
       // Setup
       // Invoke
       // Assert
   }
   ```

4. **Rebuild and redeploy:**
   ```bash
   make test
   make build
   CONTRACT_ID=$(bash deploy/deploy.sh)
   ```

5. **Update frontend** to call new function (see `frontend/src/lib/transaction_builder.ts`)

### Modify validation rules

Keep contract and frontend validation in sync:

1. **Contract:** Edit `contracts/subscription/src/lib.rs` (e.g., change `MIN_INTERVAL`)
2. **Frontend:** Edit `frontend/src/lib/validation.ts` (e.g., update `MIN_INTERVAL_SECONDS`)
3. **Test both layers:**
   ```bash
   make test           # Contract validation
   npm test            # Frontend validation
   ```

### Add a frontend form field

1. **Update state** in `SubscriptionForm.tsx`:
   ```typescript
   const [newField, setNewField] = useState("");
   const [newFieldError, setNewFieldError] = useState<string | null>(null);
   ```

2. **Add input component:**
   ```tsx
   <input
     value={newField}
     onChange={(e) => setNewField(e.target.value)}
     className="..."
   />
   ```

3. **Add validation:**
   ```typescript
   if (!newField) {
     setNewFieldError("Field is required");
     return;
   }
   ```

4. **Pass to transaction builder** (modify `buildAndSubmitSubscribe` signature)

### Change deployment network

**Switch to mainnet:**
```bash
# 1. Set up mainnet identity (one-time)
stellar keys generate mainnet-deployer --network mainnet
stellar keys address mainnet-deployer  # Fund this address with real XLM

# 2. Deploy
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=mainnet-deployer bash deploy/deploy.sh

# 3. Update frontend
cd frontend
# Edit .env.local — switch RPC URL and passphrase to mainnet values
# Update CONTRACT_ID with new mainnet deployment
npm run build
npm start
```

**Switch Freighter to mainnet:**
1. Open Freighter
2. Click network name → select "Mainnet"
3. Reload app — transactions now go to mainnet

### Generate coverage reports

**Contract coverage:**
```bash
make coverage
open contracts/target/coverage-html/index.html
```

**Frontend coverage:**
```bash
cd frontend
npm run test:coverage
open coverage/lcov-report/index.html
```

### Profile contract performance

Use Stellar CLI benchmarking:

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  --verbose \
  -- subscribe \
  --subscriber $(stellar keys address alice) \
  --merchant GXXXXX... \
  --token CXXXXX... \
  --amount 1000000 \
  --interval 2592000
```

Look for `cpu_insns` and `mem_bytes` in verbose output to identify bottlenecks.

---

## Troubleshooting

### Build failures

#### `error: linker 'cc' not found` (macOS)
```bash
xcode-select --install
```

#### `error: linker 'cc' not found` (Linux)
```bash
sudo apt-get install -y build-essential
```

#### `error: no such file or directory: 'wasm32-unknown-unknown'`
```bash
rustup target add wasm32-unknown-unknown
```

### Test failures

#### `test result: FAILED. N passed; M failed`
Read the failure output — tests print clear assertions. Common causes:
- **Auth failure:** Test account not properly set up (check `create_test_token` helper)
- **Time-based failure:** Advance ledger timestamp with `env.ledger().set_timestamp(...)`
- **Balance failure:** Fund test account before calling `execute_payment`

#### Frontend tests fail with `MODULE_NOT_FOUND`
```bash
cd frontend
rm -rf node_modules package-lock.json
npm install
```

### Deployment failures

#### `ERROR: Contract deployment failed`
```bash
# Verify identity exists
stellar keys show alice

# Verify identity is funded
stellar keys address alice
# Visit https://stellar.expert/explorer/testnet/account/<address> to check balance

# Re-fund testnet account
stellar keys fund alice --network testnet
```

#### Empty contract ID returned
RPC node may be rate-limiting. Wait 10 seconds and retry:
```bash
sleep 10
bash deploy/deploy.sh
```

### Frontend issues

#### "Contract not configured" warning
```bash
# Verify .env.local exists and has CONTRACT_ID
cat frontend/.env.local

# If missing, add it:
echo "NEXT_PUBLIC_CONTRACT_ID=CXXXXX..." >> frontend/.env.local

# Restart dev server
npm run dev
```

#### "Wallet not connected" stays gray
1. Open Freighter extension
2. Click "Connected Sites"
3. Find `localhost:3000` → click "Connect"
4. Reload page

#### Transaction rejected — wrong network
**Symptom:** Transaction fails with "Invalid hash" or "Transaction malformed"

**Fix:** Match Freighter network to app config:
- If `.env.local` has `Test SDF Network ; September 2015` → Freighter must be on Testnet
- If `.env.local` has `Public Global Stellar Network ; September 2015` → Freighter must be on Mainnet

#### Hot reload not working
```bash
# Clear Next.js cache
rm -rf frontend/.next
npm run dev
```

### Freighter issues

See the [Freighter Setup Guide](freighter-setup.md) for comprehensive wallet troubleshooting.

---

## Next Steps

After completing this onboarding:

- **Read the contract API:** [docs/contract-api.md](contract-api.md)
- **Explore backend design:** [docs/architecture.md](architecture.md)
- **Review security model:** [docs/security.md](security.md)
- **Understand event indexing:** [docs/events.md](events.md)
- **Check FAQ:** [docs/faq.md](faq.md)

**Contributing:**
- See [CONTRIBUTING-TESTING.md](CONTRIBUTING-TESTING.md) for PR guidelines
- Check [codebase-guide.md](codebase-guide.md) for architecture overview
- Review open issues: https://github.com/Chrisland58/SorobanPay/issues

**Get help:**
- GitHub Issues: https://github.com/Chrisland58/SorobanPay/issues
- Stellar Discord: https://discord.gg/stellar (Soroban channel)
