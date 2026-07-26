# SorobanPay — Decentralized Subscription & Recurring Payments Protocol

A production-grade, non-custodial recurring payments protocol built on Stellar's Soroban smart contract platform. Enables SaaS billing, creator subscriptions, and recurring donations directly on-chain — no custodial wallets, no pre-authorized transaction arrays.

---

## Architecture

```
SorobanPay
├── contracts/subscription/   Rust/Soroban smart contract
├── deploy/deploy.sh          Automated testnet/mainnet deployment
├── frontend/                 Next.js 14 TypeScript frontend
└── Makefile                  Build, test, and clean targets
```

**Three layers:**
1. **Smart Contract** — `SubscriptionProtocol` Soroban contract with `subscribe`, `execute_payment`, and `cancel` entry points. Uses persistent storage with TTL management and emits structured events for off-chain indexing.
2. **Frontend** — Next.js 14 App Router + Freighter wallet integration + Tailwind CSS.
3. **Build & Deploy** — GNU Makefile + bash deployment script with testnet/mainnet switching.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust | stable | https://rustup.rs |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 21.x | https://developers.stellar.org/docs/tools/stellar-cli |
| Node.js | ≥ 18.x | https://nodejs.org |
| Freighter browser extension | latest | https://www.freighter.app |

---

## Smart Contract

### Build

```bash
make build
```

Compiles the Rust contract to `contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm` using the `--release` profile (`opt-level = "z"`, `lto = true`).

### Test

```bash
make test
```

Runs the full test suite: unit tests (lifecycle, error paths, auth, events) and property-based tests (time-lock, double-payment prevention, balance invariant, and more).

### Clean

```bash
make clean
```

Removes all build artifacts from `contracts/target/`.

---

## Deployment

### Setup identity

```bash
# Create a Stellar identity (one-time)
stellar keys generate alice --network testnet

# Fund it on testnet
stellar keys fund alice --network testnet
```

### Deploy to testnet (default)

```bash
bash deploy/deploy.sh
```

The contract address is printed to stdout on success. All diagnostic output goes to stderr.

### Deploy to mainnet

```bash
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=your-identity bash deploy/deploy.sh
```

### Environment variables for deploy.sh

| Variable | Default | Description |
|----------|---------|-------------|
| `STELLAR_NETWORK` | `testnet` | `testnet` or `mainnet` |
| `STELLAR_IDENTITY` | `alice` | Stellar CLI identity alias |

---

## Frontend

### Environment variables

Create `frontend/.env.local` (copy from `frontend/.env.example`):

```env
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

Replace `NEXT_PUBLIC_CONTRACT_ID` with the address output by `deploy.sh`.

### Install and run

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 in a browser with Freighter installed.

### Build for production

```bash
cd frontend
npm run build
npm start
```

### Type check

```bash
cd frontend
npm run type-check
```

---

## Contract entry points

| Function | Auth required | Description |
|----------|--------------|-------------|
| `subscribe(subscriber, merchant, token, amount, interval)` | subscriber | Create or update subscription. Amount must be > 0, interval in [86400, 31536000] seconds. |
| `execute_payment(subscriber, merchant)` | merchant | Collect payment if interval has elapsed. Transfers tokens directly subscriber → merchant. |
| `cancel(subscriber, merchant)` | subscriber | Remove subscription from persistent storage. |

### Events emitted

| Event | Topics | Data |
|-------|--------|------|
| `subscribe` | `(symbol("subscribe"), subscriber, merchant)` | `amount: i128` |
| `executed` | `(symbol("executed"), subscriber, merchant)` | `amount: i128` |

---

## Error codes

| Code | Name | Trigger |
|------|------|---------|
| 1 | `AmountMustBePositive` | `amount ≤ 0` in `subscribe` |
| 2 | `IntervalTooShort` | `interval < 86400` in `subscribe` |
| 3 | `IntervalTooLong` | `interval > 31536000` in `subscribe` |
| 4 | `NoActiveSubscription` | No subscription found for `(subscriber, merchant)` pair |
| 5 | `PaymentNotDue` | `now < next_payment` in `execute_payment` |
| 6 | `Unauthorized` | Authorization check failed |

---

## Security model

- **Non-custodial**: The contract never holds token balances. Transfers go directly `subscriber → merchant` via SEP-41 `transfer`.
- **Per-invocation auth**: Every entry point requires a fresh `require_auth()` signature — no stored sessions.
- **Allowance model**: Subscribers grant a SEP-41 allowance to the contract. Revoking allowance via `token.approve(contract_id, 0)` prevents future payments regardless of on-chain subscription state.
- **Time-lock**: Payment cannot be collected before `next_payment` — enforced on-chain by the Soroban ledger timestamp.
- **TTL**: Subscriptions have a ~30-day minimum and ~365-day maximum TTL. Each successful payment resets the 365-day clock.

---

## Documentation

| Guide | Description |
|---|---|
| [Storage TTL Management](docs/operations.md) | Detecting at-risk entries, extending TTL programmatically, alert thresholds |
| [Network Configuration](docs/networks.md) | Testnet vs. mainnet side-by-side, common mistakes, switching guide |
| [Backend API Cookbook](docs/api-cookbook.md) | 8 recipes: auth, subscriptions, webhooks, CSV export, MRR, TTL health |
| [Changelog](CHANGELOG.md) | Version history following Keep a Changelog format |

---

## License

MIT
