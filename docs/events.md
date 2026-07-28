# SorobanPay — Contract Event Reference

Complete reference for all events emitted by `SubscriptionProtocol`, including XDR schemas, RPC query examples, decoding guides, and indexing patterns.

---

## Table of contents

1. [Event overview](#event-overview)
2. [Event schemas](#event-schemas)
3. [Topic filter cheat sheet](#topic-filter-cheat-sheet)
4. [RPC query examples](#rpc-query-examples)
5. [Cursor-based pagination](#cursor-based-pagination)
6. [Decoding guide — TypeScript](#decoding-guide--typescript)
7. [Decoding guide — Python](#decoding-guide--python)
8. [Indexing patterns](#indexing-patterns)
9. [Amount units](#amount-units)

---

## Event overview

| Event | Emitted by | Topics | Data | Condition |
|-------|-----------|--------|------|-----------|
| `subscribe` | `subscribe()` | `(sym, subscriber, merchant, token)` | `i128` amount | Always on success |
| `executed` | `execute_payment()`, `batch_execute_payment()` | `(sym, subscriber, merchant, token)` | `(i128 amount, u64 nonce)` | Successful transfer |
| `expired` | `expire_subscription()` | `(sym, subscriber, merchant)` | `()` | Grace period elapsed |
| `payment_transfer_failure` | `execute_payment()`, `batch_execute_payment()` | `(sym, subscriber, merchant)` | `i128` amount attempted | Insufficient subscriber balance |
| `payment_transfer_success` | `batch_execute_payment()` | `(sym, subscriber, merchant)` | `i128` amount | Batch payment succeeded |
| `cancel` | `cancel()` | `(sym, subscriber, merchant)` | `()` unit | Always on success |
| `batch_execute_initiated` | `batch_execute_payment()` | `(sym, merchant)` | `i128` batch_size | Once per batch call |
| `low_allowance` | `subscribe()` | `(sym, subscriber, merchant, token)` | `(i128 allowance, i128 required)` | Allowance < amount in non-strict mode |
| `contract_migrated` | `migrate()` | `(sym, admin)` | `i128` new_schema_version | Successful migration |
| `contract_deployed` | deployment hook | `(sym,)` | `Symbol` version string | Contract deployment |

> `sym` is always a Soroban `Symbol` (e.g. `Symbol::new(env, "subscribe")`). Topics and data are XDR-encoded `ScVal` values on the wire.

---

## Event schemas

### `subscribe`

Emitted when `subscribe()` stores a new or updated subscription.

**XDR topic structure:**

| Index | ScVal type | Value |
|-------|-----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"subscribe"` |
| `topic[1]` | `SCV_ADDRESS` | subscriber address |
| `topic[2]` | `SCV_ADDRESS` | merchant address |
| `topic[3]` | `SCV_ADDRESS` | token contract address |

**Data field:**

| ScVal type | Value |
|-----------|-------|
| `SCV_I128` | `amount` — payment amount in token base units |

**Condition:** Always emitted on a successful `subscribe()` call, for both new subscriptions and updates.

---

### `executed`

Emitted when `execute_payment()` or `batch_execute_payment()` successfully transfers tokens and advances `next_payment`.

**XDR topic structure:**

| Index | ScVal type | Value |
|-------|-----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"executed"` |
| `topic[1]` | `SCV_ADDRESS` | subscriber address |
| `topic[2]` | `SCV_ADDRESS` | merchant address |
| `topic[3]` | `SCV_ADDRESS` | token contract address |

**Data field:**

| ScVal type | Value |
|-----------|-------|
| `SCV_VEC` | `[amount, nonce]` — amount transferred and monotonic replay-protection nonce |

---

### `payment_transfer_failure`

Emitted when `execute_payment()` or `batch_execute_payment()` detects insufficient subscriber balance **before** calling `transfer`. The subscription state is **not modified** — the call can be retried once the subscriber has funds.

> Note: if the subscriber has revoked their SEP-41 allowance, the token contract panics during `transfer` and the entire transaction reverts — no event is emitted in that case.

**XDR topic structure:**

| Index | ScVal type | Value |
|-------|-----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"payment_transfer_failure"` |
| `topic[1]` | `SCV_ADDRESS` | subscriber address |
| `topic[2]` | `SCV_ADDRESS` | merchant address |

**Data field:**

| ScVal type | Value |
|-----------|-------|
| `SCV_I128` | `amount` — amount that was attempted |

---

### `payment_transfer_success`

Emitted by `batch_execute_payment()` for each subscriber successfully charged. Provides finer-grained telemetry than `executed` for batch reconciliation.

**XDR topic structure:**

| Index | ScVal type | Value |
|-------|-----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"payment_transfer_success"` |
| `topic[1]` | `SCV_ADDRESS` | subscriber address |
| `topic[2]` | `SCV_ADDRESS` | merchant address |

**Data field:**

| ScVal type | Value |
|-----------|-------|
| `SCV_I128` | `amount` transferred |

---

### `cancel`

Emitted when `cancel()` successfully removes the subscription from persistent storage.

**XDR topic structure:**

| Index | ScVal type | Value |
|-------|-----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"cancel"` |
| `topic[1]` | `SCV_ADDRESS` | subscriber address |
| `topic[2]` | `SCV_ADDRESS` | merchant address |

**Data field:**

| ScVal type | Value |
|-----------|-------|
| `SCV_VOID` | `()` — empty unit type |

---

### `batch_execute_initiated`

Emitted once at the start of a `batch_execute_payment()` call, before individual payments are processed.

**XDR topic structure:**

| Index | ScVal type | Value |
|-------|-----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"batch_execute_initiated"` |
| `topic[1]` | `SCV_ADDRESS` | merchant address |

**Data field:**

| ScVal type | Value |
|-----------|-------|
| `SCV_I128` | `batch_size` — number of subscribers in the batch |

---

### `low_allowance`

Emitted by `subscribe()` when the subscriber's current SEP-41 allowance for the contract is below `amount` and `strict == false`. This is a non-fatal warning. Off-chain services can use it to prompt the subscriber to approve a larger allowance before the first payment.

**XDR topic structure:**

| Index | ScVal type | Value |
|-------|-----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"low_allowance"` |
| `topic[1]` | `SCV_ADDRESS` | subscriber address |
| `topic[2]` | `SCV_ADDRESS` | merchant address |
| `topic[3]` | `SCV_ADDRESS` | token contract address |

**Data field:**

| ScVal type | Value |
|-----------|-------|
| `SCV_VEC` | `[allowance: i128, required: i128]` — current allowance and the subscription amount |

---

### `contract_migrated`

Emitted by `migrate()` after a successful schema upgrade.

**XDR topic structure:**

| Index | ScVal type | Value |
|-------|-----------|-------|
| `topic[0]` | `SCV_SYMBOL` | `"contract_migrated"` |
| `topic[1]` | `SCV_ADDRESS` | admin address |

**Data field:**

| ScVal type | Value |
|-----------|-------|
| `SCV_I128` | `new_schema_version` — the version after migration |

---

## Topic filter cheat sheet

Quick-reference for `getEvents` filter configurations. All filters target a single contract via `contractIds`.

| Goal | `topics` filter |
|------|----------------|
| All events from the contract | `[["*"]]` |
| All `subscribe` events | `[["subscribe"]]` |
| All `executed` events | `[["executed"]]` |
| All `cancel` events | `[["cancel"]]` |
| All payment failures | `[["payment_transfer_failure"]]` |
| All events for a specific subscriber | `[["*", "<SUBSCRIBER_ADDRESS>"]]` |
| All events for a specific merchant | `[["*", "*", "<MERCHANT_ADDRESS>"]]` |
| `subscribe` events for a specific merchant | `[["subscribe", "*", "<MERCHANT_ADDRESS>"]]` |
| `executed` events for a specific pair | `[["executed", "<SUBSCRIBER>", "<MERCHANT>"]]` |
| `cancel` events for a specific subscriber | `[["cancel", "<SUBSCRIBER>"]]` |

> Topic filter strings use `"*"` as a wildcard. Address values must be the raw Stellar address string (e.g. `GABC...`), not XDR-encoded.

---

## RPC query examples

### Fetch all contract events (curl)

```bash
curl -s https://soroban-testnet.stellar.org \
  -H 'Content-Type: application/json' \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
      "startLedger": 1000000,
      "filters": [
        {
          "type": "contract",
          "contractIds": ["<YOUR_CONTRACT_ID>"],
          "topics": [["*"]]
        }
      ],
      "pagination": { "limit": 100 }
    }
  }'
```

### Fetch only `executed` events (TypeScript)

```typescript
import { SorobanRpc } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

const response = await server.getEvents({
  startLedger: 1_000_000,
  filters: [
    {
      type: "contract",
      contractIds: [contractId],
      topics: [["executed"]],
    },
  ],
  limit: 100,
});

console.log(`Found ${response.events.length} executed events`);
```

### Fetch all events for a specific merchant (TypeScript)

```typescript
const response = await server.getEvents({
  startLedger: 1_000_000,
  filters: [
    {
      type: "contract",
      contractIds: [contractId],
      topics: [["*", "*", merchantAddress]],
    },
  ],
  limit: 100,
});
```

### Fetch `cancel` events for a specific subscriber (Python)

```python
import requests, json

payload = {
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getEvents",
    "params": {
        "startLedger": 1_000_000,
        "filters": [
            {
                "type": "contract",
                "contractIds": ["<YOUR_CONTRACT_ID>"],
                "topics": [["cancel", "<SUBSCRIBER_ADDRESS>"]],
            }
        ],
        "pagination": {"limit": 100},
    },
}

resp = requests.post(
    "https://soroban-testnet.stellar.org",
    json=payload,
    headers={"Content-Type": "application/json"},
)
data = resp.json()
events = data["result"]["events"]
print(f"Found {len(events)} cancel events")
```

---

## Cursor-based pagination

The Soroban RPC `getEvents` endpoint supports cursor-based pagination via the `cursor` and `limit` fields under `pagination`. Use this to resume polling from where you left off without re-fetching already-processed events.

### How cursors work

Each event in the response includes an `id` field (e.g. `"0000000012345678-0000000001"`). This is the cursor value. Pass it as `cursor` in the next request to fetch events **after** that point.

### TypeScript polling loop with cursor

```typescript
import { SorobanRpc } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

async function pollEvents(
  contractId: string,
  startLedger: number,
  savedCursor?: string,
): Promise<string | undefined> {
  const params: SorobanRpc.Api.GetEventsRequest = {
    filters: [{ type: "contract", contractIds: [contractId] }],
    limit: 200,
    ...(savedCursor
      ? { cursor: savedCursor }          // resume from saved position
      : { startLedger }),                // first run: start from ledger
  };

  const response = await server.getEvents(params);
  const events = response.events ?? [];

  for (const event of events) {
    await processEvent(event);           // your processing logic
  }

  // Return the last cursor seen so the caller can persist it
  return events.length > 0
    ? events[events.length - 1].id
    : savedCursor;
}

// Example: run every 10 seconds, persist cursor to DB
let cursor: string | undefined = await loadCursorFromDb();
setInterval(async () => {
  cursor = await pollEvents(contractId, 1_000_000, cursor);
  if (cursor) await saveCursorToDb(cursor);
}, 10_000);
```

### Python polling loop with cursor

```python
import requests, time

RPC_URL = "https://soroban-testnet.stellar.org"
CONTRACT_ID = "<YOUR_CONTRACT_ID>"

def poll_events(start_ledger: int, cursor: str | None = None) -> str | None:
    params: dict = {
        "filters": [{"type": "contract", "contractIds": [CONTRACT_ID]}],
        "pagination": {"limit": 200},
    }
    if cursor:
        params["pagination"]["cursor"] = cursor
    else:
        params["startLedger"] = start_ledger

    resp = requests.post(
        RPC_URL,
        json={"jsonrpc": "2.0", "id": 1, "method": "getEvents", "params": params},
        headers={"Content-Type": "application/json"},
    )
    events = resp.json()["result"]["events"]

    for event in events:
        process_event(event)  # your processing logic

    return events[-1]["id"] if events else cursor

cursor = load_cursor_from_db()  # None on first run
while True:
    cursor = poll_events(start_ledger=1_000_000, cursor=cursor)
    if cursor:
        save_cursor_to_db(cursor)
    time.sleep(10)
```

### Resumability guidance

- Persist the cursor in a database table (e.g. `indexer_state`) after each successful poll cycle.
- On startup, load the cursor from the database. If none exists, start from a known deployment ledger.
- If the RPC returns an error, back off and retry without advancing the cursor.
- Cursors are opaque strings — do not parse or manipulate them.

```sql
-- Example indexer_state table
CREATE TABLE indexer_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO indexer_state (key, value)
VALUES ('last_event_cursor', '')
ON CONFLICT (key) DO NOTHING;
```

---

## Decoding guide — TypeScript

### Installation

```bash
npm install @stellar/stellar-sdk
```

### Typed event interfaces

```typescript
import { xdr, scValToNative } from "@stellar/stellar-sdk";

export interface SubscribeEvent {
  type: "subscribe";
  subscriber: string;
  merchant: string;
  token: string;
  amount: bigint;
  ledger: number;
  id: string;
}

export interface ExecutedEvent {
  type: "executed";
  subscriber: string;
  merchant: string;
  token: string;
  amount: bigint;
  ledger: number;
  id: string;
}

export interface PaymentTransferFailureEvent {
  type: "payment_transfer_failure";
  subscriber: string;
  merchant: string;
  amount: bigint;
  ledger: number;
  id: string;
}

export interface PaymentTransferSuccessEvent {
  type: "payment_transfer_success";
  subscriber: string;
  merchant: string;
  amount: bigint;
  ledger: number;
  id: string;
}

export interface CancelEvent {
  type: "cancel";
  subscriber: string;
  merchant: string;
  ledger: number;
  id: string;
}

export interface BatchExecuteInitiatedEvent {
  type: "batch_execute_initiated";
  merchant: string;
  batchSize: number;
  ledger: number;
  id: string;
}

export interface LowAllowanceEvent {
  type: "low_allowance";
  subscriber: string;
  merchant: string;
  token: string;
  allowance: bigint;
  required: bigint;
  ledger: number;
  id: string;
}

export type ContractEvent =
  | SubscribeEvent
  | ExecutedEvent
  | PaymentTransferFailureEvent
  | PaymentTransferSuccessEvent
  | CancelEvent
  | BatchExecuteInitiatedEvent
  | LowAllowanceEvent;
```

### Decode a single raw RPC event

```typescript
import { SorobanRpc, xdr, scValToNative } from "@stellar/stellar-sdk";

type RawEvent = SorobanRpc.Api.EventResponse;

export function decodeEvent(raw: RawEvent): ContractEvent | null {
  // topics are already decoded xdr.ScVal[] from the SDK
  const topics = raw.topic;
  if (!topics || topics.length === 0) return null;

  const eventType = scValToNative(topics[0]) as string;
  const ledger = raw.ledger;
  const id = raw.id;

  switch (eventType) {
    case "subscribe":
    case "executed": {
      const [, sub, mer, tok] = topics.map(scValToNative) as string[];
      const amount = BigInt(scValToNative(raw.value));
      return { type: eventType, subscriber: sub, merchant: mer, token: tok, amount, ledger, id };
    }

    case "payment_transfer_failure":
    case "payment_transfer_success": {
      const [, sub, mer] = topics.map(scValToNative) as string[];
      const amount = BigInt(scValToNative(raw.value));
      return { type: eventType, subscriber: sub, merchant: mer, amount, ledger, id };
    }

    case "cancel": {
      const [, sub, mer] = topics.map(scValToNative) as string[];
      return { type: "cancel", subscriber: sub, merchant: mer, ledger, id };
    }

    case "batch_execute_initiated": {
      const [, mer] = topics.map(scValToNative) as string[];
      const batchSize = Number(scValToNative(raw.value));
      return { type: "batch_execute_initiated", merchant: mer, batchSize, ledger, id };
    }

    case "low_allowance": {
      const [, sub, mer, tok] = topics.map(scValToNative) as string[];
      const [allowance, required] = scValToNative(raw.value) as [bigint, bigint];
      return {
        type: "low_allowance",
        subscriber: sub, merchant: mer, token: tok,
        allowance: BigInt(allowance), required: BigInt(required),
        ledger, id,
      };
    }

    default:
      return null;
  }
}
```

### Fetch and decode all events for a contract

```typescript
import { SorobanRpc } from "@stellar/stellar-sdk";
import { decodeEvent, ContractEvent } from "./eventDecoder";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

export async function fetchAllEvents(
  contractId: string,
  startLedger: number,
  cursor?: string,
): Promise<{ events: ContractEvent[]; nextCursor: string | undefined }> {
  const response = await server.getEvents({
    filters: [{ type: "contract", contractIds: [contractId] }],
    limit: 200,
    ...(cursor ? { cursor } : { startLedger }),
  });

  const raw = response.events ?? [];
  const events = raw.map(decodeEvent).filter((e): e is ContractEvent => e !== null);
  const nextCursor = raw.length > 0 ? raw[raw.length - 1].id : cursor;

  return { events, nextCursor };
}

// Usage example
async function main() {
  const contractId = process.env.CONTRACT_ID!;
  let cursor: string | undefined;

  const { events, nextCursor } = await fetchAllEvents(contractId, 1_000_000, cursor);
  cursor = nextCursor;

  for (const event of events) {
    switch (event.type) {
      case "subscribe":
        console.log(`New subscription: ${event.subscriber} → ${event.merchant}, amount: ${event.amount}`);
        break;
      case "executed":
        console.log(`Payment collected: ${event.subscriber} → ${event.merchant}, amount: ${event.amount}`);
        break;
      case "payment_transfer_failure":
        console.warn(`Payment failed: ${event.subscriber} → ${event.merchant}, attempted: ${event.amount}`);
        break;
      case "cancel":
        console.log(`Cancelled: ${event.subscriber} → ${event.merchant}`);
        break;
      case "low_allowance":
        console.warn(`Low allowance: ${event.subscriber} has ${event.allowance}, needs ${event.required}`);
        break;
    }
  }
}
```

### Decode from raw base64 XDR (when working with raw RPC JSON)

```typescript
import { xdr, scValToNative } from "@stellar/stellar-sdk";

// When the RPC response gives you base64-encoded XDR strings
function decodeFromBase64(topicBase64s: string[], valueBase64: string) {
  const topics = topicBase64s.map((t) => xdr.ScVal.fromXDR(t, "base64"));
  const value  = xdr.ScVal.fromXDR(valueBase64, "base64");

  const eventType = scValToNative(topics[0]) as string;
  const amount    = BigInt(scValToNative(value));

  return { eventType, amount };
}
```

---

## Decoding guide — Python

### Installation

```bash
pip install stellar-sdk>=9.0.0
```

### Typed event decoding

```python
from dataclasses import dataclass
from typing import Optional
from stellar_sdk import xdr as stellar_xdr
from stellar_sdk.scval import from_i128, from_address
from stellar_sdk.soroban_server import SorobanServer

@dataclass
class SubscribeEvent:
    event_type: str  # "subscribe"
    subscriber: str
    merchant: str
    token: str
    amount: int
    ledger: int
    event_id: str

@dataclass
class ExecutedEvent:
    event_type: str  # "executed"
    subscriber: str
    merchant: str
    token: str
    amount: int
    ledger: int
    event_id: str

@dataclass
class PaymentFailureEvent:
    event_type: str  # "payment_transfer_failure"
    subscriber: str
    merchant: str
    amount: int
    ledger: int
    event_id: str

@dataclass
class CancelEvent:
    event_type: str  # "cancel"
    subscriber: str
    merchant: str
    ledger: int
    event_id: str


def _scval_to_str(val: stellar_xdr.SCVal) -> str:
    """Extract a symbol or address string from an ScVal."""
    if val.type == stellar_xdr.SCValType.SCV_SYMBOL:
        return val.sym.sc_symbol.decode()
    if val.type == stellar_xdr.SCValType.SCV_ADDRESS:
        addr = val.address
        if addr.type == stellar_xdr.SCAddressType.SC_ADDRESS_TYPE_ACCOUNT:
            from stellar_sdk import Keypair
            return Keypair.from_raw_ed25519_seed(
                addr.account_id.account_id.ed25519.uint256
            ).public_key
        # contract address
        from stellar_sdk import StrKey
        return StrKey.encode_contract(addr.contract_id.hash)
    raise ValueError(f"Unexpected ScVal type: {val.type}")


def _scval_to_i128(val: stellar_xdr.SCVal) -> int:
    """Extract an i128 integer from an ScVal."""
    hi = val.i128.hi.int64
    lo = val.i128.lo.uint64
    return (hi << 64) | lo


def decode_event(raw_event: dict):
    """Decode a raw getEvents response entry into a typed dataclass."""
    topics_xdr = raw_event["topic"]         # list of base64 XDR strings
    value_xdr  = raw_event["value"]["xdr"]  # base64 XDR string
    ledger     = int(raw_event["ledger"])
    event_id   = raw_event["id"]

    topics = [stellar_xdr.SCVal.from_xdr(t) for t in topics_xdr]
    value  = stellar_xdr.SCVal.from_xdr(value_xdr)

    event_type = _scval_to_str(topics[0])

    if event_type in ("subscribe", "executed"):
        subscriber = _scval_to_str(topics[1])
        merchant   = _scval_to_str(topics[2])
        token      = _scval_to_str(topics[3])
        amount     = _scval_to_i128(value)
        if event_type == "subscribe":
            return SubscribeEvent("subscribe", subscriber, merchant, token, amount, ledger, event_id)
        return ExecutedEvent("executed", subscriber, merchant, token, amount, ledger, event_id)

    if event_type == "payment_transfer_failure":
        subscriber = _scval_to_str(topics[1])
        merchant   = _scval_to_str(topics[2])
        amount     = _scval_to_i128(value)
        return PaymentFailureEvent(event_type, subscriber, merchant, amount, ledger, event_id)

    if event_type == "cancel":
        subscriber = _scval_to_str(topics[1])
        merchant   = _scval_to_str(topics[2])
        return CancelEvent("cancel", subscriber, merchant, ledger, event_id)

    return None  # unrecognised event type
```

### Fetch and decode with Python

```python
import requests

def fetch_events(
    contract_id: str,
    start_ledger: int,
    cursor: Optional[str] = None,
    rpc_url: str = "https://soroban-testnet.stellar.org",
) -> tuple[list, Optional[str]]:
    pagination: dict = {"limit": 200}
    if cursor:
        pagination["cursor"] = cursor

    params: dict = {
        "filters": [{"type": "contract", "contractIds": [contract_id]}],
        "pagination": pagination,
    }
    if not cursor:
        params["startLedger"] = start_ledger

    resp = requests.post(
        rpc_url,
        json={"jsonrpc": "2.0", "id": 1, "method": "getEvents", "params": params},
        headers={"Content-Type": "application/json"},
        timeout=30,
    )
    resp.raise_for_status()
    raw_events = resp.json()["result"]["events"]

    decoded = [decode_event(e) for e in raw_events]
    decoded = [e for e in decoded if e is not None]

    next_cursor = raw_events[-1]["id"] if raw_events else cursor
    return decoded, next_cursor


# Usage
contract_id = "CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
events, next_cursor = fetch_events(contract_id, start_ledger=1_000_000)

for event in events:
    if isinstance(event, SubscribeEvent):
        print(f"Subscribe: {event.subscriber[:8]}... → {event.merchant[:8]}..., {event.amount}")
    elif isinstance(event, ExecutedEvent):
        print(f"Executed: {event.subscriber[:8]}... → {event.merchant[:8]}..., {event.amount}")
    elif isinstance(event, PaymentFailureEvent):
        print(f"Failed: {event.subscriber[:8]}... attempted {event.amount}")
    elif isinstance(event, CancelEvent):
        print(f"Cancel: {event.subscriber[:8]}... → {event.merchant[:8]}...")
```

---

## Indexing patterns

### Pull-based polling (recommended)

Poll Soroban RPC on a fixed interval (5–30 seconds). Suitable for most SaaS and merchant dashboard use cases.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Indexer service                                                     │
│                                                                      │
│  1. Load cursor from indexer_state table                            │
│  2. Call getEvents(cursor=<last_cursor>, limit=200)                 │
│  3. Decode events                                                    │
│  4. Persist to: subscriptions | payments | indexer_state tables     │
│  5. Trigger webhooks / emails / analytics                           │
│  6. Save new cursor → sleep 10 s → goto 2                           │
└─────────────────────────────────────────────────────────────────────┘
```

**Pros:** Simple, stateless between restarts, resumable via cursor.  
**Cons:** Up to one polling interval of latency; not suitable for sub-second requirements.

### Event sourcing + CQRS

Maintain an immutable append-only event log and derive multiple read models (projections) from it. Suitable for high-throughput payment streams or complex audit requirements.

```
Events (immutable log)
  ↓
Projections:
  • subscriptions     (current state per subscriber-merchant pair)
  • payment_history   (chronological payment ledger)
  • revenue_analytics (MRR, churn, cohort data)
  • failed_payments   (retry queue)
```

Each projection is a separate read model rebuilt by replaying the event log. This gives you full auditability and the ability to add new projections without touching historical data.

### Recommended PostgreSQL schema

```sql
-- Immutable event log
CREATE TABLE contract_events (
  id              TEXT PRIMARY KEY,          -- RPC event ID (cursor)
  event_type      TEXT NOT NULL,
  subscriber      TEXT,
  merchant        TEXT,
  token           TEXT,
  amount          NUMERIC,
  ledger          BIGINT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Current subscription state projection
CREATE TABLE subscriptions (
  subscriber      TEXT NOT NULL,
  merchant        TEXT NOT NULL,
  token           TEXT,
  amount          NUMERIC,
  status          TEXT NOT NULL DEFAULT 'ACTIVE', -- ACTIVE | CANCELLED | OVERDUE
  last_payment_at TIMESTAMPTZ,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (subscriber, merchant)
);

-- Indexer resume state
CREATE TABLE indexer_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_events_merchant    ON contract_events (merchant, ledger);
CREATE INDEX idx_events_subscriber  ON contract_events (subscriber, ledger);
CREATE INDEX idx_events_type_ledger ON contract_events (event_type, ledger);
```

### Handling `cancel` events

The `cancel` event is the authoritative signal that a subscription has ended. When your indexer sees a `cancel` event:

1. Update `subscriptions.status = 'CANCELLED'` for the `(subscriber, merchant)` pair.
2. Stop scheduling future `execute_payment` calls for this pair.
3. Notify the merchant via webhook (`subscription.cancelled` event type).

```typescript
if (event.type === "cancel") {
  await db.subscriptions.update({
    where: { subscriber_merchant: { subscriber: event.subscriber, merchant: event.merchant } },
    data: { status: "CANCELLED", updatedAt: new Date() },
  });
  await notifyWebhooks({ event: "subscription.cancelled", ...event });
}
```

### Handling `payment_transfer_failure` events

The subscription remains **active** after a failure. Recommended retry strategy:

1. Flag the subscription as `OVERDUE` in your local state.
2. Schedule a retry `execute_payment` after a back-off period (e.g. 24 hours).
3. After N consecutive failures, notify the merchant and optionally the subscriber.

```typescript
if (event.type === "payment_transfer_failure") {
  await db.subscriptions.update({
    where: { subscriber_merchant: { subscriber: event.subscriber, merchant: event.merchant } },
    data: { status: "OVERDUE", updatedAt: new Date() },
  });
  await scheduleRetry(event.subscriber, event.merchant, retryAfterMs: 86_400_000);
}
```

---

## Amount units

All `amount` values in events are in the **token's base unit** (the smallest indivisible unit). For USDC and most SEP-41 tokens on Stellar, this is stroops with 7 decimal places.

| Display amount | Raw amount (`i128`) |
|---------------|-------------------|
| 1.0 USDC | `10_000_000` |
| 9.99 USDC | `99_900_000` |
| 100.00 USDC | `1_000_000_000` |

```typescript
// Convert raw amount to display string (7 decimals)
function formatAmount(raw: bigint, decimals = 7): string {
  const divisor = BigInt(10 ** decimals);
  const whole = raw / divisor;
  const fraction = (raw % divisor).toString().padStart(decimals, "0");
  return `${whole}.${fraction}`;
}

console.log(formatAmount(10_000_000n));  // "1.0000000"
console.log(formatAmount(99_900_000n));  // "9.9900000"
```

```python
def format_amount(raw: int, decimals: int = 7) -> str:
    divisor = 10 ** decimals
    whole, frac = divmod(raw, divisor)
    return f"{whole}.{str(frac).zfill(decimals)}"

print(format_amount(10_000_000))  # "1.0000000"
```

> Always check the token contract's `decimals()` value — non-standard tokens may use a different precision. See [docs/token-decimals.md](token-decimals.md) for full guidance.

---

## Related documentation

- [contract-api.md](contract-api.md) — Full entry point reference and error code table
- [docs/architecture.md](architecture.md) — Event indexing architecture and storage recommendations
- [docs/token-decimals.md](token-decimals.md) — Token decimal handling
- [docs/operations.md](operations.md) — Storage TTL and operational monitoring
