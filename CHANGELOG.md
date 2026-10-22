# Changelog

All notable changes to SorobanPay are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

For the full release process — including the release note template, versioning
rules, and step-by-step checklist — see [docs/release-process.md](docs/release-process.md).

---

## [Unreleased]

> Add your changes here before cutting a release.
> Every pull request that changes behaviour, adds a feature, or fixes a bug
> **must** include an entry in this section. The CI `check-changelog` job will
> fail if this section is empty on a pull request.
>
> Entry format:
> `- **[Component]** Short imperative description. (Closes #<issue>)`
>
> Components: `[Contract]`, `[Frontend]`, `[Backend]`, `[Deploy]`, `[Docs]`, `[CI]`

### Added

- **[Docs]** Document all `deploy/deploy.sh` environment variables (`STELLAR_NETWORK`, `STELLAR_IDENTITY`) and derived values (`RPC_URL`, `PASSPHRASE`) in the script header and `docs/deployment.md`. (Closes #77)
- **[Docs]** Add issue naming conventions (`Bug:`, `Feature:`, `Docs:`, `Chore:` prefixes) to `CONTRIBUTING.md`. (Closes #78)
- **[Docs]** Expand README security model section with full sub-sections: non-custodial design, per-invocation auth table, allowance emergency stop, time-lock enforcement, storage TTL, input validation, and read-only backend. (Closes #79)
- **[Docs]** Add `docs/release-process.md` with versioning rules, changelog hygiene guide, release note template, step-by-step release checklist, and component-specific notes for contract, frontend, and deploy releases. (Closes #80)

### Changed

### Deprecated

### Removed

### Fixed

### Security

---

## [1.0.0] — 2026-07-26

Initial public release of SorobanPay — a non-custodial recurring payments
protocol on Stellar's Soroban smart contract platform.

### Added

#### Smart Contract (`contracts/subscription/`)

- **`subscribe(subscriber, merchant, token, amount, interval)`** — creates or
  updates a recurring payment subscription. Validates amount > 0 and interval
  within `[86400, 31536000]` seconds. Requires `subscriber` authorization.
- **`execute_payment(subscriber, merchant)`** — collects the next payment when
  the payment interval has elapsed. Transfers tokens directly
  `subscriber → merchant` via SEP-41 `transfer`. Requires `merchant`
  authorization. Advances `next_payment` by `interval` on success.
- **`cancel(subscriber, merchant)`** — removes a subscription from persistent
  storage. Requires `subscriber` authorization.
- **Structured events** — `subscribe` event (topics: `subscriber`, `merchant`;
  data: `amount`) and `executed` event (topics: `subscriber`, `merchant`; data:
  `amount`) emitted after each successful operation for off-chain indexing.
- **TTL management** — every write extends storage TTL to
  `MAX_TTL_LEDGERS` (~365 days) if currently below `MIN_TTL_LEDGERS` (~30 days).
  Constants defined in `contracts/subscription/src/storage.rs`.
- **Error codes** — six typed `ContractError` variants:
  `AmountMustBePositive` (1), `IntervalTooShort` (2), `IntervalTooLong` (3),
  `NoActiveSubscription` (4), `PaymentNotDue` (5), `Unauthorized` (6).
- **Non-custodial design** — the contract never holds token balances; all
  transfers go directly between subscriber and merchant wallets.
- **Per-invocation auth** — every entry point calls `require_auth()`;
  no stored sessions or delegated authority.

#### Frontend (`frontend/`)

- **Next.js 14 App Router** — server-component layout with Tailwind CSS styling.
- **Freighter wallet integration** — `WalletContext` provider manages connection
  state, account address, and network passphrase via `@stellar/freighter-api`.
- **`SubscriptionForm` component** — full subscribe/cancel UI with client-side
  validation (amount, interval, token address), transaction building, Freighter
  signing, and Soroban RPC submission.
- **Transaction builder** (`frontend/src/lib/transaction_builder.ts`) —
  constructs and simulates Soroban contract invocations using
  `@stellar/stellar-sdk`.
- **Wallet manager** (`frontend/src/lib/wallet_manager.ts`) — abstracts
  Freighter connection, disconnect, and network verification.
- **Form validation** (`frontend/src/lib/validation.ts`) — validates all
  subscription fields with human-readable error messages.
- **Network constants** (`frontend/src/constants/network.ts`) — `RPC_URL`,
  `NETWORK_PASSPHRASE`, and `CONTRACT_ID` read from environment variables.
- **Environment template** (`frontend/.env.example`) — documents all required
  `NEXT_PUBLIC_*` variables.

#### Build & Deploy (`Makefile`, `deploy/deploy.sh`)

- **`make build`** — compiles the Rust contract to
  `wasm32-unknown-unknown/release` with `opt-level = "z"` and `lto = true`.
- **`make test`** — runs the full test suite (unit + property-based tests).
- **`make clean`** — removes all build artifacts.
- **`deploy/deploy.sh`** — automated deployment script supporting both
  `STELLAR_NETWORK=testnet` (default) and `STELLAR_NETWORK=mainnet`. Outputs
  the deployed contract address to stdout; all diagnostics to stderr.
- **Identity management** — `STELLAR_IDENTITY` variable selects the Stellar CLI
  identity used for signing the deploy transaction.

#### Documentation (`docs/`)

- **[Storage TTL Management Guide](docs/operations.md)** — TTL concepts,
  at-risk detection scripts (`check-ttl.mjs`, `batch-ttl-scan.mjs`,
  `refresh-ttl.mjs`), backend health check, edge cases, and alert threshold
  justification. Addresses issue DOC-89.
- **[Backend API Integration Cookbook](docs/api-cookbook.md)** — eight
  practical recipes for authenticating (SEP-10), listing subscriptions, querying
  payment history, setting up webhooks with HMAC verification, handling payment
  failure retries, exporting to CSV, calculating MRR, and monitoring TTL health.
  Addresses issue DOC-90.
- **[Network Configuration Guide](docs/networks.md)** — testnet vs. mainnet
  side-by-side table, environment variable checklist, five common mistakes,
  step-by-step network switching guide, and contract address management.
  Addresses issue DOC-88.
- **CHANGELOG.md** (this file) — initial changelog following Keep a Changelog
  format. Addresses issue DOC-87.

#### Testing (`contracts/subscription/src/test.rs`)

- **Lifecycle tests** — full subscribe → execute_payment → cancel flow.
- **Error path tests** — all six `ContractError` variants covered.
- **Authorization tests** — verifies unauthorized callers are rejected.
- **Event tests** — asserts correct event topics and data on each operation.
- **Property-based tests** — time-lock invariant (payment not collectable before
  `next_payment`), double-payment prevention, balance invariant, and boundary
  values for `amount` and `interval`.

---

[Unreleased]: https://github.com/Chrisland58/SorobanPay/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Chrisland58/SorobanPay/releases/tag/v1.0.0
