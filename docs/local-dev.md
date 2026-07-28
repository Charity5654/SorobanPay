# Local Development Guide

Everything you need to run the contract tests, build the WASM, start the
frontend, and connect Freighter — all from a clean checkout.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust (stable) | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 21.x | `cargo install --locked stellar-cli --features opt` |
| Node.js | ≥ 18.x | https://nodejs.org |
| Freighter extension | latest | https://www.freighter.app |

---

## 1. Run the contract tests

Tests live in `contracts/subscription/src/` and exercise the full lifecycle
(`subscribe`, `execute_payment`, `cancel`), error paths, auth guards, event
emissions, and property-based invariants.

```bash
make test
```

This runs:

```bash
cargo test --manifest-path contracts/subscription/Cargo.toml
```

The test binary is compiled for the **native host** (not WASM). Do **not** set
`TARGET_TRIPLE` when running tests — the Rust test harness cannot execute
inside a WASM target.

Expected output on success:

```
running N tests
test ... ok
...
test result: ok. N passed; 0 failed
```

To run a single test by name:

```bash
cargo test --manifest-path contracts/subscription/Cargo.toml <test_name>
```

---

## 2. Build the WASM

```bash
make build
```

This compiles the contract to:

```
contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm
```

The Cargo profile uses `opt-level = "z"` and `lto = true` for minimum size.

**Override target or profile:**

```bash
make build TARGET_TRIPLE=wasm32-unknown-unknown PROFILE=release
```

**Clean artifacts:**

```bash
make clean
```

---

## 3. Start the frontend

### 3a. Deploy the contract (one-time per environment)

The frontend requires a live contract address.

```bash
# Create a testnet identity (one-time)
stellar keys generate alice --network testnet

# Fund it via Friendbot (testnet only — free)
stellar keys fund alice --network testnet

# Deploy and capture the contract address
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Contract: $CONTRACT_ID"
```

### 3b. Configure environment variables

```bash
cp frontend/.env.example frontend/.env.local
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ID=<paste CONTRACT_ID here>
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

All three variables are required. The dev server will show a
`ContractConfigError` card if `NEXT_PUBLIC_CONTRACT_ID` is missing or empty.

### 3c. Install dependencies and run

```bash
cd frontend
npm install
npm run dev
```

The app is now running at **http://localhost:3000**.

**Other useful commands:**

```bash
npm run build        # Production build
npm start            # Serve production build
npm run type-check   # TypeScript type check (no emit)
```

---

## 4. Connect Freighter

1. **Install** the Freighter browser extension from
   https://www.freighter.app (Chrome/Brave or Firefox).

2. **Open Freighter** and create or import a wallet.

3. **Switch to Testnet**: click the network name in the top-right of the
   Freighter popup → select **Testnet**.

4. **Fund your wallet** on testnet via
   [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test).

5. **Open http://localhost:3000** — Freighter will prompt for a site
   connection on the first interaction. Approve it.

6. The **Connected** green badge appears in the `SubscriptionForm` header
   once Freighter grants the connection.

### Freighter must match the app's network

The `NEXT_PUBLIC_NETWORK_PASSPHRASE` in `.env.local` must match the network
selected in Freighter, or all transactions will be rejected.

| `.env.local` passphrase | Freighter network to select |
|-------------------------|-----------------------------|
| `Test SDF Network ; September 2015` | Testnet |
| `Public Global Stellar Network ; September 2015` | Mainnet |

### Common Freighter issues

| Symptom | Fix |
|---------|-----|
| "Wallet not connected" badge stays gray | Open Freighter → approve the `localhost` connection, then reload |
| Signing popup never appears | Confirm the app is on `http://localhost` (not `file://`); disable conflicting wallet extensions |
| Transaction rejected — wrong network | Switch Freighter to the network that matches `NEXT_PUBLIC_NETWORK_PASSPHRASE` |
| "Insufficient balance" | Fund via Friendbot (testnet) or send XLM (mainnet) |
| Popup closes before you can sign | Disable browser pop-up blockers for `localhost` |

---

## Quick reference

```bash
# 1. Test the contract
make test

# 2. Build the WASM
make build

# 3. Deploy to testnet + start the frontend
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID" >> frontend/.env.local
cd frontend && npm install && npm run dev
```

Open http://localhost:3000, connect Freighter (set to Testnet), and you are
ready to create subscriptions on-chain.
