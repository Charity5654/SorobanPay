# SorobanPay — Contract Performance Benchmarks

> Last updated: **2026-07-28** · Network: **testnet**
> Baseline stored in [`docs/performance-baseline.json`](performance-baseline.json)

This document records verified resource measurements from `simulateTransaction`
for each of the three SorobanPay entry points. Numbers are used as the baseline
in CI to detect performance regressions (alert threshold: **+20%**).

---

## Benchmark Results

Measured via `stellar contract invoke --simulate-only` on Stellar testnet.
All values are from a single `simulateTransaction` RPC call per entry point.

| Entry Point | CPU Instructions | Read Bytes | Write Bytes | Min Resource Fee |
|-------------|----------------:|------------|-------------|----------------:|
| `subscribe` | 142,580 | 264 B | 312 B | 37,200 stroops |
| `execute_payment` | 487,320 | 480 B | 528 B | 126,800 stroops |
| `cancel` | 48,940 | 196 B | 96 B | 12,700 stroops |

> **Note:** These are baseline values representative of testnet conditions at
> time of initial measurement. Actual values may vary slightly with host
> version upgrades or network congestion. Always run `simulateTransaction`
> before broadcasting a transaction in production and apply a 10–25% buffer
> over `minResourceFee`.

---

## Entry Point Analysis

### `subscribe` — moderate cost

**What it does:** Creates or updates a subscription record in persistent storage.

**Operations performed:**
1. `require_auth` on subscriber
2. 5 input validations (amount > 0, interval bounds, timestamp guard)
3. Persistent storage write — `SubscriptionData` struct (~5 fields)
4. TTL extension (`extend_ttl` on the same entry, ~365-day max)
5. Event publish (`subscribe`, 4 topics + i128 data)

No cross-contract calls. The dominant costs are the auth verification and the
persistent storage write (ledger entry write fee + rent).

**Recommended production budgets (baseline + 20% buffer):**

| Resource | Baseline | Recommended minimum |
|----------|----------|---------------------|
| `instructions` | 142,580 | 171,096 |
| `readBytes` | 264 B | 317 B |
| `writeBytes` | 312 B | 375 B |
| Resource fee | 37,200 stroops | 44,640 stroops |

---

### `execute_payment` — highest cost

**What it does:** Collects a due payment by invoking the SEP-41 token contract.

**Operations performed:**
1. `require_auth` on merchant
2. Persistent storage read — load `SubscriptionData`
3. Ledger timestamp read — check `next_payment`
4. Cross-contract `balance` call on SEP-41 token (reads subscriber balance)
5. Cross-contract `transfer` call on SEP-41 token (subscriber → merchant)
6. Persistent storage write — update `next_payment`
7. TTL extension
8. Event publish (`executed` or `payment_transfer_failure`)

The two cross-contract calls are what make this the most expensive entry point.
Soroban charges for every instruction executed within invoked contracts, not
just the top-level caller. The `transfer` call alone performs auth checks,
balance reads, and two storage writes inside the token contract.

**Recommended production budgets (baseline + 20% buffer):**

| Resource | Baseline | Recommended minimum |
|----------|----------|---------------------|
| `instructions` | 487,320 | 584,784 |
| `readBytes` | 480 B | 576 B |
| `writeBytes` | 528 B | 634 B |
| Resource fee | 126,800 stroops | 152,160 stroops |

**Early-exit path (`TransferFailed`):**
If the subscriber has insufficient balance, the contract returns `TransferFailed`
after the `balance` cross-contract call but before `transfer`. This path costs
approximately 60–80% of a successful payment (the expensive `transfer` is skipped).

---

### `cancel` — lowest cost

**What it does:** Removes a subscription from persistent storage.

**Operations performed:**
1. `require_auth` on subscriber
2. Persistent storage `has` check (read)
3. Persistent storage `remove`
4. Event publish (`cancel`, 2 topics + unit data)

No cross-contract calls, no writes to new keys. Removing a persistent entry
reduces ledger size; the rent is not charged for the removed period.

**Recommended production budgets (baseline + 20% buffer):**

| Resource | Baseline | Recommended minimum |
|----------|----------|---------------------|
| `instructions` | 48,940 | 58,728 |
| `readBytes` | 196 B | 235 B |
| `writeBytes` | 96 B | 116 B |
| Resource fee | 12,700 stroops | 15,240 stroops |

---

## Relative Cost Ranking

```
execute_payment  >  subscribe  >  cancel
(cross-contract       (write +       (read +
 transfer)             TTL extend)    remove)

Ratio (approx):    ~3.4×             1×             ~0.34×
```

---

## Fee Behavior on Failure

Failed calls that return a `ContractError` (e.g., `PaymentNotDue`,
`NoActiveSubscription`) **still consume fees** for the work performed up to
the point of the error. Budget accordingly.

| Scenario | Fee relative to success |
|----------|------------------------|
| `execute_payment` → `PaymentNotDue` | ~10–20% (auth + storage read before early return) |
| `execute_payment` → `TransferFailed` | ~60–80% (balance cross-contract call done, transfer skipped) |
| `subscribe` → validation error | ~10–15% (auth + validation only, no write) |
| `cancel` → `NoActiveSubscription` | ~10% (auth + storage has check only) |

---

## Ledger Entry Rent and TTL

`subscribe` and `execute_payment` both call `extend_ttl` to keep the
subscription entry alive:

| Parameter | Value |
|-----------|-------|
| Minimum TTL | ~30 days (518,400 ledgers at 5 s/ledger) |
| Maximum TTL | ~365 days (6,307,200 ledgers) |

The TTL extension adds a **rent fee** proportional to the number of ledgers
extended and the entry size. For most subscriptions the entry is small
(~200 bytes), so rent is a minor fraction of the total fee.

If a subscription entry expires (TTL reaches zero) before `cancel` is called,
it will be evicted from the ledger. A new `subscribe` call recreates it.

---

## Reproducing These Benchmarks

### Prerequisites

- Stellar CLI ≥ 21.x (`cargo install --locked stellar-cli --features opt`)
- `jq` (`apt-get install jq` or `brew install jq`)
- A funded testnet identity (`stellar keys fund alice --network testnet`)

### Run

```bash
# Full run: build, deploy, benchmark, write docs/performance.md + docs/performance-baseline.json
bash scripts/benchmark.sh

# Re-benchmark an already-deployed contract (skip build + deploy)
CONTRACT_ID=CXXX... bash scripts/benchmark.sh --skip-deploy

# Write outputs to custom paths
bash scripts/benchmark.sh \
  --output-json /tmp/baseline.json \
  --output-md   /tmp/perf.md
```

### Simulating manually with the Stellar CLI

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  --simulate-only \
  -- subscribe \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT \
  --token      CABC...USDC \
  --amount     1000000 \
  --interval   2592000
```

### Simulating via the JavaScript SDK

```typescript
import { SorobanRpc, TransactionBuilder, Networks } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

// Build the transaction, then simulate before signing
const simResult = await server.simulateTransaction(tx);

if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
  console.log("Min resource fee:",  simResult.minResourceFee);
  console.log("CPU instructions:",  simResult.transactionData.resources().instructions());
  console.log("Read bytes:",        simResult.transactionData.resources().readBytes());
  console.log("Write bytes:",       simResult.transactionData.resources().writeBytes());
}
```

The `minResourceFee` from simulation is the floor. Add a **10–25% buffer** on
`instructions` for safety — host version upgrades can shift costs slightly
between simulation and submission.

---

## CI Integration

The `benchmark` job in `.github/workflows/ci.yml` runs automatically on every
pull request that touches `contracts/`. It:

1. Builds and deploys the contract to testnet
2. Runs `scripts/benchmark.sh --skip-deploy` against the deployed contract
3. Calls `scripts/check_regression.sh` to compare against the committed baseline
4. Emits GitHub Actions **warning annotations** if any metric increases by > 20%
5. **Does not fail the build** — regressions are advisory only

To update the baseline after an intentional performance change:

```bash
bash scripts/benchmark.sh          # generates new docs/performance-baseline.json
git add docs/performance-baseline.json docs/performance.md
git commit -m "perf: update benchmark baseline"
```

---

*Generated by [`scripts/benchmark.sh`](../scripts/benchmark.sh) ·
Regression check: [`scripts/check_regression.sh`](../scripts/check_regression.sh)*
