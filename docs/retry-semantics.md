# SorobanPay — execute_payment Retry Semantics

Complete guide for merchants on when and how to retry `execute_payment` after a
failed token transfer or insufficient allowance, including failure taxonomy,
detection methods, retry decision trees, and back-off strategies.

---

## Table of contents

1. [Overview](#overview)
2. [Failure taxonomy](#failure-taxonomy)
   - [Insufficient balance — TransferFailed (error 7)](#insufficient-balance--transferfailed-error-7)
   - [Payment not yet due — PaymentNotDue (error 5)](#payment-not-yet-due--paymentnotdue-error-5)
   - [Revoked allowance — transaction revert](#revoked-allowance--transaction-revert)
   - [No active subscription — NoActiveSubscription (error 4)](#no-active-subscription--noactivesubscription-error-4)
   - [RPC / network errors](#rpc--network-errors)
3. [Detecting failures](#detecting-failures)
   - [Reading the contract error code](#reading-the-contract-error-code)
   - [Listening for payment_transfer_failure events](#listening-for-payment_transfer_failure-events)
4. [Retry decision tree](#retry-decision-tree)
5. [Retry strategies by failure type](#retry-strategies-by-failure-type)
   - [TransferFailed — safe to retry](#transferfailed--safe-to-retry)
   - [PaymentNotDue — do not retry immediately](#paymentnotdue--do-not-retry-immediately)
   - [Revoked allowance — subscriber action required](#revoked-allowance--subscriber-action-required)
   - [NoActiveSubscription — do not retry](#noactivesubscription--do-not-retry)
6. [Recommended back-off schedule](#recommended-back-off-schedule)
7. [Idempotency guarantees](#idempotency-guarantees)
8. [Batch retries with batch_execute_payment](#batch-retries-with-batch_execute_payment)
9. [Implementation examples](#implementation-examples)
   - [TypeScript retry loop](#typescript-retry-loop)
   - [Python retry scheduler](#python-retry-scheduler)
10. [Operational checklist](#operational-checklist)

---

## Overview

`execute_payment(subscriber, merchant)` collects a due recurring payment by
transferring `amount` tokens directly from the subscriber's account to the
merchant's account via the SEP-41 `transfer` call.

The contract enforces these preconditions before transferring:

1. An active subscription must exist for `(subscriber, merchant)`.
2. The current ledger timestamp must be ≥ `next_payment`.
3. The subscriber's on-chain token balance must be ≥ `amount`.

If any precondition fails the transaction either returns a `ContractError` or
reverts entirely (for allowance issues). Crucially, **a failed `execute_payment`
never modifies the subscription state** — `next_payment` is not advanced and
the subscription remains active and collectable. This means every failure mode
listed below is safe to retry once the underlying cause is resolved.

---

## Failure taxonomy

### Insufficient balance — `TransferFailed` (error 7)

**What happens:** The contract reads the subscriber's balance via
`token.balance(subscriber)`. If `balance < amount`, it emits a
`payment_transfer_failure` event and returns `ContractError::TransferFailed`.
No token transfer occurs.

**On-chain state after failure:** Unchanged. `next_payment` is not advanced.
The subscription remains active.

**Retryable?** Yes — once the subscriber's balance is ≥ `amount`.

---

### Payment not yet due — `PaymentNotDue` (error 5)

**What happens:** The contract checks `now < data.next_payment`. If the current
ledger timestamp has not yet reached `next_payment`, the call returns
`ContractError::PaymentNotDue` immediately, before any storage read of token
balance.

**On-chain state after failure:** Unchanged.

**Retryable?** Yes — but not before `next_payment`. Call `get_subscription` to
read the exact `next_payment` Unix timestamp and schedule accordingly.

---

### Revoked allowance — transaction revert

**What happens:** The contract checks the subscriber's balance before calling
`transfer`. However, the balance check only guards against *insufficient balance*
— it does not check the SEP-41 allowance. If the subscriber has revoked the
contract's allowance (`token.approve(contract_id, 0, ...)`) after subscribing
but still has sufficient balance, the `token.transfer` call inside the contract
will panic and the **entire transaction reverts**. Because the panic aborts
execution before any state is written, **no `payment_transfer_failure` event is
emitted** and no `executed` event is emitted.

**On-chain state after failure:** Unchanged (transaction reverted).

**Retryable?** Only after the subscriber re-grants the allowance via
`token.approve(contract_id, amount, ledger_expiry)`. Merchants cannot force this
— they must contact the subscriber.

> **Important distinction:** A revoked-allowance failure looks like a generic
> transaction failure on the RPC level (the `status` will be `FAILED` with an
> XDR result meta), rather than a successful-but-failed contract call that
> emits an event. Use this to distinguish allowance issues from balance issues
> in your off-chain indexer.

---

### No active subscription — `NoActiveSubscription` (error 4)

**What happens:** The contract could not find a subscription record for
`(subscriber, merchant)`. This means:

- The subscriber never called `subscribe()` for this merchant, **or**
- The subscriber called `cancel()`, **or**
- The subscription entry expired (TTL reached zero, ~365 days without activity).

**On-chain state after failure:** Unchanged (no subscription to modify).

**Retryable?** No — not without the subscriber creating a new subscription.

---

### RPC / network errors

These are off-chain failures — the transaction may not have been submitted or
may still be in the mempool.

| Error | Meaning | Action |
|-------|---------|--------|
| `PENDING` | Transaction submitted, not yet confirmed | Poll `getTransaction(hash)` until `SUCCESS` or `FAILED` |
| `ERROR` from `sendTransaction` | Rejected at submission (fee too low, duplicate, etc.) | Inspect `errorResult` XDR; resubmit with corrected fee if appropriate |
| Network timeout | RPC unreachable | Wait and retry the full flow |
| `FAILED` from `getTransaction` | Transaction included in ledger but failed on-chain | Decode `resultMetaXdr` to get the specific `ContractError` |

---

## Detecting failures

### Reading the contract error code

When a Soroban contract call fails on-chain, the transaction is included in a
ledger with `status = FAILED`. The error code is encoded in the `resultMetaXdr`.

```typescript
import { SorobanRpc, xdr } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

const result = await server.getTransaction(txHash);

if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
  const failedResult = result as SorobanRpc.Api.GetFailedTransactionResponse;
  // Inspect the result meta XDR to get the contract error
  console.error("Transaction failed:", failedResult.resultMetaXdr);
}
```

For programmatic parsing, decode the `resultXdr` field:

```typescript
import { xdr } from "@stellar/stellar-sdk";

function extractContractError(resultXdr: string): number | null {
  try {
    const result = xdr.TransactionResult.fromXDR(resultXdr, "base64");
    // Navigate: result.result().results()[0].tr().invokeHostFunctionResult()...
    // The error code is embedded as a contract error in the ScVal
    // For simplicity, inspect the resultMetaXdr string for "error(contract, #N)"
    const match = resultXdr.match(/error\(contract,\s*#(\d+)\)/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}
```

**Contract error code reference:**

| Code | Name | Retryable? |
|------|------|-----------|
| 4 | `NoActiveSubscription` | No — subscription was cancelled or expired |
| 5 | `PaymentNotDue` | Yes — after `next_payment` timestamp |
| 7 | `TransferFailed` | Yes — after subscriber funds their account |
| 8 | `InvalidTimestamp` | Rarely — indicates a ledger timestamp anomaly |

### Listening for `payment_transfer_failure` events

The most reliable way to detect a `TransferFailed` condition is to index
`payment_transfer_failure` events emitted by the contract.

```typescript
import { SorobanRpc } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

const events = await server.getEvents({
  startLedger: failedLedger,
  filters: [
    {
      type: "contract",
      contractIds: [contractId],
      topics: [["payment_transfer_failure"]],
    },
  ],
  limit: 100,
});

for (const event of events.events) {
  const [, subscriber, merchant] = event.topic.map((t) =>
    // scValToNative handles both symbol and address types
    import("@stellar/stellar-sdk").then(({ scValToNative }) => scValToNative(t))
  );
  console.log(`Payment failed: ${subscriber} → ${merchant}`);
}
```

> A `payment_transfer_failure` event means the subscription is still active and
> the balance was insufficient. The absence of this event on a failed transaction
> (status = FAILED, no event) indicates an allowance revocation or a more serious
> contract-level error.

---

## Retry decision tree

```
execute_payment() fails
         │
         ├─► Transaction status = PENDING?
         │         │
         │         └─► Poll getTransaction() until settled ──► continue tree
         │
         ├─► No payment_transfer_failure event emitted AND tx FAILED?
         │         │
         │         └─► Likely revoked allowance
         │                   │
         │                   └─► Contact subscriber to re-grant token allowance
         │                       Do NOT retry until allowance is restored.
         │
         ├─► payment_transfer_failure event emitted (TransferFailed, code 7)?
         │         │
         │         ├─► Is next_payment ≤ now?   YES ─► Retry with back-off
         │         │                             NO  ─► Wait until next_payment, then retry
         │         │
         │         └─► After N consecutive failures ─► Notify merchant; mark OVERDUE
         │
         ├─► Error code 5 (PaymentNotDue)?
         │         │
         │         └─► Read next_payment from get_subscription()
         │             Schedule retry for exactly that timestamp + buffer (e.g. +60s)
         │
         ├─► Error code 4 (NoActiveSubscription)?
         │         │
         │         └─► Subscription cancelled or expired. Do not retry.
         │             Notify merchant. Remove from retry queue.
         │
         └─► RPC / network error?
                   │
                   └─► Retry the full call with exponential back-off.
                       Do not advance retry counter for permanent failures.
```

---

## Retry strategies by failure type

### `TransferFailed` — safe to retry

The subscription is unchanged. The payment window is still open (the contract
will not advance `next_payment` until a successful transfer). You may retry
`execute_payment` at any time after the subscriber funds their account.

**Recommended approach:**

1. Flag the subscription as `OVERDUE` in your local state.
2. Schedule the first retry 24 hours after the initial failure.
3. Use an exponential back-off for subsequent retries (see schedule below).
4. After the configured maximum retry count, stop retrying and notify the merchant.
5. Once the subscriber confirms they have funded their account, trigger an
   immediate out-of-schedule retry.

**What NOT to do:**
- Do not retry every few seconds — Soroban transactions cost real fees even
  when they fail.
- Do not advance your local `next_payment` counter after a failed transfer — the
  on-chain `next_payment` was not advanced.

---

### `PaymentNotDue` — do not retry immediately

The transaction was submitted before the payment window opened. This is a
scheduling error on the merchant side.

**Recommended approach:**

1. Call `get_subscription(subscriber, merchant)` to read the exact `next_payment`
   Unix timestamp.
2. Schedule the retry for `next_payment` + a small buffer (e.g. 60 seconds) to
   account for ledger close time variation.
3. Do not treat this as an error in your monitoring system — it is a normal
   pre-condition check.

```typescript
import { querySubscription } from "@/lib/transaction_builder";

const { subscription } = await querySubscription(
  { subscriber, merchant },
  contractId,
  rpcUrl,
  networkPassphrase,
);

if (subscription) {
  const retryAt = new Date(
    (Number(subscription.next_payment) + 60) * 1000 // +60s buffer
  );
  scheduleRetry(subscriber, merchant, retryAt);
}
```

---

### Revoked allowance — subscriber action required

The merchant cannot unilaterally resolve this. The subscriber must call
`token.approve(contract_id, amount, ledger_expiry)` to re-grant the allowance.

**Recommended approach:**

1. Detect via absence of `payment_transfer_failure` event on a failed transaction.
2. Notify the subscriber via your application's communication channel.
3. Optionally provide a deep-link to the approval UI.
4. Do not retry until you receive confirmation that the allowance has been
   restored (either via a new `low_allowance` event from `subscribe()`, or by
   querying the token contract's `allowance(subscriber, contract_id)` directly).

**Subscriber instructions (example notification copy):**

> Your payment of X tokens to [Merchant] could not be collected because the
> token spending allowance for SorobanPay has been revoked. To restore payments,
> please visit [link] and approve a token allowance of at least X units.

---

### `NoActiveSubscription` — do not retry

The subscription no longer exists on-chain. Possible causes:

- Subscriber called `cancel()`.
- Subscription entry expired (TTL reached zero after ~365 days of inactivity).
- Merchant is using an incorrect `(subscriber, merchant)` pair.

Remove this pair from your retry queue. Notify the merchant. If appropriate,
prompt the subscriber to re-subscribe.

---

## Recommended back-off schedule

| Attempt | Delay after previous failure | Cumulative delay |
|---------|------------------------------|-----------------|
| 1st retry | 24 hours | 24 hours |
| 2nd retry | 48 hours | 72 hours (3 days) |
| 3rd retry | 96 hours | 7 days |
| 4th retry | 7 days | 14 days |
| 5th retry | 14 days | 28 days |
| Give up | — | — |

> Adjust the schedule based on your billing model. For high-value B2B contracts,
> give more retries with longer windows and personal outreach. For low-value
> consumer subscriptions, a shorter window (3 retries over 7 days) may be more
> appropriate.

A safe maximum is **5 retries over 28 days**. Beyond this, the subscriber has
likely intentionally stopped funding their account and the merchant should
cancel the subscription on-chain via `cancel(subscriber, merchant)`.

---

## Idempotency guarantees

`execute_payment` is **naturally idempotent with respect to the payment cycle**.
The contract enforces `now ≥ next_payment` before transferring. Once a payment
is successfully collected, `next_payment` is advanced by `interval` seconds. Any
subsequent retry within that same interval will return `PaymentNotDue` — the
subscriber cannot be double-charged within a single payment cycle.

This means:

- You may safely retry `execute_payment` for the same `(subscriber, merchant)`
  pair multiple times after a `TransferFailed` without risk of double-charging.
- You do **not** need a distributed lock or idempotency key for retries targeting
  the same payment cycle.
- Concurrent retries (e.g. two processes both retrying at the same moment) are
  also safe — only the first successful one will advance `next_payment`; the
  second will return `PaymentNotDue`.

---

## Batch retries with `batch_execute_payment`

`batch_execute_payment(merchant, subscribers)` processes up to 50 subscribers
in a single transaction. Failed subscribers (balance insufficient, not due, etc.)
return `false` in the result vector without aborting the batch. Successful
subscribers return `true`.

**Retry pattern for batch failures:**

```typescript
const results: [string, boolean][] = await executeBatch(merchant, subscribers);

// Partition into success and failure sets
const failed = results
  .filter(([, ok]) => !ok)
  .map(([sub]) => sub);

// Re-check each failed subscriber
for (const sub of failed) {
  const { subscription } = await querySubscription(
    { subscriber: sub, merchant },
    contractId, rpcUrl, networkPassphrase,
  );

  if (!subscription) {
    // No subscription — remove from retry queue
    removeFromQueue(sub, merchant);
  } else if (now >= Number(subscription.next_payment)) {
    // Still due — schedule balance-check and retry
    scheduleRetry(sub, merchant, retryAfter24h);
  } else {
    // Not due yet — schedule for exact window
    scheduleRetry(sub, merchant, new Date(Number(subscription.next_payment) * 1000));
  }
}
```

**Notes:**

- A batch where all subscribers fail is not a contract error — the transaction
  succeeds (returns a Vec of `(Address, false)` entries) and still consumes fees.
- A `TransferFailed` for one subscriber does **not** block other subscribers in
  the same batch.
- Each failed subscriber emits a `payment_transfer_failure` event in the same
  transaction ledger, making batch failures fully auditable.

---

## Implementation examples

### TypeScript retry loop

```typescript
import { buildAndSubmitSubscribe } from "@/lib/transaction_builder";
import { querySubscription }        from "@/lib/transaction_builder";
import { SorobanRpc }               from "@stellar/stellar-sdk";

const RETRY_DELAYS_MS = [
  24 * 60 * 60 * 1000,   // 24 hours
  48 * 60 * 60 * 1000,   // 48 hours
  96 * 60 * 60 * 1000,   // 4 days
  7  * 24 * 60 * 60 * 1000, // 7 days
  14 * 24 * 60 * 60 * 1000, // 14 days
];

interface RetryJob {
  subscriber: string;
  merchant: string;
  attempt: number;
  scheduledAt: Date;
}

async function executeWithRetry(
  job: RetryJob,
  contractId: string,
  rpcUrl: string,
  networkPassphrase: string,
  merchantPublicKey: string,
): Promise<"success" | "give_up" | "rescheduled"> {
  const server = new SorobanRpc.Server(rpcUrl);

  // 1. Check subscription still exists and payment is due
  const { subscription } = await querySubscription(
    { subscriber: job.subscriber, merchant: job.merchant },
    contractId, rpcUrl, networkPassphrase,
  );

  if (!subscription) {
    console.log(`[${job.subscriber}] No active subscription — removing from queue.`);
    return "give_up";
  }

  const now = Math.floor(Date.now() / 1000);
  if (now < Number(subscription.next_payment)) {
    // Not due yet — reschedule for exact window
    const retryAt = new Date(Number(subscription.next_payment) * 1000 + 60_000);
    console.log(`[${job.subscriber}] Not due until ${retryAt.toISOString()}, rescheduling.`);
    scheduleJob({ ...job, scheduledAt: retryAt });
    return "rescheduled";
  }

  // 2. Attempt the payment (merchant must sign)
  try {
    await submitExecutePayment(job.subscriber, job.merchant, contractId, rpcUrl, networkPassphrase, merchantPublicKey);
    console.log(`[${job.subscriber}] Payment collected successfully.`);
    return "success";
  } catch (err: unknown) {
    const msg = String(err);

    if (msg.includes("TransferFailed") || msg.includes("error(contract, #7)")) {
      // Insufficient balance — retry with back-off
      if (job.attempt >= RETRY_DELAYS_MS.length) {
        console.warn(`[${job.subscriber}] Max retries reached. Giving up.`);
        notifyMerchantMaxRetriesExceeded(job.subscriber, job.merchant);
        return "give_up";
      }
      const delay = RETRY_DELAYS_MS[job.attempt];
      const retryAt = new Date(Date.now() + delay);
      console.warn(`[${job.subscriber}] TransferFailed (attempt ${job.attempt + 1}). Retry at ${retryAt.toISOString()}.`);
      scheduleJob({ ...job, attempt: job.attempt + 1, scheduledAt: retryAt });
      return "rescheduled";
    }

    if (msg.includes("NoActiveSubscription") || msg.includes("error(contract, #4)")) {
      console.log(`[${job.subscriber}] Subscription no longer active.`);
      return "give_up";
    }

    // Unexpected error — log and retry once after a short delay
    console.error(`[${job.subscriber}] Unexpected error:`, err);
    scheduleJob({ ...job, attempt: job.attempt + 1, scheduledAt: new Date(Date.now() + 60_000) });
    return "rescheduled";
  }
}

// Stub — replace with your actual job queue (e.g. BullMQ, Temporal)
function scheduleJob(job: RetryJob): void { /* ... */ }
function notifyMerchantMaxRetriesExceeded(subscriber: string, merchant: string): void { /* ... */ }
async function submitExecutePayment(...args: unknown[]): Promise<void> { /* ... */ }
```

---

### Python retry scheduler

```python
import time
import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta

log = logging.getLogger(__name__)

RETRY_DELAYS = [
    timedelta(hours=24),
    timedelta(hours=48),
    timedelta(days=4),
    timedelta(days=7),
    timedelta(days=14),
]

@dataclass
class RetryJob:
    subscriber: str
    merchant: str
    attempt: int = 0
    scheduled_at: datetime = field(default_factory=datetime.utcnow)


def execute_with_retry(job: RetryJob, contract_client) -> str:
    """
    Returns: "success" | "give_up" | "rescheduled"
    """
    # 1. Check subscription
    sub = contract_client.get_subscription(job.subscriber, job.merchant)
    if sub is None:
        log.info("[%s] No active subscription — removing from queue.", job.subscriber[:8])
        return "give_up"

    now = int(time.time())
    if now < sub["next_payment"]:
        retry_at = datetime.utcfromtimestamp(sub["next_payment"]) + timedelta(seconds=60)
        log.info("[%s] Not due until %s, rescheduling.", job.subscriber[:8], retry_at)
        schedule_job(RetryJob(job.subscriber, job.merchant, job.attempt, retry_at))
        return "rescheduled"

    # 2. Attempt payment
    try:
        contract_client.execute_payment(job.subscriber, job.merchant)
        log.info("[%s] Payment collected.", job.subscriber[:8])
        return "success"

    except ContractError as err:
        if err.code == 7:  # TransferFailed
            if job.attempt >= len(RETRY_DELAYS):
                log.warning("[%s] Max retries reached.", job.subscriber[:8])
                notify_merchant_max_retries(job.subscriber, job.merchant)
                return "give_up"
            delay = RETRY_DELAYS[job.attempt]
            retry_at = datetime.utcnow() + delay
            log.warning("[%s] TransferFailed (attempt %d). Retry at %s.",
                        job.subscriber[:8], job.attempt + 1, retry_at)
            schedule_job(RetryJob(job.subscriber, job.merchant, job.attempt + 1, retry_at))
            return "rescheduled"

        if err.code == 4:  # NoActiveSubscription
            log.info("[%s] Subscription cancelled.", job.subscriber[:8])
            return "give_up"

        if err.code == 5:  # PaymentNotDue
            # Timing race — reschedule
            sub = contract_client.get_subscription(job.subscriber, job.merchant)
            if sub:
                retry_at = datetime.utcfromtimestamp(sub["next_payment"]) + timedelta(seconds=60)
                schedule_job(RetryJob(job.subscriber, job.merchant, job.attempt, retry_at))
            return "rescheduled"

        raise  # re-raise unexpected errors


class ContractError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code


def schedule_job(job: RetryJob) -> None:
    pass  # replace with your job queue (Celery, APScheduler, etc.)


def notify_merchant_max_retries(subscriber: str, merchant: str) -> None:
    pass  # replace with your notification system
```

---

## Operational checklist

Before shipping a payment executor to production, verify the following:

- [ ] **Event indexing:** Subscribe to `payment_transfer_failure` events. This is
  your primary signal for insufficent-balance failures.
- [ ] **Back-off queue:** Implement a persistent retry queue (not in-memory) so
  jobs survive process restarts.
- [ ] **Max retries:** Set a hard cap (recommended: 5) and alert the merchant when
  reached.
- [ ] **Pre-flight check:** Call `get_subscription` before each retry attempt to
  confirm the subscription is still active and the payment is due.
- [ ] **Fee simulation:** Run `simulateTransaction` before submitting to get exact
  resource fees. Avoid hardcoding fee values.
- [ ] **Allowance monitoring:** Listen for `low_allowance` events from `subscribe()`
  to proactively warn subscribers before their first payment.
- [ ] **Idempotency awareness:** Do not use a distributed lock for retries within
  the same payment cycle — the contract prevents double-charging natively.
- [ ] **Notification escalation:** After 2 consecutive `TransferFailed`, notify
  the merchant. After reaching max retries, notify both merchant and subscriber.
- [ ] **Cancellation on max retries:** Consider calling `cancel(subscriber, merchant)`
  after exhausting retries so the ledger entry doesn't linger. Confirm this with
  your business logic first.
- [ ] **Ledger timestamp variance:** Add a 60-second buffer when scheduling based
  on `next_payment` to account for ledger close time variance.

---

## Related documentation

- [contract-api.md](contract-api.md) — Full entry point reference and error codes
- [event-schema.md](event-schema.md) — Event payload schemas including `payment_transfer_failure`
- [events.md](events.md) — RPC query examples and event indexing patterns
- [docs/operations.md](operations.md) — Storage TTL and subscription health monitoring
