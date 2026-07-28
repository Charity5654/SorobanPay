# SorobanPay — Frequently Asked Questions

This document answers the most common questions from developers integrating SorobanPay into their products. If your question isn't covered here, see the [Contributing](#contributing) section below.

---

## Table of Contents

1. [Can I use SorobanPay without deploying my own contract?](#1-can-i-use-sorobanpay-without-deploying-my-own-contract)
2. [How do I handle a subscriber who revokes their token allowance?](#2-how-do-i-handle-a-subscriber-who-revokes-their-token-allowance)
3. [What happens if the subscriber's account is merged or deleted?](#3-what-happens-if-the-subscribers-account-is-merged-or-deleted)
4. [Can the subscription amount be changed mid-cycle?](#4-can-the-subscription-amount-be-changed-mid-cycle)
5. [How do I migrate subscribers to a new contract version?](#5-how-do-i-migrate-subscribers-to-a-new-contract-version)
6. [What's the minimum XLM balance needed to subscribe?](#6-whats-the-minimum-xlm-balance-needed-to-subscribe)
7. [How does SorobanPay compare to payment channels / state channels?](#7-how-does-sorobanpay-compare-to-payment-channels--state-channels)
8. [Can SorobanPay be used for one-time payments?](#8-can-sorobanpay-be-used-for-one-time-payments)
9. [How do I get notified of payment failures in real time?](#9-how-do-i-get-notified-of-payment-failures-in-real-time)
10. [Is SorobanPay audited?](#10-is-sorobanpay-audited)

---

## 1. Can I use SorobanPay without deploying my own contract?

**No — each deployment is fully independent.** SorobanPay is a protocol, not a hosted service. You must deploy the `SubscriptionProtocol` contract to either Stellar testnet or mainnet to use it.

Deployment takes about two minutes:

```bash
# Testnet (default)
bash deploy/deploy.sh

# Mainnet
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=your-identity bash deploy/deploy.sh
```

The contract address is printed to stdout on success. Paste it into `frontend/.env.local` as `NEXT_PUBLIC_CONTRACT_ID`.

> **Reference:** [README.md → Deployment](../README.md#deployment)

---

## 2. How do I handle a subscriber who revokes their token allowance?

When a subscriber revokes the SEP-41 token allowance granted to the contract (e.g., by calling `token.approve(contract_id, 0)` in their wallet), the next `execute_payment` call will fail with a token transfer error.

**Recommended approach for merchants / backends:**

1. Listen for failed `execute_payment` transactions on-chain (the transaction will fail, not revert silently).
2. Flag the subscription as "allowance revoked" in your backend database.
3. Email or notify the subscriber to re-authorize.
4. Do not retry the payment until a new allowance is detected.

The on-chain subscription record is **not** automatically deleted when an allowance is revoked. The subscription remains in storage and can resume once the subscriber re-grants the allowance and you call `execute_payment` again.

> **Reference:** [README.md → Security model](../README.md#security-model)

---

## 3. What happens if the subscriber's account is merged or deleted?

If a subscriber merges their Stellar account (sends all XLM out and removes the account), subsequent `execute_payment` calls will fail because the source account no longer exists.

- The on-chain subscription record persists until its TTL expires (~365 days from the last successful payment) or until `cancel` is explicitly called.
- Merchants should treat repeated payment failures as an implicit cancellation and stop retrying.
- There is no on-chain event emitted for account merges; detect this condition by catching the failed `execute_payment` transaction and inspecting the Stellar SDK error (`ACCOUNT_NOT_FOUND` or similar result code).

> **Reference:** [README.md → Error codes](../README.md#error-codes)

---

## 4. Can the subscription amount be changed mid-cycle?

**Yes.** Calling `subscribe(subscriber, merchant, token, new_amount, new_interval)` on an existing subscription **overwrites** the stored amount and interval. This behaves as an upsert.

Important caveats:

- The `next_payment` timestamp is **not** reset by an update — the next payment is still due at the original scheduled time.
- Both the subscriber (who must re-sign) and the merchant need to coordinate the change to avoid confusion.
- The new amount takes effect immediately at the next `execute_payment` call.

For SaaS plan upgrades/downgrades, update the subscription at the start of the next billing cycle to keep accounting clean.

> **Reference:** [README.md → Contract entry points](../README.md#contract-entry-points) · [SaaS Integration Guide → Step 4](./saas-integration-guide.md#step-4-handle-plan-upgrades-and-downgrades)

---

## 5. How do I migrate subscribers to a new contract version?

Soroban contracts are currently **not upgradeable in-place** (unless you use the `update_current_contract_wasm` host function in your contract). If you deploy a new contract version at a new address, you must re-onboard subscribers.

**Migration strategy:**

1. Deploy the new contract and record the new `CONTRACT_ID`.
2. Notify subscribers that re-authorization is required (email + in-app prompt).
3. Direct subscribers to sign a `subscribe` transaction on the new contract.
4. Once a subscriber has signed on the new contract, call `cancel` on the old contract to clean up their record (optional — TTL expiry will clean it up automatically otherwise).
5. Decommission the old contract after all subscriptions have migrated or expired.

There is no in-protocol migration path; it requires off-chain coordination.

> **Reference:** [README.md → Deployment](../README.md#deployment)

---

## 6. What's the minimum XLM balance needed to subscribe?

A Stellar account requires a **base reserve** of 1 XLM per account plus 0.5 XLM per ledger entry. On top of that, the subscriber must:

- Hold enough of the **subscription token** to cover the payment amount plus any future SEP-41 allowance.
- Have enough XLM to pay the **transaction fee** (typically 0.00001 XLM, but can spike during congestion — budget 0.001 XLM to be safe).
- Maintain the account minimum reserve (currently 1 XLM base + 0.5 XLM × number of trust lines and offers).

**Practical rule of thumb:** Ensure the subscriber has at least **2 XLM** of free balance plus the token amount they intend to authorize.

> **Reference:** [Stellar docs — Minimum balance](https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/accounts#base-reserves-and-subentries)

---

## 7. How does SorobanPay compare to payment channels / state channels?

| Dimension | SorobanPay | Payment/State Channels |
|-----------|-----------|------------------------|
| **On-chain footprint** | One ledger entry per subscription | Channel open + close transactions |
| **Trust model** | Non-custodial; no counterparty risk | Requires locking funds in channel |
| **Throughput** | One transaction per payment period | High-frequency off-chain messages |
| **Settlement** | Immediate, each payment is final | Requires on-chain close to settle |
| **Suitable for** | SaaS billing, subscriptions, low-frequency recurring payments | Micro-payments, streaming, gaming |

SorobanPay is designed for **low-frequency recurring billing** (daily to yearly). Payment channels are better for high-frequency micro-payment scenarios where submitting every transaction on-chain would be impractical.

---

## 8. Can SorobanPay be used for one-time payments?

Technically yes, but it's not the primary design goal. You can create a subscription with `interval = 86400` (1 day) and then call `cancel` immediately after the first `execute_payment`. This effectively makes a single authorized payment.

However, for true one-time payments you should use the Stellar SDK directly (a standard `payment` operation) — it's simpler and doesn't require the subscriber to grant a token allowance.

SorobanPay's value is in the **recurring authorization** model: one subscriber signature enables many future payments without repeated user interaction.

> **Reference:** [README.md → Contract entry points](../README.md#contract-entry-points)

---

## 9. How do I get notified of payment failures in real time?

SorobanPay emits `subscribe` and `executed` events (see [README.md → Events emitted](../README.md#events-emitted)), but does **not** emit an event for failed payments — a failed `execute_payment` transaction simply does not appear in the event stream.

**Recommended real-time monitoring setup:**

1. Run a **Stellar Horizon webhook** or a custom indexer that streams transactions for your contract address.
2. For successful payments, watch for `executed` events from your contract.
3. For failures, listen for failed transactions that called your contract's `execute_payment` function (the transaction result code will be non-`SUCCESS`).
4. Use a job queue (e.g., BullMQ, SQS) to retry failed payment calls with exponential back-off.

Example: subscribe to events via Horizon streaming:

```js
const server = new StellarSdk.Horizon.Server('https://horizon-testnet.stellar.org');
server
  .transactions()
  .forAccount(CONTRACT_ID)
  .stream({ onmessage: (tx) => console.log(tx) });
```

> **Reference:** [README.md → Events emitted](../README.md#events-emitted) · [SaaS Integration Guide → Step 3](./saas-integration-guide.md#step-3-webhook-setup-for-real-time-payment-notifications)

---

## 10. Is SorobanPay audited?

SorobanPay has not yet undergone a formal third-party security audit. The contract has a comprehensive test suite (unit tests, error-path tests, auth tests, and property-based tests) and follows Soroban security best practices:

- Per-invocation `require_auth()` on every entry point — no stored sessions.
- Non-custodial design — the contract never holds token balances.
- On-chain time-lock prevents early payment collection.
- SEP-41 allowance model gives subscribers a kill-switch independent of the contract.

**Until an audit is completed, use on mainnet at your own risk.** We recommend starting on testnet and performing your own security review before deploying to production.

> **Reference:** [README.md → Security model](../README.md#security-model)

---

## Contributing

Got a question that isn't answered here? We welcome community-submitted questions:

1. **Open a GitHub Discussion** in the [Discussions tab](https://github.com/Chrisland58/SorobanPay/discussions) with the `FAQ` label — your question may be added to this document.
2. **Submit a PR** — edit this file directly and open a pull request. See [README.md → Contributing](../README.md#contributing) for guidelines.
3. **File an issue** with the `documentation` label if you found an inaccurate or missing answer.

All contributions are welcome — the clearer these docs are, the better for everyone integrating SorobanPay.
