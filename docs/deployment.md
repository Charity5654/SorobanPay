# Deployment Guide

## Prerequisites

See [README.md §Prerequisites](../README.md#prerequisites) for the full toolchain list.

---

## Testnet Deployment

```bash
# 1. Create and fund a Stellar identity (one-time)
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet

# 2. Build the contract
make build

# 3. Deploy
bash deploy/deploy.sh
```

The contract address is printed to stdout on success.

---

## Mainnet Deployment

```bash
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=your-identity bash deploy/deploy.sh
```

---

## Contract Upgrades

Soroban contracts can be upgraded via `update_current_contract_wasm()`. Because
existing `SubscriptionData` entries are XDR-encoded on-chain, any schema change
to `SubscriptionData` must be backward-compatible with all entries already stored.

### Safe changes

| Change | Safe? | Notes |
|--------|-------|-------|
| Add a new **`Option<T>`** field | ✅ Yes | Existing entries decode to `None` for the new field |
| Add a new entry point | ✅ Yes | Storage schema is unchanged |
| Change a field type (same XDR size) | ⚠️ Caution | Test thoroughly; XDR encoding must match |
| Add a **non-optional** new field | ❌ No | **Breaking** — existing entries will panic on decode |
| Remove or rename a field | ❌ No | **Breaking** — XDR positional encoding breaks |
| Change field order | ❌ No | **Breaking** — XDR positional encoding breaks |

### Rule of thumb

> **Every new field added to `SubscriptionData` MUST be `Option<T>`.**

### Upgrade regression tests (TEST-103)

Upgrade regression tests live in
`contracts/subscription/src/test_upgrade.rs` and are gated behind the
`upgrade-test` feature flag.

```bash
# Run upgrade regression tests
cargo test \
  --manifest-path contracts/subscription/Cargo.toml \
  --features upgrade-test \
  -- upgrade

# Or via make
make test-upgrade
```

The tests cover three scenarios:

1. **`test_upgrade_optional_field_backward_compatible`** — Verifies that adding
   an `Option<T>` field to `SubscriptionData` does not break deserialization of
   entries written by the previous version. New field defaults to `None`.

2. **`test_upgrade_new_entrypoint_does_not_corrupt_storage`** — Verifies that
   adding a new entry point does not affect existing storage entries or break
   existing functionality (`execute_payment` must still work).

3. **`test_upgrade_non_optional_field_is_breaking`** — Intentionally panics
   (`#[should_panic]`) to document and enforce the rule that adding a
   non-`Option` field is a breaking change. If this test **stops panicking**,
   the breaking-change guard has been bypassed — treat this as a critical CI
   failure.

### Step-by-step upgrade procedure

1. Make your schema changes, ensuring all new fields are `Option<T>`.
2. Run `make test-upgrade` — all three upgrade tests must pass.
3. Run `make test` — full test suite must pass.
4. Build the new WASM: `make build`.
5. Deploy the upgrade:
   ```bash
   stellar contract invoke \
     --id <CONTRACT_ADDRESS> \
     --source alice \
     --network testnet \
     -- update_current_contract_wasm \
     --wasm-hash <NEW_WASM_HASH>
   ```
6. Verify existing subscriptions are still readable by calling `execute_payment`
   on a known subscription.

### Adding a new optional field — example

```rust
// Before (v1)
#[contracttype]
pub struct SubscriptionData {
    pub token:        Address,
    pub amount:       i128,
    pub interval:     u64,
    pub next_payment: u64,
}

// After (v2) — safe: memo is Option
#[contracttype]
pub struct SubscriptionData {
    pub token:        Address,
    pub amount:       i128,
    pub interval:     u64,
    pub next_payment: u64,
    pub memo:         Option<u32>,   // ← new field; MUST be Option
}
```

Add a corresponding test to `test_upgrade.rs` that reads a v1 entry under the
v2 schema and asserts `memo == None`.
