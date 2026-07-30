# SorobanPay — Codebase Guide for New Contributors

A map of every top-level entry point: what it is, what it does, and where to look first.

---

## `contracts/`

**What it is:** The Rust/Soroban smart contract — the only on-chain component.

**What it does:**  
`contracts/subscription/src/lib.rs` implements `SubscriptionProtocol`, a Soroban contract with three public entry points:

| Entry point | Caller | Effect |
|---|---|---|
| `subscribe(subscriber, merchant, token, amount, interval)` | subscriber | Writes a `SubscriptionData` record to persistent storage with a `next_payment` timestamp and a 365-day TTL. Validates that `amount > 0` and `interval ∈ [86400, 31536000]`. Emits a `subscribe` event. |
| `execute_payment(subscriber, merchant)` | merchant | Loads the subscription, enforces the time-lock (`now >= next_payment`), checks the subscriber's balance, calls SEP-41 `transfer` (subscriber → merchant), advances `next_payment`, and emits an `executed` event. On insufficient balance, emits a `payment_transfer_failure` event instead of panicking. |
| `cancel(subscriber, merchant)` | subscriber | Removes the subscription from persistent storage and emits a `cancel` event. |

The contract is **non-custodial**: it never holds token balances. Transfers go directly between subscriber and merchant via the SEP-41 token contract.

**Supporting modules:**

| File | Purpose |
|---|---|
| `src/error.rs` | `ContractError` enum (codes 1–6, e.g. `PaymentNotDue`, `NoActiveSubscription`) |
| `src/events.rs` | Helpers that emit structured Soroban events consumed by off-chain indexers |
| `src/storage.rs` | `SubscriptionData` struct, `DataKey` enum, and TTL constants (`MIN_TTL_LEDGERS`, `MAX_TTL_LEDGERS`) |
| `src/test.rs` | Full test suite — lifecycle, error paths, auth checks, property-based invariants |

**Where to start:** `contracts/subscription/src/lib.rs` → read the three `impl` methods top to bottom. Each is heavily commented.

---

## `frontend/`

**What it is:** A Next.js 14 (App Router) TypeScript app — the user-facing interface for creating subscriptions.

**What it does:**  
Lets a subscriber connect their Freighter wallet, fill in a merchant address / token / amount / interval, review a confirmation modal, and submit an on-chain `subscribe` transaction.

**Two files own the core logic:**

### `frontend/src/components/SubscriptionForm.tsx`

The primary UI component. Responsibilities:
- Guards on `CONTRACT_ID` — renders a `ContractConfigError` card with setup instructions if the env variable is missing.
- Polls the RPC endpoint on mount and shows a `NetworkBadge` (reachable / unreachable / checking).
- Owns all form state (`merchantAddress`, `tokenAddress`, `amount`, `interval`) and validation errors.
- On submit: validates fields via `validateSubscriptionForm`, opens a `ConfirmModal`, then calls `buildAndSubmitSubscribe`.
- Shows a `ProgressBar` while the transaction is in-flight, a `SuccessCard` on confirmation, and an inline error block on failure.

### `frontend/src/lib/transaction_builder.ts`

Pure async function that handles the full Stellar transaction lifecycle:

```
getAccount()               ← fetch sequence number from RPC
TransactionBuilder.build() ← construct the subscribe call with ScVal arguments
server.prepareTransaction() ← simulate + inject resource fees
signTx()                   ← Freighter signs via wallet_manager.ts
server.sendTransaction()   ← broadcast
pollForConfirmation()      ← poll getTransaction() every 1 s, up to 60 s
```

Exports `buildAndSubmitSubscribe(params, contractId, publicKey, networkPassphrase, rpcUrl)` and returns `{ txHash }` on success.

**Other notable paths:**

| Path | Purpose |
|---|---|
| `src/lib/wallet_manager.ts` | Thin Freighter wrapper: `connectWallet`, `signTx` |
| `src/lib/validation.ts` | Field-level form validation + `DEFAULT_INTERVAL_SECONDS` |
| `src/hooks/useWallet.ts` | React hook that exposes `publicKey` and connection state |
| `src/constants/network.ts` | Reads `NEXT_PUBLIC_*` env vars; single source of truth for RPC URL, passphrase, contract ID |
| `.env.example` | Template for `.env.local` — copy and fill in `NEXT_PUBLIC_CONTRACT_ID` |

**Where to start:** `SubscriptionForm.tsx` → `confirmAndSubmit()` → `buildAndSubmitSubscribe()` in `transaction_builder.ts`.

---

## `deploy/`

**What it is:** A single Bash script that builds and deploys the contract.

**What it does:**  
`deploy/deploy.sh` runs two steps:

1. **Build** — calls `make build` and verifies the WASM artifact exists at `contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm`.
2. **Deploy** — calls `stellar contract deploy` with the correct RPC URL and network passphrase for the target network.

Controlled by two environment variables:

| Variable | Default | Values |
|---|---|---|
| `STELLAR_NETWORK` | `testnet` | `testnet`, `mainnet` |
| `STELLAR_IDENTITY` | `alice` | Any Stellar CLI identity alias |

**Contract on stdout only** — the deployed contract address is the sole line written to stdout so it can be captured directly:

```bash
CONTRACT_ID=$(bash deploy/deploy.sh)
```

All diagnostic messages go to stderr. The script exits non-zero on any failure with a descriptive error message.

**Where to start:** Read the script top to bottom — it is ~60 lines with inline comments at each step.

---

## `Makefile`

**What it is:** The top-level build interface used by both contributors and the deploy script.

**What it does:**  

| Target | Command | Effect |
|---|---|---|
| `make build` | `cargo build --manifest-path contracts/subscription/Cargo.toml --target wasm32-unknown-unknown --release` | Compiles the contract to WASM. Verifies the artifact exists afterward. |
| `make test` | `cargo test --manifest-path contracts/subscription/Cargo.toml` | Runs the contract test suite on the native host (not WASM). |
| `make clean` | `cargo clean --manifest-path contracts/subscription/Cargo.toml` | Removes `contracts/target/`. |
| `make test-frontend` | `cd frontend && npm run test` | Runs the frontend Jest suite. |

Two variables can be overridden at the command line:

```bash
make build TARGET_TRIPLE=wasm32-unknown-unknown PROFILE=release   # defaults
make build TARGET_TRIPLE=x86_64-unknown-linux-gnu PROFILE=debug   # native debug build
```

> **Note:** `make test` always uses the native host. Do not set `TARGET_TRIPLE` for testing — the Rust test runner cannot execute WASM binaries.

**Where to start:** Run `make build && make test` after cloning. If either fails, the error message tells you exactly what is missing.

---

## Quick orientation for common tasks

| Task | Where to go |
|---|---|
| Add a new contract entry point | `contracts/subscription/src/lib.rs` + `src/events.rs` for any new event |
| Change validation rules (e.g. min interval) | `contracts/subscription/src/lib.rs` (contract) **and** `frontend/src/lib/validation.ts` (frontend) — keep them in sync |
| Add a new frontend page or form | `frontend/src/` — follow Next.js App Router conventions |
| Change how transactions are built or signed | `frontend/src/lib/transaction_builder.ts` |
| Deploy to mainnet | `STELLAR_NETWORK=mainnet STELLAR_IDENTITY=<id> bash deploy/deploy.sh` |
| Add a new Makefile target | Add a `.PHONY` entry and recipe to `Makefile` |
