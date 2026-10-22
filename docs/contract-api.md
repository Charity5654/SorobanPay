# Contract API Reference

Full reference for all `SubscriptionProtocol` entry points, types, and error codes.

**Contract version:** `1.0.0`  
**Schema version:** `1`  
**Network:** Stellar / Soroban

---

## Table of contents

1. [Type reference](#type-reference)
2. [Entry points](#entry-points)
   - [subscribe](#subscribe)
   - [execute_payment](#execute_payment)
   - [batch_execute_payment](#batch_execute_payment)
   - [cancel](#cancel)
   - [get_subscription](#get_subscription)
   - [initialize](#initialize)
   - [migrate](#migrate)
   - [get_version](#get_version)
   - [get_schema_version](#get_schema_version)
   - [compute_subscription_key](#compute_subscription_key)
   - [get_merchant_subscription_keys](#get_merchant_subscription_keys)
3. [Error code reference](#error-code-reference)
4. [Transaction fee guidance](#transaction-fee-guidance)
5. [End-to-end flow example](#end-to-end-flow-example)

---

## Type reference

### `SubscriptionData`

The on-chain record persisted under `DataKey::Subscription(sha256(subscriber_xdr ++ merchant_xdr))`.

| Field | Type | Invariants | Description |
|-------|------|------------|-------------|
| `token` | `Address` | SEP-41 contract | Token used for payment transfers |
| `amount` | `i128` | `> 0`, `≤ 10¹⁸` | Payment amount per interval in the token's base unit (stroops) |
| `interval` | `u64` | `[86400, 31536000]` | Seconds between successive payments (1 day – 365 days) |
| `next_payment` | `u64` | `> 0`, no overflow | Unix timestamp of the next valid payment window |
| `is_paused` | `bool` | — | `true` when subscription payments are suspended (reserved for future use) |

**Amount units:** All `amount` values are in the token's smallest unit (stroops for USDC-equivalent tokens with 7 decimals: divide by `10_000_000` to get the display value). See [docs/token-decimals.md](token-decimals.md) for full guidance.

### Storage key derivation

Subscription entries are keyed by `sha256(subscriber_xdr ++ merchant_xdr)`, a compact 32-byte `BytesN<32>`. Use [`compute_subscription_key`](#compute_subscription_key) to derive the key off-chain for direct storage inspection.

---

## Entry points

---

### `subscribe`

Create or update a recurring payment subscription. Calling `subscribe` a second time for the same `(subscriber, merchant)` pair **updates** the amount and interval and resets the storage TTL — it does not create a duplicate.

**Authorization:** `subscriber` must sign.

#### Parameters

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `subscriber` | `Address` | ≠ `merchant` | Account that will be charged each interval |
| `merchant` | `Address` | ≠ `subscriber` | Account that receives payments |
| `token` | `Address` | SEP-41, ≠ contract address | Token contract used for transfers |
| `amount` | `i128` | `> 0`, `≤ 10¹⁸` | Payment amount per interval in token base units |
| `interval` | `u64` | `[86400, 31536000]` | Seconds between payments (min 1 day, max 365 days) |
| `strict` | `bool` | — | When `true`, rejects the call if the subscriber's current SEP-41 allowance for this contract is below `amount`. When `false`, a low-allowance warning event is emitted instead. |

#### Return value

`Result<(), ContractError>` — returns `()` on success.

#### Error codes

| Error | Code | Trigger |
|-------|------|---------|
| `SelfSubscription` | 10 | `subscriber == merchant` |
| `AmountMustBePositive` | 1 | `amount ≤ 0` |
| `AmountTooLarge` | 9 | `amount > 10¹⁸` |
| `IntervalTooShort` | 2 | `interval < 86400` |
| `IntervalTooLong` | 3 | `interval > 31536000` |
| `InvalidTimestamp` | 8 | Ledger timestamp is zero or `now + interval` overflows `u64` |
| `InsufficientAllowance` | 14 | `strict == true` and subscriber's token allowance < `amount` |

#### Events emitted

- `subscribe` — always on success (see [events.md](events.md))
- `low_allowance` — when `strict == false` and allowance is below `amount`

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- subscribe \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT \
  --token      CABC1111...TOKEN \
  --amount     10000000 \
  --interval   2592000 \
  --strict     false
```

#### TypeScript example

```typescript
import {
  Contract,
  nativeToScVal,
  Address,
  SorobanRpc,
  TransactionBuilder,
  Networks,
} from "@stellar/stellar-sdk";

const contract = new Contract(contractId);

// Build the operation
const op = contract.call(
  "subscribe",
  new Address(subscriber).toScVal(),        // subscriber
  new Address(merchant).toScVal(),          // merchant
  new Address(tokenAddress).toScVal(),      // token
  nativeToScVal(10_000_000n, { type: "i128" }), // amount: 1.0 USDC (7 decimals)
  nativeToScVal(2_592_000n, { type: "u64" }),   // interval: 30 days
  nativeToScVal(false, { type: "bool" }),        // strict: false
);

// Simulate first, then sign and submit
const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const account = await server.getAccount(subscriber);
const tx = new TransactionBuilder(account, {
  fee: "1000",
  networkPassphrase: Networks.TESTNET,
})
  .addOperation(op)
  .setTimeout(30)
  .build();

const simResult = await server.simulateTransaction(tx);
// Expected: { status: "SUCCESS" }
// Subscription stored; `subscribe` event emitted.
```

#### Rust test example

```rust
#[test]
fn test_subscribe_basic() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SubscriptionProtocol);
    let client = SubscriptionProtocolClient::new(&env, &contract_id);

    let subscriber = Address::generate(&env);
    let merchant = Address::generate(&env);
    let token = Address::generate(&env);

    // Subscribe: 1_000_000 base units, 30-day interval, non-strict
    let result = client.subscribe(&subscriber, &merchant, &token, &1_000_000i128, &2_592_000u64, &false);
    assert!(result.is_ok());

    // Verify subscription was stored
    let sub = client.get_subscription(&subscriber, &merchant);
    assert!(sub.is_some());
    let sub = sub.unwrap();
    assert_eq!(sub.amount, 1_000_000i128);
    assert_eq!(sub.interval, 2_592_000u64);
    assert!(!sub.is_paused);
}

#[test]
fn test_subscribe_self_subscription_error() {
    let env = Env::default();
    env.mock_all_auths();
    let contract_id = env.register_contract(None, SubscriptionProtocol);
    let client = SubscriptionProtocolClient::new(&env, &contract_id);
    let addr = Address::generate(&env);
    let token = Address::generate(&env);

    let result = client.try_subscribe(&addr, &addr, &token, &100i128, &86_400u64, &false);
    assert_eq!(result, Err(Ok(ContractError::SelfSubscription)));
}
```

---

### `execute_payment`

Collect the next due payment from a subscriber. Transfers `amount` tokens directly from `subscriber` to `merchant` via SEP-41 `transfer`. Advances `next_payment` by `interval` seconds.

**Authorization:** `merchant` must sign.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber whose payment is due |
| `merchant` | `Address` | Caller — receives the payment |

#### Return value

`Result<(), ContractError>` — returns `()` on success.

#### Error codes

| Error | Code | Trigger |
|-------|------|---------|
| `NoActiveSubscription` | 4 | No subscription found for this `(subscriber, merchant)` pair |
| `PaymentNotDue` | 5 | Ledger timestamp < `next_payment` |
| `TransferFailed` | 7 | Subscriber's token balance < `amount` at payment time |
| `InvalidTimestamp` | 8 | Ledger timestamp is zero |

#### Failure paths

**`PaymentNotDue` path:**  
The call returns immediately after the storage read. No token transfer occurs. The subscription record is unchanged. Diagnostic: check `next_payment` from `get_subscription` and compare to current ledger time.

```bash
# Check when the next payment is due
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- get_subscription \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
# Returns: { token, amount, interval, next_payment, is_paused }
# Compare next_payment (unix timestamp) to current time
```

**`TransferFailed` path:**  
The contract checks the subscriber's balance before calling `transfer`. If the balance is insufficient, it emits a `payment_transfer_failure` event and returns `TransferFailed`. The subscription remains active and can be retried once the subscriber funds their account.

```typescript
// Detect a TransferFailed by listening for the payment_transfer_failure event
import { SorobanRpc } from "@stellar/stellar-sdk";
const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const events = await server.getEvents({
  startLedger: ledgerOfFailedTx,
  filters: [{ type: "contract", contractIds: [contractId] }],
});
// Look for topic[0] === "payment_transfer_failure"
```

#### Events emitted

- `executed` — on successful transfer
- `payment_transfer_failure` — when subscriber balance < `amount` (subscription not modified)

For a complete guide on when and how to retry after a `TransferFailed` or revoked
allowance, see [docs/retry-semantics.md](retry-semantics.md).

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source merchant-key \
  --network testnet \
  -- execute_payment \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

#### TypeScript example

```typescript
const op = contract.call(
  "execute_payment",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);

// After signing and submitting:
// - On success: `executed` event emitted, next_payment advanced by interval
// - On failure: `payment_transfer_failure` event emitted, TransferFailed error returned
```

#### Rust test example

```rust
#[test]
fn test_execute_payment_success() {
    let env = Env::default();
    env.mock_all_auths();
    // ... setup token, fund subscriber, call subscribe ...
    // Advance ledger past next_payment
    env.ledger().with_mut(|l| l.timestamp = next_payment + 1);

    let result = client.execute_payment(&subscriber, &merchant);
    assert!(result.is_ok());

    // Verify next_payment was advanced
    let sub = client.get_subscription(&subscriber, &merchant).unwrap();
    assert_eq!(sub.next_payment, next_payment + 1 + interval);
}

#[test]
fn test_execute_payment_not_due() {
    // ... setup ...
    // Do NOT advance ledger past next_payment
    let result = client.try_execute_payment(&subscriber, &merchant);
    assert_eq!(result, Err(Ok(ContractError::PaymentNotDue)));
}
```

---

### `batch_execute_payment`

Collect payments from up to 50 subscribers in a single transaction. Each subscriber is processed independently — failures do not abort the batch. Returns a result vector indicating which subscribers were successfully charged.

**Authorization:** `merchant` must sign (once for the entire batch).

**Hard cap:** 50 subscribers per call (`BATCH_MAX_SIZE = 50`).

#### Parameters

| Parameter | Type | Constraints | Description |
|-----------|------|-------------|-------------|
| `merchant` | `Address` | — | Caller — receives all payments |
| `subscribers` | `Vec<Address>` | length `[1, 50]` | List of subscriber addresses to charge |

#### Return value

`Result<Vec<(Address, bool)>, ContractError>` — a vector of `(subscriber_address, success)` tuples. `true` means the payment was transferred; `false` means it was skipped (not due, no active subscription, or insufficient balance).

#### Error codes

| Error | Code | Trigger |
|-------|------|---------|
| `EmptyBatch` | 12 | `subscribers` vector is empty |
| `BatchTooLarge` | 13 | `subscribers.len() > 50` |
| `InvalidTimestamp` | 8 | Ledger timestamp is zero |

#### Events emitted

- `batch_execute_initiated` — once at the start, with merchant and batch size
- `payment_transfer_success` — for each subscriber successfully charged
- `executed` — for each subscriber successfully charged
- `payment_transfer_failure` — for each subscriber with insufficient balance

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source merchant-key \
  --network testnet \
  -- batch_execute_payment \
  --merchant   GXYZ5678...MERCHANT \
  --subscribers '[{"address":"GABC...SUB1"},{"address":"GDEF...SUB2"}]'
```

#### TypeScript example

```typescript
import { nativeToScVal, Address, xdr } from "@stellar/stellar-sdk";

const subscriberAddresses = ["GABC...SUB1", "GDEF...SUB2", "GHIJ...SUB3"];

const op = contract.call(
  "batch_execute_payment",
  new Address(merchant).toScVal(),
  xdr.ScVal.scvVec(subscriberAddresses.map((s) => new Address(s).toScVal())),
);

// After submission, decode the return value to see per-subscriber results:
// Vec<(Address, bool)> → [ [sub1, true], [sub2, false], [sub3, true] ]
```

---

### `cancel`

Remove the subscription from persistent storage. No further payments can be collected after cancellation. Removes the subscription from the merchant's enumeration index.

**Authorization:** `subscriber` must sign.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Owner of the subscription |
| `merchant` | `Address` | The counterparty |

#### Return value

`Result<(), ContractError>` — returns `()` on success.

#### Error codes

| Error | Code | Trigger |
|-------|------|---------|
| `NoActiveSubscription` | 4 | No subscription found for this pair |

#### Events emitted

- `cancel` — always on success, data is `()` (unit)

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source alice \
  --network testnet \
  -- cancel \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

#### TypeScript example

```typescript
const op = contract.call(
  "cancel",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
// After success: subscription deleted; future execute_payment returns NoActiveSubscription (4)
```

#### Rust test example

```rust
#[test]
fn test_cancel_removes_subscription() {
    // ... setup and subscribe ...
    let result = client.cancel(&subscriber, &merchant);
    assert!(result.is_ok());

    // Subscription is gone
    assert!(client.get_subscription(&subscriber, &merchant).is_none());

    // execute_payment now returns NoActiveSubscription
    let pay_result = client.try_execute_payment(&subscriber, &merchant);
    assert_eq!(pay_result, Err(Ok(ContractError::NoActiveSubscription)));
}
```

---

### `get_subscription`

Query active subscription details for a subscriber-merchant pair. This is a read-only call; it requires no authorization. As a side effect, it extends the entry's TTL if it is below the minimum threshold.

**Authorization:** None required.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber address |
| `merchant` | `Address` | Merchant address |

#### Return value

`Option<SubscriptionData>` — `Some(data)` if an active subscription exists, `None` otherwise.

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source any-account \
  --network testnet \
  -- get_subscription \
  --subscriber GABC1234...SUBSCRIBER \
  --merchant   GXYZ5678...MERCHANT
```

**Example output:**
```json
{
  "token": "CABC1111...TOKEN",
  "amount": "10000000",
  "interval": "2592000",
  "next_payment": "1753660800",
  "is_paused": false
}
```

#### TypeScript example

```typescript
import { scValToNative } from "@stellar/stellar-sdk";

const op = contract.call(
  "get_subscription",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);

// Simulate (no signature needed for read-only)
const simResult = await server.simulateTransaction(tx);
if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
  const data = scValToNative(simResult.result!.retval);
  // data === null  →  no active subscription
  // data === { token, amount, interval, next_payment, is_paused }
  if (data) {
    const nextPaymentDate = new Date(Number(data.next_payment) * 1000);
    console.log("Next payment due:", nextPaymentDate.toISOString());
  }
}
```

#### Frontend helper — `querySubscription`

The SorobanPay frontend exposes a typed wrapper in
`frontend/src/lib/transaction_builder.ts` that handles account lookup, transaction
building, and result decoding in one call. No signing or fees are required.

```typescript
import { querySubscription } from "@/lib/transaction_builder";

// Query from a Next.js component or server action
const { subscription } = await querySubscription(
  { subscriber: "GABC...SUBSCRIBER", merchant: "GXYZ...MERCHANT" },
  process.env.NEXT_PUBLIC_CONTRACT_ID!,
  process.env.NEXT_PUBLIC_RPC_URL!,
  process.env.NEXT_PUBLIC_NETWORK_PASSPHRASE!,
);

if (subscription) {
  const due = new Date(Number(subscription.next_payment) * 1000);
  console.log("Token:          ", subscription.token);
  console.log("Amount:         ", subscription.amount.toString(), "base units");
  console.log("Interval:       ", subscription.interval.toString(), "seconds");
  console.log("Next payment:   ", due.toISOString());
  console.log("Is paused:      ", subscription.is_paused);
} else {
  console.log("No active subscription.");
}
```

**`QuerySubscriptionParams`**

| Field | Type | Description |
|-------|------|-------------|
| `subscriber` | `string` | Subscriber Stellar G-address |
| `merchant` | `string` | Merchant Stellar G-address |

**`SubscriptionData`** (returned in `subscription`)

| Field | Type | Description |
|-------|------|-------------|
| `token` | `string` | SEP-41 token contract address (`C…`) |
| `amount` | `bigint` | Payment amount per interval in token base units |
| `interval` | `bigint` | Seconds between payments |
| `next_payment` | `bigint` | Unix timestamp of next valid payment window |
| `is_paused` | `boolean` | Whether payments are currently suspended |

#### Notes

- `get_subscription` is **read-only** — no authorization required, no fee consumed.
- As a side effect, it extends the subscription entry's TTL if it is below `MIN_TTL_LEDGERS` (~30 days). This prevents the entry from expiring between payment cycles even on long billing intervals.
- Returns `None` / `null` for expired or cancelled subscriptions. Distinguish from an active subscription with zero balance by also checking the on-chain token balance.

---

### `initialize`

One-time setup: stores the admin address and initial schema version in instance storage. Must be called once after deployment. Panics if called again.

**Authorization:** None required (called by deployer).

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Address authorised to call `migrate` |

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source deployer \
  --network testnet \
  -- initialize \
  --admin GADMIN...ADDRESS
```

---

### `migrate`

Upgrade the on-chain schema version to `CURRENT_SCHEMA_VERSION`. Returns `AlreadyMigrated` if the contract is already at the current version. Emits `contract_migrated`.

**Authorization:** `admin` (the address stored by `initialize`) must sign.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `admin` | `Address` | Must match the stored admin address |

#### Return value

`Result<(), ContractError>`

#### Error codes

| Error | Code | Trigger |
|-------|------|---------|
| `NotInitialized` | 17 | `initialize` has not been called |
| `NotAdmin` | 16 | `admin` does not match the stored admin address |
| `AlreadyMigrated` | 15 | Schema version is already `CURRENT_SCHEMA_VERSION` |

---

### `get_version`

Return the contract semantic version string (e.g. `"1.0.0"`). This is a compile-time constant — no storage read occurs.

**Authorization:** None required.

#### Return value

`&'static str`

#### CLI example

```bash
stellar contract invoke \
  --id $CONTRACT_ID \
  --source any-account \
  --network testnet \
  -- get_version
# Output: "1.0.0"
```

---

### `get_schema_version`

Return the on-chain schema version stored during the last `migrate` call (or `initialize`). Returns `0` if `initialize` has not been called.

**Authorization:** None required.

#### Return value

`u32`

---

### `compute_subscription_key`

Compute and return the compact 32-byte SHA-256 storage key for a subscription pair. Useful for off-chain tooling that wants to inspect raw ledger storage entries without going through the contract.

**Authorization:** None required.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber address |
| `merchant` | `Address` | Merchant address |

#### Return value

`BytesN<32>` — `sha256(subscriber_xdr ++ merchant_xdr)`

---

### `get_merchant_subscription_keys`

Return all subscription key hashes indexed for a given merchant. Off-chain tools can iterate these hashes to enumerate all active subscriptions the merchant is party to.

**Authorization:** None required.

#### Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `merchant` | `Address` | Merchant address to query |

#### Return value

`Vec<BytesN<32>>` — list of 32-byte hashed subscription keys (may be empty if no subscriptions exist).

> **Note:** These keys are stored in **temporary** storage (not persistent). Temporary storage has a shorter TTL than persistent storage. Entries may be absent for inactive merchants.

---

## Error code reference

Complete table of all 17 error codes with trigger conditions, affected entry points, and resolution guidance.

| Code | Name | Entry points | Trigger condition | Resolution |
|------|------|-------------|-------------------|------------|
| 1 | `AmountMustBePositive` | `subscribe` | `amount ≤ 0` | Pass a positive `amount` |
| 2 | `IntervalTooShort` | `subscribe` | `interval < 86400` | Minimum interval is 86400 s (1 day) |
| 3 | `IntervalTooLong` | `subscribe` | `interval > 31536000` | Maximum interval is 31536000 s (365 days) |
| 4 | `NoActiveSubscription` | `execute_payment`, `cancel` | No record for `(subscriber, merchant)` | Verify pair; may have been cancelled or expired |
| 5 | `PaymentNotDue` | `execute_payment` | `now < next_payment` | Wait until `next_payment` timestamp has passed |
| 6 | `Unauthorized` | all auth-required | Signature missing or invalid | Ensure the correct account signs the transaction |
| 7 | `TransferFailed` | `execute_payment` | Subscriber balance < `amount` | Subscriber must fund their account or top up allowance |
| 8 | `InvalidTimestamp` | `subscribe`, `execute_payment` | Ledger timestamp is zero or `now + interval` overflows `u64` | Unlikely in production; indicates ledger misconfiguration |
| 9 | `AmountTooLarge` | `subscribe` | `amount > 10¹⁸` | Use an amount within the safe range |
| 10 | `SelfSubscription` | `subscribe` | `subscriber == merchant` | Use distinct addresses for subscriber and merchant |
| 11 | `InvalidTokenAddress` | `subscribe` | `token == contract address` | Use a valid SEP-41 token contract address |
| 12 | `EmptyBatch` | `batch_execute_payment` | `subscribers` vector is empty | Pass at least one subscriber |
| 13 | `BatchTooLarge` | `batch_execute_payment` | `subscribers.len() > 50` | Split into batches of ≤ 50 |
| 14 | `InsufficientAllowance` | `subscribe` | `strict == true` and allowance < `amount` | Approve a higher SEP-41 allowance first, or use `strict = false` |
| 15 | `AlreadyMigrated` | `migrate` | Schema already at `CURRENT_SCHEMA_VERSION` | No action needed |
| 16 | `NotAdmin` | `migrate` | Caller ≠ stored admin address | Use the admin identity set during `initialize` |
| 17 | `NotInitialized` | `migrate` | `initialize` not yet called | Call `initialize(admin)` first |

### Errors returned per entry point

| Entry point | Possible errors |
|-------------|----------------|
| `subscribe` | 1, 2, 3, 8, 9, 10, 11, 14 |
| `execute_payment` | 4, 5, 6, 7, 8 |
| `batch_execute_payment` | 8, 12, 13 |
| `cancel` | 4 |
| `get_subscription` | _(none — returns `Option`)_ |
| `migrate` | 15, 16, 17 |

---

## Transaction fee guidance

All entry points are O(1) in computation (no unbounded loops). Fee costs differ because `execute_payment` crosses into an external token contract.

| Entry point | Relative cost | Min `instructions` | Min `write_bytes` | Notes |
|-------------|--------------|-------------------|------------------|-------|
| `subscribe` | Medium | 150,000 | 300 | Auth + persistent write + TTL extend |
| `execute_payment` | Highest | 500,000 | 500 | Two cross-contract calls (`balance` + `transfer`) |
| `batch_execute_payment` | Scales with batch | `500,000 × n` | `500 × n` | Per-subscriber cost similar to `execute_payment` |
| `cancel` | Lowest | 50,000 | 100 | Auth + persistent remove |
| `get_subscription` | Minimal | 30,000 | 50 | Read-only + conditional TTL extend |

Always simulate before submitting to production — `simulateTransaction` returns exact `minResourceFee`, `instructions`, and write/read byte counts:

```typescript
const simResult = await server.simulateTransaction(tx);
if (SorobanRpc.Api.isSimulationSuccess(simResult)) {
  console.log("Min resource fee:", simResult.minResourceFee);
  console.log("Instructions:", simResult.transactionData.resources().instructions());
}
```

Add a 10–25% buffer to the simulated `instructions` count to absorb minor host-version variance between simulation and submission.

### Error cases

| Error | Code | Trigger |
|-------|------|---------|
| `NoActiveSubscription` | 4 | No subscription found for this pair |

---

## Query entry points

### `get_subscription`

Read-only. Returns the full `SubscriptionData` for a subscriber-merchant pair, or `None` if no subscription exists.

Calling this function also silently extends the entry's TTL (same thresholds as `subscribe`).

**Auth:** none.

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber to look up |
| `merchant` | `Address` | Merchant counterparty |

**Return type:** `Option<SubscriptionData>`

```rust
pub struct SubscriptionData {
    pub token:        Address,  // SEP-41 token contract
    pub amount:       i128,     // payment amount per interval
    pub interval:     u64,      // seconds between payments
    pub next_payment: u64,      // unix timestamp of next valid payment window
    pub is_paused:    bool,     // true when payments are suspended
}
```

**CLI:**
```bash
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- get_subscription \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
```

**TypeScript:**
```typescript
const result = await server.simulateTransaction(
  buildGetSubscriptionTx(contract, subscriber, merchant, account, networkPassphrase)
);
const data = scValToNative(result.result?.retval);
// data: { token, amount, interval, next_payment, is_paused } or null
```

---

## Utility entry points

### `compute_subscription_key`

Returns the 32-byte `sha256(subscriber_xdr ++ merchant_xdr)` storage key for a given pair. Useful for off-chain tooling that needs to inspect raw ledger entries.

**Auth:** none.

| Parameter | Type | Description |
|-----------|------|-------------|
| `subscriber` | `Address` | Subscriber address |
| `merchant` | `Address` | Merchant address |

Returns `BytesN<32>`.

---

### `get_merchant_subscription_keys`

Returns all 32-byte subscription key hashes currently indexed for the given merchant. Off-chain tools can iterate these hashes to enumerate all active subscriptions the merchant participates in.

**Auth:** none.

| Parameter | Type | Description |
|-----------|------|-------------|
| `merchant` | `Address` | Merchant to look up |

Returns `Vec<BytesN<32>>`. Returns an empty vector if the merchant has no subscriptions or the index entry has expired.

> **Note:** The index is stored under **temporary** storage (not persistent). It may be evicted if the ledger TTL lapses. Always treat the result as advisory and verify individual entries with `get_subscription`.

---

## All error codes

| Code | Name | Trigger |
|------|------|---------|
| 1 | `AmountMustBePositive` | `amount ≤ 0` in `subscribe` |
| 2 | `IntervalTooShort` | `interval < 86400` in `subscribe` |
| 3 | `IntervalTooLong` | `interval > 31536000` in `subscribe` |
| 4 | `NoActiveSubscription` | No subscription found for `(subscriber, merchant)` |
| 5 | `PaymentNotDue` | `now < next_payment` in `execute_payment` |
| 6 | `Unauthorized` | Authorization check failed |
| 7 | `TransferFailed` | Insufficient subscriber balance at payment time |
| 8 | `InvalidTimestamp` | Ledger timestamp is zero or would overflow |
| 9 | `AmountTooLarge` | `amount > 10¹⁸` in `subscribe` |
| 10 | `SelfSubscription` | `subscriber == merchant` in `subscribe` |
| 11 | `InvalidTokenAddress` | `token` is the contract's own address |
| 12 | `EmptyBatch` | `subscribers` list is empty in `batch_execute_payment` |
| 13 | `BatchTooLarge` | `subscribers.len() > 50` in `batch_execute_payment` |
| 14 | `InsufficientAllowance` | `strict == true` and `allowance < amount` in `subscribe` |
| 15 | `AlreadyMigrated` | Schema already at current version in `migrate` |
| 16 | `NotAdmin` | Caller is not the stored admin in `migrate` |
| 17 | `NotInitialized` | `initialize` was never called |

Error codes 1–17 are **stable** — they will never be reassigned. New codes will use numbers ≥ 18.

---

## End-to-end flow example

```bash
# 1. Deploy and initialize
CONTRACT_ID=$(bash deploy/deploy.sh)
stellar contract invoke \
  --id $CONTRACT_ID --source deployer --network testnet \
  -- initialize --admin $ADMIN_ADDRESS

# 2. Subscriber sets SEP-41 allowance (off-chain, via token contract)
stellar contract invoke \
  --id $TOKEN_CONTRACT --source alice --network testnet \
  -- approve \
  --from    $ALICE_ADDRESS \
  --spender $CONTRACT_ID \
  --amount  100000000 \
  --expiration_ledger 9999999

# 3. Subscriber creates a subscription (10 USDC/month)
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- subscribe \
  --subscriber $ALICE_ADDRESS \
  --merchant   $MERCHANT_ADDRESS \
  --token      $USDC_TOKEN \
  --amount     100000000 \
  --interval   2592000 \
  --strict     false

# 4. Query subscription state
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- get_subscription \
  --subscriber $ALICE_ADDRESS \
  --merchant   $MERCHANT_ADDRESS

# 5. Merchant collects payment (run on/after next_payment timestamp)
stellar contract invoke \
  --id $CONTRACT_ID --source merchant-key --network testnet \
  -- execute_payment \
  --subscriber $ALICE_ADDRESS \
  --merchant   $MERCHANT_ADDRESS

# 6. Subscriber cancels
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- cancel \
  --subscriber $ALICE_ADDRESS \
  --merchant   $MERCHANT_ADDRESS
```

---

## Related documentation

- [events.md](events.md) — Full event reference, RPC query examples, and decoding guide
- [docs/token-decimals.md](token-decimals.md) — Amount units, decimal conversion
- [docs/operations.md](operations.md) — Storage TTL management and alert thresholds
- [docs/security.md](security.md) — Security model and best practices
- [docs/networks.md](networks.md) — Testnet vs mainnet configuration
