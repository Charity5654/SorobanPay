# Deployment Guide

This document covers production deployment of a platform built on SorobanPay.

## Pre-launch checklist

Before going live on Stellar **Mainnet**, complete every item in this checklist.

### Smart contract

- [ ] Run `make build` and verify the WASM compiles without errors.
- [ ] Run `make test` — all contract unit tests must pass.
- [ ] Run `make coverage` — line coverage must be ≥ 95% (enforced by CI).
- [ ] Run `bash scripts/integration-test.sh` — full subscribe → execute → cancel lifecycle must pass.
- [ ] Deploy to **Testnet** first and exercise the full user flow manually.
- [ ] Capture the deployed contract address and set it in `frontend/.env.local` as `NEXT_PUBLIC_CONTRACT_ID`.

### Frontend

- [ ] Run `npm run test:ci` in `frontend/` — all tests must pass, coverage must be ≥ 80%.
- [ ] Run `npm run type-check` — no TypeScript errors.
- [ ] Run `npm run build` — Next.js production build must succeed.
- [ ] Set all three environment variables in production:
  - `NEXT_PUBLIC_CONTRACT_ID`
  - `NEXT_PUBLIC_RPC_URL` (use a reliable mainnet RPC endpoint)
  - `NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015`
- [ ] Verify Freighter connects and a test subscription can be signed on Mainnet.

### Security

- [ ] Review [docs/security.md](./security.md) — ensure all secrets are managed correctly.
- [ ] Ensure `NEXT_PUBLIC_` variables do NOT contain private keys or secrets.
- [ ] Rotate any testnet keys before mainnet deployment.

### Legal & compliance

> These two documents are **templates only** — not legal advice.
> Consult a qualified lawyer before publishing.

- [ ] Customise and publish a **Privacy Policy** for your platform.
  Template: [docs/templates/privacy-policy.md](./templates/privacy-policy.md)
- [ ] Customise and publish **Terms of Service** for your platform.
  Template: [docs/templates/terms-of-service.md](./templates/terms-of-service.md)
- [ ] Fill in all `[PLACEHOLDER]` sections in both documents.
- [ ] Have both documents reviewed by legal counsel.
- [ ] Link both documents from your product's footer or onboarding flow.
- [ ] Confirm your data retention schedule matches the Privacy Policy
  (see BE-71 backend implementation).

### Monitoring

- [ ] Set up Codecov coverage badges (see README for badge links).
- [ ] Configure alerts for RPC endpoint availability.
- [ ] Set up error tracking (e.g. Sentry) for the frontend.

---

## Deploying the contract

See [README.md → Deployment](../README.md#deployment) for full instructions.

```bash
# Testnet
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Contract: $CONTRACT_ID"

# Mainnet
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh
```

## Environment variables reference

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CONTRACT_ID` | ✅ | Deployed contract address (`C…`) |
| `NEXT_PUBLIC_RPC_URL` | ✅ | Soroban RPC endpoint |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ | Must match Freighter network |

---

## Migration and rollback policy

Soroban contracts are **immutable once deployed**: you cannot update the code of a live contract
address. Every breaking change requires deploying a new contract and migrating subscribers to it.
This section describes how to evolve the protocol safely using the **expand-contract** (aka
parallel-deploy) migration pattern.

### The expand-contract pattern

The expand-contract pattern avoids big-bang cutover by keeping both contract versions live
simultaneously for a transition window:

```
Phase 1 — Expand
  Deploy v2 alongside v1.
  New subscribers are directed to v2.
  Existing v1 subscribers continue paying on v1.

Phase 2 — Migrate
  Off-chain service (or merchant) calls subscribe() on v2 for each existing subscriber
  and calls cancel() on v1 after each successful migration.

Phase 3 — Contract
  Once v1 has zero active subscriptions (verified via getEvents + state queries),
  stop routing to v1. Revoke or archive the v1 contract address.
```

This ensures no subscriber experiences a missed payment during the transition and no funds
are ever held by the contract at any point (the protocol is non-custodial by design).

### Deploy order

Follow this sequence for every upgrade:

1. **Build and test the new WASM locally.**

   ```bash
   make build
   make test
   ```

   Expected output: `test result: ok. N passed; 0 failed` from `cargo test`.

2. **Deploy v2 to testnet and smoke-test the full lifecycle.**

   ```bash
   stellar keys generate alice --network testnet
   stellar keys fund alice --network testnet
   V2_CONTRACT_ID=$(bash deploy/deploy.sh)
   echo "v2 testnet contract: $V2_CONTRACT_ID"
   bash deploy/smoke_test.sh "$V2_CONTRACT_ID" testnet
   ```

   Expected output: `smoke_test PASSED` printed by the script.

3. **Deploy v2 to mainnet** (requires a funded identity; no Friendbot on mainnet).

   ```bash
   # Capture the new address — do not proceed if this is empty
   V2_CONTRACT_ID=$(STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh)
   [[ -z "$V2_CONTRACT_ID" ]] && { echo "ERROR: deployment failed"; exit 1; }
   echo "v2 mainnet contract: $V2_CONTRACT_ID"
   ```

4. **Update `NEXT_PUBLIC_CONTRACT_ID`** in all frontend environments to point at v2.

   > Do this **before** directing new subscribers to v2 so the UI is consistent.
   > Restart or redeploy the frontend after changing the environment variable.

5. **Migrate existing v1 subscribers** using your off-chain tooling (see below).

6. **Decommission v1** once the subscriber count drops to zero (see Verification below).

### Schema migration with `migrate()`

The contract exposes an on-chain `migrate(admin)` entry point that advances the stored
`schema_version` from the old value to `CURRENT_SCHEMA_VERSION`. This is **not** a code
upgrade — it is a data migration gate that signals off-chain tooling that the deployment
is ready to serve the new schema.

```bash
# Call migrate() on the newly deployed contract to initialise the schema version
stellar contract invoke \
  --id "$V2_CONTRACT_ID" \
  --source my-mainnet-id \
  --network mainnet \
  -- migrate \
  --admin "$(stellar keys address my-mainnet-id)"
```

Expected result: transaction succeeds and the `contract_migrated` event is emitted with
`new_version = 1` (or the current `CURRENT_SCHEMA_VERSION` from `storage.rs`).

Failure case — `AlreadyMigrated` (error 15): the contract was already at the current version.
This is safe to ignore; it means `migrate()` was called a second time accidentally.

### Off-chain subscriber migration

For each active v1 subscription discovered via `getEvents()`:

```bash
# 1. Verify the v1 subscription is still active
stellar contract invoke \
  --id "$V1_CONTRACT_ID" \
  --source my-mainnet-id \
  --network mainnet \
  -- get_subscription \
  --subscriber "$SUBSCRIBER_ADDRESS" \
  --merchant   "$MERCHANT_ADDRESS"

# 2. Create the equivalent subscription on v2 (merchant must sign)
stellar contract invoke \
  --id "$V2_CONTRACT_ID" \
  --source my-mainnet-id \
  --network mainnet \
  -- subscribe \
  --subscriber "$SUBSCRIBER_ADDRESS" \
  --merchant   "$MERCHANT_ADDRESS" \
  --token      "$TOKEN_ADDRESS" \
  --amount     "$AMOUNT" \
  --interval   "$INTERVAL"

# 3. Cancel the v1 subscription (subscriber must sign; coordinate off-chain)
stellar contract invoke \
  --id "$V1_CONTRACT_ID" \
  --source subscriber-key \
  --network mainnet \
  -- cancel \
  --subscriber "$SUBSCRIBER_ADDRESS" \
  --merchant   "$MERCHANT_ADDRESS"
```

> **Important:** The subscriber must re-approve the v2 contract address as a SEP-41
> spender before the first v2 payment is collected. Notify subscribers of the new
> contract address and ask them to call `token.approve(v2_contract_id, amount, expiry)`
> before their next billing date.

### Backups before migration

Soroban persistent storage does not have a native snapshot or backup API.  Before migrating:

1. **Export current state via `getEvents()`.**  Poll all `subscribe` and `cancel` events
   from the v1 contract and reconstruct the full subscriber list.  Store in a database or
   flat file with timestamps and amounts.

   ```bash
   # Example: fetch all subscribe events for a contract (adapt pagination as needed)
   stellar events \
     --network mainnet \
     --contract-id "$V1_CONTRACT_ID" \
     --topic "subscribe" \
     --start-ledger 0
   ```

2. **Snapshot `get_subscription()` for each known subscriber pair.**  For each
   `(subscriber, merchant)` pair from the event log, call `get_subscription` and record
   the full `SubscriptionData` (token, amount, interval, next_payment) off-chain before
   any migration step touches v1.

3. **Store the snapshot in a durable location** (e.g. S3 bucket, database backup) with the
   ledger sequence number at which it was taken.  Label it with the contract version and
   timestamp so it can be retrieved during a rollback.

### Rollback procedure

Because Soroban contracts are immutable, "rollback" means **reverting traffic to the old
contract**, not undoing an on-chain code change.

#### Rollback decision criteria

Initiate a rollback if any of the following occur after v2 deployment:

- `smoke_test.sh` fails on mainnet within the first 30 minutes.
- An on-chain `payment_transfer_failure` event rate exceeds 5% of `execute_payment` calls
  for a 15-minute window (measured by the backend indexer).
- A critical bug is confirmed in v2 contract logic within the first 48 hours.
- The `contract_migrated` event is not observed within 10 minutes of calling `migrate()`.

#### Rollback steps

1. **Revert `NEXT_PUBLIC_CONTRACT_ID`** in the frontend to the v1 address and redeploy the
   frontend.  New subscribers will be routed to v1 again.

2. **Pause or reverse any in-progress subscriber migrations.**  For any subscriber already
   migrated to v2, re-create their subscription on v1 and cancel on v2.  Use the pre-migration
   snapshot (see Backups) to reconstruct parameters.

3. **Do not call `cancel()` on any remaining v1 subscriptions** until v2 is confirmed stable
   in a future deployment attempt.

4. **Investigate v2** on testnet using the failure details.  Fix the bug, re-run
   `make test` and the smoke test, and start the migration process again from step 1.

#### Recovery from partial migration failure

If the migration process stops partway (e.g., the off-chain migrator crashes mid-run):

- Some subscribers will be on v1, some on v2.
- The frontend may already be pointing at v2.

Recovery path:

```
1. Determine the migration cursor (last successfully migrated subscriber from logs).
2. Subscribers BEFORE the cursor → on v2 only; do not re-migrate.
3. Subscribers AFTER the cursor  → still on v1; continue migration from the cursor.
4. If rolling back: cancel all v2 subscriptions created during this run
   using the snapshot and re-point frontend to v1.
```

Always log the migration cursor durably (database row or append-only file) so you can
resume or reverse precisely without guessing.

### Verification after migration

After the migration window closes, confirm the old contract is empty:

```bash
# Query the number of active subscriptions on v1 via events
# If all cancel events balance all subscribe events, v1 is clear.
stellar events \
  --network mainnet \
  --contract-id "$V1_CONTRACT_ID" \
  --topic "subscribe"

stellar events \
  --network mainnet \
  --contract-id "$V1_CONTRACT_ID" \
  --topic "cancel"
```

Expected result: the count of `cancel` events equals the count of `subscribe` events,
indicating every subscription was either cancelled or allowed to expire.

### Partial failure scenarios

| Scenario | Impact | Recovery |
|----------|--------|----------|
| `deploy.sh` exits non-zero | v2 not deployed; v1 still live | Re-run after fixing the root cause (network, identity, insufficient XLM) |
| `migrate()` returns `AlreadyMigrated` (error 15) | Benign; schema was already current | Ignore; continue with subscriber migration |
| `migrate()` returns `NotInitialized` (error 17) | `initialize()` was not called | Call `initialize(admin)` first, then retry `migrate()` |
| `migrate()` returns `NotAdmin` (error 16) | Wrong identity used | Re-run with the correct `STELLAR_IDENTITY` |
| Frontend shows "Contract not configured" | `NEXT_PUBLIC_CONTRACT_ID` not updated | Set the env var to v2 address and restart |
| Subscriber has insufficient allowance on v2 | First v2 `execute_payment` returns `TransferFailed` (error 7) | Notify subscriber to re-approve the v2 contract address |
| Subscriber has insufficient balance on v2 | `execute_payment` returns `TransferFailed` (error 7) | The subscription remains active; retry after subscriber funds their account |
| Off-chain migrator crashes mid-run | Split state — some subscribers on v1, some on v2 | Resume from the last logged cursor or roll back using the pre-migration snapshot |
| v1 subscription entry has expired (TTL elapsed) | `get_subscription` returns `None` | The entry was garbage-collected; re-subscribe on v2 using off-chain snapshot data |

### Key rotation before mainnet

Testnet keys must never be used on mainnet.  Generate a fresh mainnet identity and fund it
with real XLM before running any mainnet deployment:

```bash
# Generate mainnet identity (one-time)
stellar keys generate my-mainnet-id --network mainnet

# Display the public key — send real XLM to this address to cover fees
stellar keys address my-mainnet-id
# Expected: G... (56-character Stellar public key)
```

Minimum XLM required:

| Operation | Approximate fee |
|-----------|----------------|
| Contract deployment | 0.01–0.10 XLM |
| `migrate()` call | < 0.001 XLM |
| Per-subscriber migration (`subscribe` + `cancel` on v1) | < 0.005 XLM total |

Keep the identity key file secure.  Do not commit it to source control or include it in any
`NEXT_PUBLIC_` environment variable.

---

## Summary: migration decision tree

```
New feature / bug fix?
  │
  ├─ No breaking change in SubscriptionData?
  │    └─ Immutable contract: no migration needed.
  │       Deploy a new contract for the fix, redirect frontend.
  │
  └─ Breaking change (new field, renamed entry point, different auth)?
       └─ Follow expand-contract migration:
            1. Deploy v2 alongside v1
            2. Call initialize() + migrate() on v2
            3. Update frontend to v2
            4. Off-chain migration of subscribers
            5. Decommission v1
            6. Rollback via snapshot if v2 proves unstable
```
