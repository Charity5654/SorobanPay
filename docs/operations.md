# SorobanPay — Storage TTL Management Operational Guide

This guide explains how Soroban persistent-storage TTL works within SorobanPay, how to detect at-risk entries before they expire, how to extend TTL programmatically, and how to integrate TTL health checks into your backend monitoring.

---

## 1. TTL Concepts Recap

Soroban persistent storage entries carry a **Time-To-Live (TTL)** measured in **ledger numbers**, not wall-clock time. An entry whose TTL reaches zero is archived (deleted) by the network. Archived entries can be restored, but that requires a separate `restoreFootprint` operation and is far more expensive than keeping the entry alive in the first place.

### Constants

| Constant | Ledgers | Approximate wall-clock time |
|---|---|---|
| `MIN_TTL_LEDGERS` | 518,400 | ~30 days |
| `MAX_TTL_LEDGERS` | 6,307,200 | ~365 days |

These are defined in `contracts/subscription/src/storage.rs`:

```rust
/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;  // 518_400

/// ~365 days at 5-second ledger close time (6_307_200 ledgers)
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;  // 6_307_200
```

> **Assumption**: 5-second average ledger close time. The Stellar network targets this, but actual close times vary slightly. Monitor [Stellar Dashboard](https://dashboard.stellar.org) for live close-time averages.

### How TTL is set in SorobanPay

Every write to persistent storage calls `extend_ttl` with the two constants:

```rust
env.storage()
    .persistent()
    .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
```

This call says: *"If the current TTL is below `MIN_TTL_LEDGERS`, extend it to `MAX_TTL_LEDGERS`."* The effect is:

- A **new** subscription starts with ~365 days of TTL.
- Each successful `execute_payment` resets the clock back to ~365 days.
- An **inactive** subscription — one that has not had a payment collected in over ~335 days (MAX minus MIN) — will not be automatically refreshed and its TTL will fall toward zero.

---

## 2. Detecting At-Risk Entries

### What "at-risk" means

A subscription is at-risk when its remaining TTL ledgers are below the alert threshold:

```
alert_threshold = MIN_TTL_LEDGERS * 1.2  = 518_400 * 1.2 = 622_080 ledgers ≈ 36 days
```

The 20% buffer above `MIN_TTL_LEDGERS` gives operators enough runway to investigate and act before the entry auto-extends (or expires if payment is never triggered).

### Querying TTL via Soroban RPC

Use the `getLedgerEntries` JSON-RPC method. Each response includes a `liveUntilLedgerSeq` field — the last ledger at which the entry is guaranteed to exist.

#### Step 1 — Compute the ledger key

Soroban storage keys are XDR-encoded. For a `DataKey::Subscription(subscriber, merchant)` entry, the key is a `SCVal` of type `SCV_VEC` containing a discriminant and two `SCV_ADDRESS` values.

Use the `stellar-sdk` to build and encode the key:

```javascript
// scripts/check-ttl.mjs
// Usage: node scripts/check-ttl.mjs <subscriber_address> <merchant_address>
//
// Prerequisites:
//   npm install @stellar/stellar-sdk

import { Contract, xdr, SorobanRpc, StrKey, Address } from "@stellar/stellar-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID;

if (!CONTRACT_ID) {
  console.error("ERROR: Set CONTRACT_ID environment variable.");
  process.exit(1);
}

const [, , subscriberArg, merchantArg] = process.argv;

if (!subscriberArg || !merchantArg) {
  console.error("Usage: node scripts/check-ttl.mjs <subscriber> <merchant>");
  process.exit(1);
}

const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

// Build the storage key: DataKey::Subscription(subscriber, merchant)
// This mirrors the Rust enum variant encoding used by Soroban.
function buildSubscriptionKey(contractId, subscriber, merchant) {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Subscription"),
    new Address(subscriber).toScVal(),
    new Address(merchant).toScVal(),
  ]);

  const ledgerKey = xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );

  return ledgerKey.toXDR("base64");
}

async function checkTTL(subscriber, merchant) {
  const keyB64 = buildSubscriptionKey(CONTRACT_ID, subscriber, merchant);

  const response = await server.getLedgerEntries(
    xdr.LedgerKey.fromXDR(keyB64, "base64")
  );

  if (response.entries.length === 0) {
    console.log("No entry found (subscription does not exist or has expired).");
    return null;
  }

  const entry = response.entries[0];
  const latestLedger = response.latestLedger;
  const liveUntil = entry.liveUntilLedgerSeq;
  const remainingLedgers = liveUntil - latestLedger;

  // ~5-second ledger close time
  const remainingSeconds = remainingLedgers * 5;
  const remainingDays = (remainingSeconds / 86400).toFixed(1);

  const MIN_TTL = 518_400;
  const ALERT_THRESHOLD = Math.ceil(MIN_TTL * 1.2); // 622_080

  console.log(`Subscriber:        ${subscriber}`);
  console.log(`Merchant:          ${merchant}`);
  console.log(`Latest ledger:     ${latestLedger}`);
  console.log(`Live until ledger: ${liveUntil}`);
  console.log(`Remaining ledgers: ${remainingLedgers}`);
  console.log(`Remaining (approx):${remainingDays} days`);
  console.log(`Alert threshold:   ${ALERT_THRESHOLD} ledgers (~36 days)`);
  console.log(
    `Status:            ${remainingLedgers < ALERT_THRESHOLD ? "⚠️  AT-RISK" : "✅ OK"}`
  );

  return { remainingLedgers, liveUntil, isAtRisk: remainingLedgers < ALERT_THRESHOLD };
}

checkTTL(subscriberArg, merchantArg).catch((err) => {
  console.error("RPC error:", err.message);
  process.exit(1);
});
```

**Run against testnet:**

```bash
export CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
export RPC_URL=https://soroban-testnet.stellar.org

node scripts/check-ttl.mjs \
  GABC...SUBSCRIBER \
  GDEF...MERCHANT
```

**Example output:**

```
Subscriber:        GABC...SUBSCRIBER
Merchant:          GDEF...MERCHANT
Latest ledger:     5984210
Live until ledger: 6502610
Remaining ledgers: 518400
Remaining (approx):30.0 days
Alert threshold:   622080 ledgers (~36 days)
Status:            ⚠️  AT-RISK
```

### Batch scanning

To scan all subscriptions you track off-chain (e.g., from your event index), pass up to 200 keys per `getLedgerEntries` call:

```javascript
// scripts/batch-ttl-scan.mjs
// Reads a JSON array of {subscriber, merchant} pairs from stdin and reports
// all at-risk entries.
//
// Usage:
//   cat subscriptions.json | node scripts/batch-ttl-scan.mjs

import { xdr, SorobanRpc, Address } from "@stellar/stellar-sdk";
import { createInterface } from "readline";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID;
const ALERT_THRESHOLD = Math.ceil(518_400 * 1.2); // 622_080 ledgers

if (!CONTRACT_ID) {
  console.error("ERROR: Set CONTRACT_ID environment variable.");
  process.exit(1);
}

function buildSubscriptionKey(contractId, subscriber, merchant) {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Subscription"),
    new Address(subscriber).toScVal(),
    new Address(merchant).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

async function main() {
  const lines = [];
  for await (const line of createInterface({ input: process.stdin })) {
    lines.push(line);
  }
  const pairs = JSON.parse(lines.join(""));

  const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

  // getLedgerEntries accepts up to 200 keys; chunk if needed
  const CHUNK = 200;
  const atRisk = [];

  for (let i = 0; i < pairs.length; i += CHUNK) {
    const chunk = pairs.slice(i, i + CHUNK);
    const keys = chunk.map(({ subscriber, merchant }) =>
      buildSubscriptionKey(CONTRACT_ID, subscriber, merchant)
    );
    const response = await server.getLedgerEntries(...keys);
    const latestLedger = response.latestLedger;

    for (const entry of response.entries) {
      const remaining = entry.liveUntilLedgerSeq - latestLedger;
      if (remaining < ALERT_THRESHOLD) {
        atRisk.push({
          liveUntilLedgerSeq: entry.liveUntilLedgerSeq,
          remainingLedgers: remaining,
          remainingDays: ((remaining * 5) / 86400).toFixed(1),
        });
      }
    }
  }

  if (atRisk.length === 0) {
    console.log("All entries healthy.");
  } else {
    console.log(`\n⚠️  ${atRisk.length} at-risk entries:\n`);
    console.table(atRisk);
  }
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
```

---

## 3. Programmatic TTL Extension

The safest way to extend the TTL of an at-risk subscription is to call `subscribe()` with the **same values** that are already stored on-chain. This is a no-op from a business logic standpoint (same amount, token, interval) but it re-runs the `extend_ttl` call inside the contract, resetting the TTL back to `MAX_TTL_LEDGERS` (~365 days).

> **Why not use `extendFootprintTtl` directly?**  
> The Stellar CLI's `contract extend` / `stellar ledger-entry extend` commands can extend TTL without invoking contract logic. This is valid but requires the *subscriber's* authority because persistent storage writes are gated on authorization. Using `subscribe()` is safer because it goes through the same auth checks the contract already enforces, and it does not require any privileged key beyond the subscriber's own.

### Refresh via Stellar CLI

```bash
# Fetch current on-chain values first
stellar contract read \
  --id "$CONTRACT_ID" \
  --key "Subscription(GABC...SUBSCRIBER, GDEF...MERCHANT)" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE"

# Re-call subscribe() with the same values to refresh TTL
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$SUBSCRIBER_IDENTITY" \
  --rpc-url "$RPC_URL" \
  --network-passphrase "$PASSPHRASE" \
  -- subscribe \
  --subscriber "$SUBSCRIBER_ADDRESS" \
  --merchant  "$MERCHANT_ADDRESS" \
  --token     "$TOKEN_ADDRESS" \
  --amount    "$AMOUNT" \
  --interval  "$INTERVAL"
```

### Refresh via JavaScript SDK

```javascript
// scripts/refresh-ttl.mjs
// Reads the current subscription data and re-calls subscribe() with the
// same values to extend TTL to MAX_TTL_LEDGERS (~365 days).
//
// Usage:
//   node scripts/refresh-ttl.mjs <subscriber_address> <merchant_address>
//
// Prerequisites:
//   npm install @stellar/stellar-sdk
//
// Required env vars:
//   CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE
//   SUBSCRIBER_SECRET — signing key for the subscriber account

import {
  Contract,
  Keypair,
  Networks,
  SorobanRpc,
  TransactionBuilder,
  xdr,
  Address,
  nativeToScVal,
  scValToNative,
} from "@stellar/stellar-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID;
const NETWORK_PASSPHRASE =
  process.env.NETWORK_PASSPHRASE ?? Networks.TESTNET;
const SUBSCRIBER_SECRET = process.env.SUBSCRIBER_SECRET;

if (!CONTRACT_ID || !SUBSCRIBER_SECRET) {
  console.error(
    "ERROR: Set CONTRACT_ID and SUBSCRIBER_SECRET environment variables."
  );
  process.exit(1);
}

const [, , subscriberArg, merchantArg] = process.argv;
if (!subscriberArg || !merchantArg) {
  console.error("Usage: node scripts/refresh-ttl.mjs <subscriber> <merchant>");
  process.exit(1);
}

async function refreshTTL(subscriberAddr, merchantAddr) {
  const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  const keypair = Keypair.fromSecret(SUBSCRIBER_SECRET);
  const account = await server.getAccount(keypair.publicKey());

  const contract = new Contract(CONTRACT_ID);

  // Step 1 — Read existing subscription data from on-chain storage
  const keyXdr = buildSubscriptionKey(CONTRACT_ID, subscriberAddr, merchantAddr);
  const { entries } = await server.getLedgerEntries(keyXdr);
  if (entries.length === 0) {
    throw new Error("Subscription not found on-chain.");
  }
  const existing = scValToNative(entries[0].val.contractData().val());
  console.log("Current subscription data:", existing);

  // Step 2 — Build subscribe() call with same values (TTL refresh)
  const tx = new TransactionBuilder(account, {
    fee: "1000000", // 0.1 XLM max fee — adjust per network conditions
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "subscribe",
        new Address(subscriberAddr).toScVal(),
        new Address(merchantAddr).toScVal(),
        new Address(existing.token).toScVal(),
        nativeToScVal(existing.amount, { type: "i128" }),
        nativeToScVal(existing.interval, { type: "u64" })
      )
    )
    .setTimeout(30)
    .build();

  // Step 3 — Simulate to get resource footprint
  const simResult = await server.simulateTransaction(tx);
  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new Error(`Simulation failed: ${simResult.error}`);
  }

  // Step 4 — Assemble, sign, and submit
  const prepared = SorobanRpc.assembleTransaction(tx, simResult).build();
  prepared.sign(keypair);
  const sendResult = await server.sendTransaction(prepared);

  if (sendResult.status === "ERROR") {
    throw new Error(`Send failed: ${JSON.stringify(sendResult.errorResult)}`);
  }

  // Step 5 — Poll for confirmation
  let getResult;
  do {
    await new Promise((r) => setTimeout(r, 2000));
    getResult = await server.getTransaction(sendResult.hash);
  } while (getResult.status === SorobanRpc.Api.GetTransactionStatus.NOT_FOUND);

  if (getResult.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    console.log("✅ TTL refreshed successfully. Hash:", sendResult.hash);
  } else {
    throw new Error(`Transaction failed: ${JSON.stringify(getResult)}`);
  }
}

function buildSubscriptionKey(contractId, subscriber, merchant) {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Subscription"),
    new Address(subscriber).toScVal(),
    new Address(merchant).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}

refreshTTL(subscriberArg, merchantArg).catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
```

---

## 4. Monitoring TTL in Your Backend Health Check

Add a TTL health check endpoint to your backend that queries a representative sample of subscriptions and reports at-risk entries. The example below is an Express middleware pattern, but the concept applies to any backend framework.

```javascript
// backend/health/ttl.js
// Expose as GET /health/ttl
// Returns 200 OK when all monitored entries are healthy,
//         503 Service Unavailable when any are at-risk.

import { xdr, SorobanRpc, Address } from "@stellar/stellar-sdk";

const RPC_URL = process.env.RPC_URL ?? "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID;
const ALERT_THRESHOLD = Math.ceil(518_400 * 1.2); // 622_080 ledgers (~36 days)

/**
 * @param {Array<{subscriber: string, merchant: string}>} subscriptions
 * @returns {Promise<{healthy: boolean, atRisk: Array, latestLedger: number}>}
 */
export async function checkSubscriptionTTLHealth(subscriptions) {
  if (!subscriptions || subscriptions.length === 0) {
    return { healthy: true, atRisk: [], latestLedger: 0 };
  }

  const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });
  const keys = subscriptions.map(({ subscriber, merchant }) =>
    buildSubscriptionKey(CONTRACT_ID, subscriber, merchant)
  );

  const response = await server.getLedgerEntries(...keys.slice(0, 200));
  const { latestLedger, entries } = response;

  const atRisk = entries
    .filter((e) => e.liveUntilLedgerSeq - latestLedger < ALERT_THRESHOLD)
    .map((e) => ({
      liveUntilLedgerSeq: e.liveUntilLedgerSeq,
      remainingLedgers: e.liveUntilLedgerSeq - latestLedger,
      remainingDays: (((e.liveUntilLedgerSeq - latestLedger) * 5) / 86400).toFixed(1),
    }));

  return { healthy: atRisk.length === 0, atRisk, latestLedger };
}

// Express route handler
export async function ttlHealthHandler(req, res) {
  try {
    // In production, load from your subscription database
    const subscriptions = await loadMonitoredSubscriptions();
    const result = await checkSubscriptionTTLHealth(subscriptions);
    const status = result.healthy ? 200 : 503;
    res.status(status).json(result);
  } catch (err) {
    res.status(500).json({ healthy: false, error: err.message });
  }
}

function buildSubscriptionKey(contractId, subscriber, merchant) {
  const key = xdr.ScVal.scvVec([
    xdr.ScVal.scvSymbol("Subscription"),
    new Address(subscriber).toScVal(),
    new Address(merchant).toScVal(),
  ]);
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key,
      durability: xdr.ContractDataDurability.persistent(),
    })
  );
}
```

Add to your health-check cron or uptime monitor to poll `GET /health/ttl` every hour.

---

## 5. Edge Cases

### Yearly subscription TTL refresh cadence

A yearly subscription has `interval = 31_536_000` seconds (exactly `MAX_TTL_LEDGERS * 5` seconds). The payment is due once per year. After each `execute_payment`, the TTL is reset to ~365 days — so the entry stays alive as long as payments are collected on time.

**Risk**: If the merchant does not collect for more than ~335 days (MAX_TTL minus MIN_TTL), the TTL will fall below the alert threshold. At ~30 days remaining it will no longer be auto-extended, and if it hits zero the entry is archived.

**Mitigation**: For yearly subscriptions, schedule a TTL refresh (call `subscribe()` with the same values) at the ~330-day mark if no payment has been collected. This is safe because `subscribe()` only updates `next_payment` if it creates a new entry; an existing entry's `next_payment` is overwritten to `now + interval` — so call it only if the next payment is not due yet and you are purely refreshing TTL.

> ⚠️ **Important**: Calling `subscribe()` on an existing subscription resets `next_payment = now + interval`. If you call it close to when a payment is actually due, this could delay the merchant's ability to collect. Verify `next_payment` before triggering a TTL-only refresh.

### What happens after entry expiry

If a subscription entry's TTL reaches zero:

1. The entry transitions to **archived** state on the Stellar network.
2. Calls to `execute_payment` will return `ContractError::NoActiveSubscription` (the storage `get` returns `None`).
3. Calls to `subscribe()` with the same pair will **recreate** the entry fresh, as if it is a new subscription. `next_payment` is set to `now + interval`, resetting the billing cycle from scratch.
4. The subscriber must re-authorize the new `subscribe()` transaction.

**Recreation path**:
1. Subscriber signs a new `subscribe()` call with the same parameters.
2. Subscriber re-approves the SEP-41 token allowance if it was also expired.
3. Merchant resumes collecting via `execute_payment` after the new `next_payment` window.

---

## 6. Alert Threshold Justification

### Threshold: `MIN_TTL_LEDGERS × 1.2 = 622,080 ledgers ≈ 36 days`

**Rationale:**

- `MIN_TTL_LEDGERS` (518,400 / ~30 days) is the point at which Soroban will auto-extend a live entry back to `MAX_TTL_LEDGERS` on the next write. However, for inactive subscriptions, no write happens unless you explicitly call `subscribe()` or `execute_payment`.
- The 20% buffer (~6 extra days) provides a window to:
  - Receive the alert from your monitoring system.
  - Investigate whether the subscription is legitimately inactive or needs operator action.
  - Execute a TTL refresh transaction and have it confirmed on-chain.
- On testnet, where ledger close times can be faster than 5 seconds, 6 days of buffer is sufficient. On mainnet, 6 days is ample given a typical alert→response SLA of hours.
- Going lower (e.g., 5%) reduces the reaction window to ~1.5 days — too tight for on-call rotations.
- Going higher (e.g., 50%) would alert on entries that are healthy for another ~6 months, creating alert fatigue.

### Recommended alert levels

| Level | Remaining ledgers | Approximate time | Action |
|---|---|---|---|
| `INFO` | < 1,244,160 (~72 days) | Warning: entry inactive for 293+ days | Notify merchant to collect payment |
| `WARN` | < 622,080 (~36 days) | At-risk: no payment collected in ~329+ days | Trigger automated TTL refresh |
| `CRITICAL` | < 103,680 (~6 days) | Imminent expiry | Page on-call, manual intervention |

---

## 7. Stuck or Duplicate Payment Runbook

Use this runbook when a payment request times out, remains pending, appears more than once, or a merchant reports a duplicate. A timeout is not proof that a transaction failed. Do not submit the same payment again until the first transaction has a definitive chain result.

### Contain and preserve evidence

1. Record the network, contract ID, merchant and subscriber public addresses, token, amount, approximate time, request/trace ID, and every known transaction hash. Keep the incident record access-controlled.
2. If automated on-chain submissions are enabled, disable them through the deployment's normal configuration and restart procedure. `PaymentScheduler` and automatic payment retries require `OPERATOR_SECRET`; confirm the startup log reports that scheduling/retries are disabled. Do not print or paste the secret. Keep the indexer and database running so they can continue collecting evidence. Do not delete retry jobs or payment rows as a containment measure.
3. Capture relevant application logs before rotating or changing log settings. In the repository's local Compose setup, inspect the backend/indexer service with:

   ```bash
   docker compose ps
   docker compose logs --since=2h indexer
   ```

   Expected: service state and recent indexer, payment, retry, or reconciliation events. If the service is unavailable, preserve the output and container status, restore database/RPC connectivity, and do not retry payment submission while the result remains unknown.

Never include signing keys, access tokens, webhook secrets, authorization headers, or unredacted request bodies in tickets or shared logs. Retain transaction hashes, ledger numbers, error codes, and correlation IDs; restrict access to raw logs and customer identifiers.

### Establish the chain result

Query the transaction by its hash through the configured Stellar RPC endpoint:

```bash
curl --fail-with-body --silent --show-error \
  --request POST "$RPC_URL" \
  --header 'Content-Type: application/json' \
  --data '{"jsonrpc":"2.0","id":1,"method":"getTransaction","params":{"hash":"<TX_HASH>"}}'
```

Expected: a JSON result with a definitive `SUCCESS` or `FAILED` status and ledger when available. `NOT_FOUND`, a timeout, or an RPC error is inconclusive: retry the read after RPC service recovers and check a second trusted endpoint if configured. Do not interpret absence from the off-chain database as proof that the chain transaction did not execute.

Check whether the backend has persisted a payment and its audit row. This query is read-only; supply the transaction hash locally and do not paste database connection details into incident notes:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "BEGIN READ ONLY; SELECT id, \"txHash\", merchant, subscriber, amount, token, ledger, status, timestamp FROM \"Payment\" WHERE \"txHash\" = '<TX_HASH>'; SELECT id, \"transactionHash\", merchant, subscriber, amount, ledger, status, \"createdAt\" FROM \"AuditLog\" WHERE \"transactionHash\" = '<TX_HASH>'; COMMIT;"
```

Expected: at most one row per table for a transaction hash; the schema makes both transaction-hash columns unique. Zero rows means indexing/audit persistence may be behind, not that payment failed. A query error is not a reason to resubmit: preserve the error code, restore read access, and repeat the read.

The backend reconciliation endpoint compares stored chain events with subscription read-model state; it does not query transaction status or repair `Payment`/`AuditLog` rows. Run its default dry-run only after confirming authorized API access:

```bash
curl --fail-with-body --silent --show-error "$API_URL/api/reconcile?dry_run=true"
```

Expected: JSON with `dry_run: true`, `repairs`, and `errors`. A non-empty `errors` array or HTTP failure needs operator review. Do not use `dry_run=false` as payment recovery; it mutates subscription state only. Do not put bearer tokens into shell history; use the deployment's approved authenticated request mechanism.

### Recover by outcome

| Evidence | Action | Stop condition / recovery |
|---|---|---|
| Transaction is pending, `NOT_FOUND`, or RPC is unavailable | Keep automated submissions paused. Re-query chain status and inspect the transaction's ledger/events after RPC recovers. | Resume only after the transaction is definitively resolved; if status remains ambiguous, escalate to the network/operator on call. |
| Transaction is `SUCCESS` and the expected payment execution is present on-chain | Do not submit again. Let the indexer catch up; compare the transaction hash, ledger, amount, token, and parties in `Payment` and `AuditLog`. | If the indexer remains behind, restore RPC/database connectivity and inspect `docker compose logs --since=2h indexer`; reconcile subscription state separately. Escalate persistent missing payment records for controlled repair. |
| Transaction is `FAILED`, with no successful payment execution | Record the failure and inspect its error/result. Correct the underlying cause before authorizing one retry through the normal payment flow. | If chain evidence conflicts or a payment transfer may have succeeded despite the reported failure, keep retries paused and escalate. |
| Two successful payment transactions charged the same intended installment | Pause further submissions for that subscription, preserve both hashes/ledgers and matching event/audit rows, and notify the merchant through the incident channel. | Do not attempt an automatic reversal or call subscription cancellation a refund. Resolve customer remediation under the merchant's approved refund/credit process, then record the decision and verify no further duplicate is scheduled. |
| Only the webhook was delivered more than once | Deduplicate at the receiver with the stable `X-SorobanPay-Event-ID`; delivery attempt IDs differ. Inspect `WebhookDelivery` by event ID and attempt. | Do not submit another payment. Correct receiver idempotency or endpoint delivery and verify retries stop after a successful response. |

### Closeout checklist

- Confirm the payment scheduler and retry processing are intentionally enabled or disabled, and monitor the next scheduled cycle before closing.
- Reconcile the chain transaction, indexed event, `Payment`, `AuditLog`, and merchant-side receipt. Record unresolved differences with an owner and next review time.
- Preserve the incident timeline, hashes, ledgers, sanitized error codes, and recovery action. Redact credentials, webhook signatures/secrets, and unnecessary personal data.
- Identify the trigger (RPC outage, worker restart, timeout, duplicate job, receiver retry, or indexing lag), assign a corrective action, and verify it using the operational alert/log signal before closing.

## See Also

- [Network Configuration Guide](./networks.md) — testnet vs. mainnet RPC and passphrase values
- [Backend API Cookbook](./api-cookbook.md) — Recipe 8: Monitor subscription TTL health
- `contracts/subscription/src/storage.rs` — TTL constant definitions
- [Soroban RPC getLedgerEntries spec](https://developers.stellar.org/docs/data/rpc/api-reference/methods/getLedgerEntries)
- [Soroban Storage and TTL](https://developers.stellar.org/docs/build/smart-contracts/storage/ttl)

---

## 7. Observability: Logs, Metrics, Traces, and Correlation IDs

This section explains the backend's structured observability stack and how to use it
in production operations. All three signals — logs, metrics, and traces — share the
same `correlationId` so any incident can be correlated across tools.

---

### 7.1 Structured Logging (Pino)

The backend uses [Pino](https://getpino.io) (`backend/src/lib/logger.ts`) to emit
JSON-structured log lines to stdout. Every log record includes:

| Field | Description | Example |
|---|---|---|
| `level` | Severity string | `"info"`, `"warn"`, `"error"` |
| `time` | ISO-8601 timestamp | `"2026-09-30T11:00:00.000Z"` |
| `service` | Fixed label | `"soroban-pay-backend"` |
| `correlationId` | Per-request UUID v4 | `"a1b2c3d4-..."` |
| `event` | Machine-readable event name | `"request.received"` |
| `msg` | Human-readable message | `"GET /subscriptions"` |

#### Log levels

Configure the minimum level with the `LOG_LEVEL` environment variable (default: `info`):

```bash
LOG_LEVEL=debug   # verbose — include all internal trace lines
LOG_LEVEL=info    # default — operational events
LOG_LEVEL=warn    # non-critical problems only
LOG_LEVEL=error   # failures only
```

#### Development pretty-printing

In non-production environments (`NODE_ENV !== "production"`) the logger automatically
loads `pino-pretty` to emit human-readable coloured output:

```
[2026-09-30 11:00:01.000] INFO  (soroban-pay-backend): request.received
  correlationId: "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
  method: "GET"
  path: "/subscriptions/GABC...ALICE"
```

Production containers receive raw JSON:

```json
{
  "level": "info",
  "time": "2026-09-30T11:00:01.000Z",
  "service": "soroban-pay-backend",
  "correlationId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "event": "request.received",
  "method": "GET",
  "path": "/subscriptions/GABC...ALICE"
}
```

#### Sensitive-value redaction

Stellar addresses are redacted to `<first-8>...<last-8>` before they appear in log
output. This prevents accidentally logging full public keys in shared log storage.

The redaction function is in `backend/src/lib/logger.ts`:

```typescript
// Example output: "GABC1234...XYZ56789"
redactAddress("GABC1234XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXYZ56789")
```

Rule: redaction applies to the log fields, not to the HTTP response or database.
The full address is preserved in storage and in API responses.

**What is never logged:**
- Private keys / secrets (none are held server-side)
- JWT tokens — only claims (e.g., `merchantId`) are logged
- Raw `SUBSCRIBER_SECRET` or `WEBHOOK_SECRET` values

---

### 7.2 Correlation IDs

The middleware in `backend/src/middleware/correlationId.ts` runs on every request:

1. Reads `X-Correlation-Id` from the request header. If present, the value is reused
   (allows propagation from an upstream API gateway or client).
2. If the header is absent, a fresh UUID v4 is generated.
3. The correlation ID is attached to `req.id` and to a child Pino logger on `req.log`.
4. The ID is echoed in the `X-Correlation-Id` **response** header.

#### Forwarding from a client

```bash
curl -H "X-Correlation-Id: my-trace-id-1234" \
  https://api.example.com/subscriptions/GABC...
```

```
< X-Correlation-Id: my-trace-id-1234
```

#### Using `req.log` in route handlers

Every route handler should use `req.log` instead of the bare `logger` so the
correlation ID is included automatically:

```typescript
// backend/src/routes/subscriptions.ts (illustrative)
router.get('/:subscriber', async (req, res) => {
  req.log.info({ event: 'subscription.lookup', subscriber: redactAddress(req.params.subscriber) });
  // ...
});
```

#### Finding a request in log output

```bash
# Grep JSON logs by correlationId
docker logs sorobanpay-api | jq 'select(.correlationId == "a1b2c3d4-e5f6-7890-abcd-ef1234567890")'
```

Expected output for a healthy request:

```json
{ "event": "request.received",  "method": "GET", "path": "/subscriptions/...", "correlationId": "a1b2c3d4-..." }
{ "event": "request.finished", "statusCode": 200, "correlationId": "a1b2c3d4-..." }
```

#### Failure recovery

If `X-Correlation-Id` is missing from a client request and the client did not capture
the one echoed in the response header:

1. Note the approximate request timestamp from the client side.
2. Filter logs by `time` range and `path`:
   ```bash
   docker logs sorobanpay-api | jq 'select(.path == "/subscriptions/GABC..." and .event == "request.received")'
   ```
3. The `correlationId` in the matching log line can then be used to trace the full
   request through both log and trace backends.

---

### 7.3 Distributed Tracing (OpenTelemetry)

The backend initialises the OpenTelemetry Node.js SDK in `backend/src/lib/tracing.ts`
before any other module loads. Traces are exported via OTLP HTTP to a configurable
collector (Jaeger, Tempo, etc.).

#### Environment variables

| Variable | Default | Description |
|---|---|---|
| `OTEL_SDK_DISABLED` | `false` | Set to `true` to disable tracing entirely |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://localhost:4318` | OTLP collector endpoint |
| `OTEL_SERVICE_NAME` | `sorobanpay-backend` | Service name in trace UI |
| `OTEL_SAMPLING_RATE` | `1.0` | Fraction of traces sampled (0.0–1.0) |

#### Recommended production settings

```bash
# Kubernetes ConfigMap / docker-compose env section
OTEL_SDK_DISABLED=false
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=sorobanpay-backend
OTEL_SAMPLING_RATE=0.1   # 10% head-based sampling — adjust for traffic volume
```

#### Disabling tracing (zero overhead)

```bash
OTEL_SDK_DISABLED=true
```

The SDK is not started and `withSpan` calls are no-ops. No network connections are
opened. Use this in local development or CI where a collector is not available.

#### Wrapping operations in a custom span

```typescript
import { withSpan, SpanKind } from '../lib/tracing';

// In any backend service
const result = await withSpan(
  'sorobanpay.indexer',
  'indexer.poll',
  async (span) => {
    span.setAttribute('ledger.cursor', cursor);
    return await fetchEventsFromRPC(cursor);
  },
  { kind: SpanKind.CLIENT },
);
```

If the function throws, the span is marked `ERROR`, the exception is recorded, and
the error is re-thrown unchanged.

#### Sampling rate guidance

| Traffic level | Recommended `OTEL_SAMPLING_RATE` |
|---|---|
| Development / CI | `1.0` (capture everything) |
| Staging | `1.0` |
| Production — low (<100 req/s) | `1.0` |
| Production — medium (100–1 000 req/s) | `0.1` |
| Production — high (>1 000 req/s) | `0.01` |

Head-based sampling at `0.1` means 10% of new traces are recorded; spans within
a sampled trace are always recorded in full.

#### Failure recovery — traces not appearing in UI

1. Confirm the collector is reachable:
   ```bash
   curl -v "$OTEL_EXPORTER_OTLP_ENDPOINT/v1/traces"
   # Expected: HTTP 4xx (auth or method not allowed) — not a connection error
   ```
2. Check startup log for the tracing banner:
   ```
   [tracing] OpenTelemetry started — service: sorobanpay-backend, sampling: 0.1, endpoint: http://otel-collector:4318
   ```
   If this line is absent, `OTEL_SDK_DISABLED=true` may be set inadvertently.
3. Raise `OTEL_SAMPLING_RATE` to `1.0` temporarily to rule out sampling.
4. Set `LOG_LEVEL=debug` — the OTLP exporter logs export batches at `debug` level.

---

### 7.4 Metrics

Prometheus metrics are exposed on port `3001` at `/metrics`. The Kubernetes manifests
(`deploy/k8s/`) annotate all pods so Prometheus scrapes them automatically:

```yaml
annotations:
  prometheus.io/scrape: "true"
  prometheus.io/port:   "3001"
  prometheus.io/path:   "/metrics"
```

Key metrics emitted by the backend:

| Metric | Type | Description |
|---|---|---|
| `sorobanpay_rpc_poll_duration_seconds` | Histogram | Time spent polling Soroban RPC per batch |
| `sorobanpay_events_indexed_total` | Counter | Cumulative events indexed by type |
| `sorobanpay_reconciliation_repairs_total` | Counter | Repairs applied per run |
| `sorobanpay_http_request_duration_seconds` | Histogram | HTTP request latency (Express) |
| `process_cpu_seconds_total` | Counter | Node.js process CPU (default prom-client metric) |

To scrape metrics locally:

```bash
# Port-forward the API pod
kubectl port-forward svc/sorobanpay-api 3001:3001 -n sorobanpay
curl http://localhost:3001/metrics
```

Expected output (Prometheus text format):

```
# HELP sorobanpay_events_indexed_total Cumulative events indexed
# TYPE sorobanpay_events_indexed_total counter
sorobanpay_events_indexed_total{type="subscribe"} 142
sorobanpay_events_indexed_total{type="executed"}  89
sorobanpay_events_indexed_total{type="cancel"}    11
```

---

### 7.5 Health Endpoint Semantics

`GET /health` on port `3001` runs two dependency checks:

| Check | What it verifies | Failure behaviour |
|---|---|---|
| Soroban RPC reachability | Calls `getHealth` on the configured RPC URL | Returns `503`; pod not marked ready |
| Contract address resolvability | Calls `getContractData` for `CONTRACT_ID` | Returns `503`; pod not marked ready |

A pod that fails liveness checks is restarted by Kubernetes. A pod that fails
readiness checks is removed from the load balancer pool without restart.

Example healthy response:

```json
{
  "status": "ok",
  "rpc": "reachable",
  "contract": "resolved",
  "version": "1.0.0"
}
```

Example degraded response (`503 Service Unavailable`):

```json
{
  "status": "degraded",
  "rpc": "unreachable",
  "contract": "unknown",
  "error": "connect ECONNREFUSED 127.0.0.1:4318"
}
```

The `error` field in degraded responses does **not** include internal stack traces or
credentials — only the failure reason. Full stack traces are available in the
structured logs under the same request's `correlationId`.

#### Manual health check

```bash
# Testnet — API service
curl -s https://api.example.com/health | jq .

# Port-forward (local / staging)
kubectl port-forward svc/sorobanpay-api 8080:80 -n sorobanpay
curl -s http://localhost:8080/health | jq .
```

---

### 7.6 Grafana Dashboard

The pre-built Grafana dashboard is at `deploy/grafana/sorobanpay-dashboard.json`.
Import it via the Grafana UI:

```
Dashboards → Import → Upload JSON file → select deploy/grafana/sorobanpay-dashboard.json
```

The dashboard surfaces:
- RPC poll latency (p50 / p95 / p99)
- Events indexed per minute by type
- HTTP error rate and latency heatmap
- Reconciliation repair rate
- Pod CPU and memory (requires metrics-server)

---

### See Also

- `backend/src/lib/logger.ts` — logger construction and `redactAddress` helper
- `backend/src/middleware/correlationId.ts` — middleware source
- `backend/src/lib/tracing.ts` — OpenTelemetry SDK initialisation and `withSpan`
- `backend/src/routes/health.ts` — health check implementation
- [Backend API Cookbook](./api-cookbook.md) — recipe examples using `req.log`
- [Kubernetes Deployment](../README.md#kubernetes-deployment-backend-services) — pod annotations and HPA config
