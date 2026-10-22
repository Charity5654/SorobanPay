# SorobanPay — Event Data Schema Reference

Canonical, machine-readable schema for every event emitted by `SubscriptionProtocol`.
This document describes the exact XDR types, field names, and encoding rules that
off-chain consumers must use to parse events reliably.

For RPC query patterns, decoding examples, and indexing architecture see
[events.md](events.md).

---

## Table of contents

1. [Wire format overview](#wire-format-overview)
2. [ScVal type cheat sheet](#scval-type-cheat-sheet)
3. [Event schemas](#event-schemas)
   - [subscribe](#subscribe)
   - [executed](#executed)
   - [payment\_transfer\_failure](#payment_transfer_failure)
   - [payment\_transfer\_success](#payment_transfer_success)
   - [cancel](#cancel)
   - [batch\_execute\_initiated](#batch_execute_initiated)
   - [low\_allowance](#low_allowance)
   - [contract\_migrated](#contract_migrated)
   - [contract\_deployed](#contract_deployed)
4. [Field semantics](#field-semantics)
5. [Amount encoding](#amount-encoding)
6. [Address encoding](#address-encoding)
7. [Changelog](#changelog)

---

## Wire format overview

Soroban events are returned by the `getEvents` RPC method. Each event has:

- **`type`** — always `"contract"` for SorobanPay events.
- **`ledger`** — ledger number where the event was emitted.
- **`id`** — opaque cursor string (e.g. `"0000000012345678-0000000001"`). Use as the `cursor` for resumable polling.
- **`contractId`** — the deployed `SubscriptionProtocol` contract address.
- **`topic`** — ordered array of `ScVal` items. `topic[0]` is always the discriminant symbol identifying the event type.
- **`value`** — a single `ScVal` carrying the event's data payload.

```
getEvents response entry:
{
  "type":       "contract",
  "ledger":     <u32>,
  "id":         "<cursor-string>",
  "contractId": "<Cxxx…>",
  "topic":      [ <ScVal>, <ScVal>, … ],
  "value":      { "xdr": "<base64-XDR>" }   ← raw JSON form
  // OR value is already a decoded ScVal when using the stellar-sdk
}
```

Topics and data are XDR-encoded `ScVal` values on the wire. The Stellar SDK's
`scValToNative()` helper (TypeScript) and `stellar_sdk.xdr.SCVal.from_xdr()`
(Python) decode them into native types.

---

## ScVal type cheat sheet

| XDR discriminant | Native representation | Used for |
|------------------|-----------------------|----------|
| `SCV_SYMBOL` | `string` | Event type discriminant in `topic[0]` |
| `SCV_ADDRESS` | `string` (Stellar `G…` or `C…` address) | Subscriber, merchant, token, admin addresses |
| `SCV_I128` | `bigint` (TypeScript) / `int` (Python) | Payment amounts, batch sizes, schema versions |
| `SCV_VOID` | `null` / `None` | Empty data payload (used by `cancel`) |
| `SCV_VEC` | `Array` / `list` | Tuple data (used by `low_allowance`) |

---

## Event schemas

### `subscribe`

**Emitted by:** `subscribe()`  
**Condition:** Always on a successful `subscribe()` call (new subscription or update).

#### Topics

| Index | XDR type | Value |
|-------|----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"subscribe"` |
| `topic[1]` | `SCV_ADDRESS` | Subscriber address (`G…`) |
| `topic[2]` | `SCV_ADDRESS` | Merchant address (`G…`) |
| `topic[3]` | `SCV_ADDRESS` | Token contract address (`C…`) |

#### Data

| XDR type | Field | Description |
|----------|-------|-------------|
| `SCV_I128` | `amount` | Recurring payment amount in the token's base unit. Always `> 0` and `≤ 10¹⁸`. |

#### Notes

- Emitted for both new subscriptions and updates to an existing `(subscriber, merchant)` pair.
- The `amount` field reflects the value stored in `SubscriptionData.amount` — the amount that will be charged on each future payment cycle.
- No `interval` or `next_payment` fields are included in the event payload; query `get_subscription()` directly if you need those values.

---

### `executed`

**Emitted by:** `execute_payment()`, `batch_execute_payment()`  
**Condition:** Emitted after a successful token transfer and `next_payment` timestamp advance.

#### Topics

| Index | XDR type | Value |
|-------|----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"executed"` |
| `topic[1]` | `SCV_ADDRESS` | Subscriber address (`G…`) |
| `topic[2]` | `SCV_ADDRESS` | Merchant address (`G…`) |
| `topic[3]` | `SCV_ADDRESS` | Token contract address (`C…`) |

#### Data

| XDR type | Field | Description |
|----------|-------|-------------|
| `SCV_I128` | `amount` | Amount actually transferred from subscriber to merchant. |

#### Notes

- In `batch_execute_payment()`, an `executed` event is emitted per successfully charged subscriber.
- When `execute_payment()` emits `executed`, the on-chain `next_payment` has already been advanced to `now + interval`. The subscription is **not** due again until that new timestamp.
- A successful `batch_execute_payment()` entry also emits `payment_transfer_success` (see below) in addition to `executed`.

---

### `payment_transfer_failure`

**Emitted by:** `execute_payment()`, `batch_execute_payment()`  
**Condition:** Emitted when the subscriber's on-chain token balance is below `amount` at the time of payment collection. The subscription **is not modified** — `next_payment` is not advanced and no transfer occurs.

#### Topics

| Index | XDR type | Value |
|-------|----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"payment_transfer_failure"` |
| `topic[1]` | `SCV_ADDRESS` | Subscriber address (`G…`) |
| `topic[2]` | `SCV_ADDRESS` | Merchant address (`G…`) |

> Note: the token address is **not** included in the topics for this event (3 topics, not 4).

#### Data

| XDR type | Field | Description |
|----------|-------|-------------|
| `SCV_I128` | `amount` | The amount that was attempted — equal to `SubscriptionData.amount`. |

#### Notes

- The contract checks `balance < amount` before calling `transfer`. If the check passes but `transfer` itself panics (e.g. due to a revoked SEP-41 allowance), the entire transaction reverts and **no event is emitted**.
- Indexers should treat this event as a signal to schedule a retry and flag the subscription as overdue. See [retry-semantics.md](retry-semantics.md) for the recommended retry strategy.

---

### `payment_transfer_success`

**Emitted by:** `batch_execute_payment()` only  
**Condition:** Emitted per successfully charged subscriber within a batch, in addition to `executed`.

#### Topics

| Index | XDR type | Value |
|-------|----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"payment_transfer_success"` |
| `topic[1]` | `SCV_ADDRESS` | Subscriber address (`G…`) |
| `topic[2]` | `SCV_ADDRESS` | Merchant address (`G…`) |

> Note: the token address is **not** included in the topics (3 topics, not 4).

#### Data

| XDR type | Field | Description |
|----------|-------|-------------|
| `SCV_I128` | `amount` | Amount successfully transferred. |

#### Notes

- This event is **not** emitted by single `execute_payment()` calls — only by `batch_execute_payment()`.
- It provides finer-grained batch reconciliation telemetry alongside `executed`.

---

### `cancel`

**Emitted by:** `cancel()`  
**Condition:** Always emitted when a subscription is successfully removed from storage.

#### Topics

| Index | XDR type | Value |
|-------|----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"cancel"` |
| `topic[1]` | `SCV_ADDRESS` | Subscriber address (`G…`) |
| `topic[2]` | `SCV_ADDRESS` | Merchant address (`G…`) |

#### Data

| XDR type | Field | Description |
|----------|-------|-------------|
| `SCV_VOID` | — | Empty payload. No amount or token data. |

#### Notes

- After a `cancel` event the subscription entry is deleted from persistent storage. A subsequent `execute_payment()` call for the same pair returns `ContractError::NoActiveSubscription` (error code 4).
- Revoke the SEP-41 token allowance separately to prevent the merchant from re-subscribing on your behalf.

---

### `batch_execute_initiated`

**Emitted by:** `batch_execute_payment()`  
**Condition:** Emitted once at the beginning of a batch call, before any individual payments are processed.

#### Topics

| Index | XDR type | Value |
|-------|----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"batch_execute_initiated"` |
| `topic[1]` | `SCV_ADDRESS` | Merchant address (`G…`) |

#### Data

| XDR type | Field | Description |
|----------|-------|-------------|
| `SCV_I128` | `batch_size` | Number of subscribers in the batch (1–50). Cast from `u32`. |

#### Notes

- Useful for tracking merchant activity and batch sizes over time.
- The `batch_size` value reflects how many subscribers were in the input `Vec`, not how many were actually charged (some may fail or be skipped).

---

### `low_allowance`

**Emitted by:** `subscribe()`  
**Condition:** Emitted when `strict == false` and the subscriber's current SEP-41 allowance for the contract is below `amount`. This is a **non-fatal warning** — the subscription is still created.

#### Topics

| Index | XDR type | Value |
|-------|----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"low_allowance"` |
| `topic[1]` | `SCV_ADDRESS` | Subscriber address (`G…`) |
| `topic[2]` | `SCV_ADDRESS` | Merchant address (`G…`) |
| `topic[3]` | `SCV_ADDRESS` | Token contract address (`C…`) |

#### Data

| XDR type | Encoding | Field | Description |
|----------|----------|-------|-------------|
| `SCV_VEC` | `[SCV_I128, SCV_I128]` | `[allowance, required]` | Current allowance and the required amount. |

The data is a 2-element `ScVal` vector:

```
SCV_VEC [
  SCV_I128  allowance   ← current SEP-41 allowance granted to the contract
  SCV_I128  required    ← the subscription amount (SubscriptionData.amount)
]
```

#### Notes

- If `strict == true` and allowance < amount, the call returns `ContractError::InsufficientAllowance` (error 14) and **no event is emitted**.
- Indexers can use this event to trigger an on-chain or off-chain prompt asking the subscriber to approve a larger allowance before the first payment cycle.

---

### `contract_migrated`

**Emitted by:** `migrate()`  
**Condition:** Emitted after a successful schema migration.

#### Topics

| Index | XDR type | Value |
|-------|----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"contract_migrated"` |
| `topic[1]` | `SCV_ADDRESS` | Admin address (`G…`) |

#### Data

| XDR type | Field | Description |
|----------|-------|-------------|
| `SCV_I128` | `new_schema_version` | The schema version after migration. Cast from `u32`. |

---

### `contract_deployed`

**Emitted by:** deployment hook  
**Condition:** Emitted at contract deployment to signal availability.

#### Topics

| Index | XDR type | Value |
|-------|----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"contract_deployed"` |

#### Data

| XDR type | Field | Description |
|----------|-------|-------------|
| `SCV_SYMBOL` | `version` | Contract version string (e.g. `"1.0.0"`). |

---

## Field semantics

### `subscriber`

- Type: `SCV_ADDRESS` → Stellar G-address (56 characters, starts with `G`)
- The account being charged. Must sign `subscribe()` and `cancel()` calls.
- Appears in topics for: `subscribe`, `executed`, `payment_transfer_failure`, `payment_transfer_success`, `cancel`, `low_allowance`.

### `merchant`

- Type: `SCV_ADDRESS` → Stellar G-address (56 characters, starts with `G`)
- The account receiving payments. Must sign `execute_payment()` and `batch_execute_payment()` calls.
- Appears in topics for all events except `contract_deployed`.

### `token`

- Type: `SCV_ADDRESS` → Stellar C-address (56 characters, starts with `C`)
- The SEP-41 token contract used for transfers.
- Appears in topics for: `subscribe`, `executed`, `low_allowance`.
- Not included in `payment_transfer_failure`, `payment_transfer_success`, or `cancel` topics.

### `amount`

- Type: `SCV_I128`
- In the token's smallest base unit (e.g. stroops for 7-decimal tokens).
- Always `> 0` in events. See [Amount encoding](#amount-encoding) for display conversion.

---

## Amount encoding

All `amount` values are `i128` integers in the token's **base unit** (smallest indivisible unit).

For SEP-41 tokens with 7 decimal places (e.g. USDC on Stellar):

| Display | Raw `i128` |
|---------|-----------|
| 1.0 | `10_000_000` |
| 9.99 | `99_900_000` |
| 100.00 | `1_000_000_000` |
| Max allowed | `1_000_000_000_000_000_000` (10¹⁸) |

Always verify the token's `decimals()` value — non-standard tokens may use different precision. See [token-decimals.md](token-decimals.md).

**TypeScript conversion:**

```typescript
function toDisplayAmount(raw: bigint, decimals = 7): string {
  const divisor = BigInt(10 ** decimals);
  const whole   = raw / divisor;
  const frac    = (raw % divisor).toString().padStart(decimals, "0");
  return `${whole}.${frac}`;
}
// toDisplayAmount(10_000_000n) → "1.0000000"
```

**Python conversion:**

```python
def to_display_amount(raw: int, decimals: int = 7) -> str:
    divisor = 10 ** decimals
    whole, frac = divmod(raw, divisor)
    return f"{whole}.{str(frac).zfill(decimals)}"
# to_display_amount(10_000_000) → "1.0000000"
```

---

## Address encoding

Addresses arrive as `SCV_ADDRESS` XDR values. The Stellar SDK decodes them into
standard Stellar string addresses:

- **Account addresses** start with `G` (56 characters, base32).
- **Contract addresses** start with `C` (56 characters, base32).

**TypeScript:**

```typescript
import { scValToNative } from "@stellar/stellar-sdk";
const address = scValToNative(topic) as string; // "G..." or "C..."
```

**Python:**

```python
from stellar_sdk import StrKey

def scval_to_address(val) -> str:
    addr = val.address
    if addr.type.name == "SC_ADDRESS_TYPE_ACCOUNT":
        return StrKey.encode_ed25519_public_key(
            addr.account_id.account_id.ed25519.uint256
        )
    return StrKey.encode_contract(addr.contract_id.hash)
```

---

## Changelog

| Date | Version | Change |
|------|---------|--------|
| 2026-08-31 | 1.0.0 | Initial schema reference document. Covers all 9 event types. Closes #57. |
