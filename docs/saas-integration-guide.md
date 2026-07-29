# SorobanPay — SaaS Integration Guide

This guide shows SaaS founders and developers how to wire SorobanPay into a production SaaS stack: user management, access provisioning, invoicing, plan changes, cancellations, and revenue reporting — all driven by on-chain subscription events.

> **Prerequisites:** You have read [README.md](../README.md) and understand the basic contract interface. This guide assumes Node.js ≥ 18 for code examples.

---

## Table of Contents

- [Conceptual Overview](#conceptual-overview)
- [Step 1: Deploy the Contract and Configure the Frontend](#step-1-deploy-the-contract-and-configure-the-frontend)
- [Step 2: Integrate the Backend Indexer for Event-Driven Access Provisioning](#step-2-integrate-the-backend-indexer-for-event-driven-access-provisioning)
- [Step 3: Webhook Setup for Real-Time Payment Notifications](#step-3-webhook-setup-for-real-time-payment-notifications)
- [Step 4: Handle Plan Upgrades and Downgrades](#step-4-handle-plan-upgrades-and-downgrades)
- [Step 5: Handle Cancellations and Service Termination](#step-5-handle-cancellations-and-service-termination)
- [Step 6: Revenue Reporting and Accounting Exports](#step-6-revenue-reporting-and-accounting-exports)

---

## Conceptual Overview

SorobanPay maps to traditional SaaS billing primitives as follows:

| Traditional SaaS concept | SorobanPay equivalent |
|--------------------------|----------------------|
| **Plan** (price + billing period) | `amount` + `interval` in the subscription |
| **Customer** | `subscriber` — a Stellar public key (G…) |
| **Merchant / vendor** | `merchant` — your product's Stellar public key |
| **Invoice** | An `executed` event emitted when `execute_payment` succeeds |
| **Subscription status** | Presence/absence of a storage entry for `(subscriber, merchant)` |
| **Trial period** | Not natively supported; implement by delaying the first `execute_payment` call |
| **Proration** | Not supported on-chain; handle in your backend when changing plans |
| **Dunning** | Retry logic in your backend when `execute_payment` fails |

**Key difference from Stripe:** There is no centralized billing engine. Your backend must call `execute_payment` at the right time — the contract enforces the interval, but it will not auto-collect.

---

## Step 1: Deploy the Contract and Configure the Frontend

### 1.1 Deploy the contract

```bash
# Build
make build

# Deploy to testnet first — validate your integration before touching mainnet
bash deploy/deploy.sh

# For mainnet:
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=your-prod-identity bash deploy/deploy.sh
```

Record the contract address printed to stdout.

### 1.2 Configure frontend environment

Create `frontend/.env.local` (or set these in your hosting platform's secrets panel):

```env
# Testnet
NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Mainnet — replace all three values
# NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
# NEXT_PUBLIC_RPC_URL=https://soroban-mainnet.stellar.org
# NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

### 1.3 Embed the subscription widget

The simplest integration: embed the SorobanPay frontend in an iframe or link to your hosted instance from your product's billing page. When a user clicks "Subscribe", they are taken to the SorobanPay UI, they sign with Freighter, and an `executed` event is emitted on-chain that your backend indexer picks up.

For deeper customization, use the Stellar SDK directly in your own frontend (see Step 2 for SDK usage patterns).

---

## Step 2: Integrate the Backend Indexer for Event-Driven Access Provisioning

Your backend must listen for on-chain `subscribe` and `executed` events and translate them into access grants in your database.

### 2.1 Install dependencies

```bash
npm install @stellar/stellar-sdk
```

### 2.2 Event schema

| Contract event | Topics | Data | Your action |
|---------------|--------|------|-------------|
| `subscribe` | `[symbol("subscribe"), subscriber, merchant]` | `amount: i128` | Create or update subscription record; grant access |
| `executed` | `[symbol("executed"), subscriber, merchant]` | `amount: i128` | Record payment, extend access expiry |

### 2.3 Indexer implementation

```js
// indexer.js
import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = process.env.STELLAR_RPC_URL || "https://soroban-testnet.stellar.org";
const CONTRACT_ID = process.env.CONTRACT_ID;
const server = new StellarSdk.SorobanRpc.Server(RPC_URL);

/**
 * Poll for new contract events starting from a given ledger.
 * In production, persist `startLedger` in your database and resume from it
 * on restart so you don't miss events during downtime.
 */
async function pollEvents(startLedger) {
  const response = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [CONTRACT_ID],
        topics: [
          // Match both "subscribe" and "executed" events
          ["AAAADwAAAAlzdWJzY3JpYmU="], // XDR: symbol("subscribe")
          ["AAAADwAAAAhleGVjdXRlZA=="],  // XDR: symbol("executed")
        ],
      },
    ],
    pagination: { limit: 100 },
  });

  for (const event of response.events) {
    await handleEvent(event);
  }

  // Return the latest ledger so the caller can resume from here
  return response.latestLedger;
}

async function handleEvent(event) {
  const topics = event.topic.map((t) => StellarSdk.scValToNative(t));
  const data = StellarSdk.scValToNative(event.value);

  const [eventName, subscriber, merchant] = topics;

  if (eventName === "subscribe") {
    console.log(`New subscription: ${subscriber} → ${merchant}, amount=${data}`);
    await db.upsertSubscription({ subscriber, merchant, amount: data });
    await provisionAccess(subscriber);
  }

  if (eventName === "executed") {
    console.log(`Payment executed: ${subscriber} → ${merchant}, amount=${data}`);
    await db.recordPayment({ subscriber, merchant, amount: data, ledger: event.ledger });
    await extendAccess(subscriber);
  }
}

/**
 * Grant the subscriber access to your product.
 * Replace this with your own database / access-control logic.
 */
async function provisionAccess(subscriberAddress) {
  // e.g., set user.subscription_active = true WHERE stellar_address = subscriberAddress
  console.log(`Provisioning access for ${subscriberAddress}`);
}

/**
 * Extend the subscriber's access window after a successful payment.
 */
async function extendAccess(subscriberAddress) {
  const newExpiry = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // +30 days
  console.log(`Extending access for ${subscriberAddress} until ${newExpiry.toISOString()}`);
}

// Main polling loop — run as a long-lived process
async function main() {
  let currentLedger = await getLastProcessedLedger(); // load from DB on startup
  console.log(`Starting indexer from ledger ${currentLedger}`);

  while (true) {
    try {
      currentLedger = await pollEvents(currentLedger);
      await saveLastProcessedLedger(currentLedger); // persist so we can resume
    } catch (err) {
      console.error("Indexer error:", err.message);
    }
    await new Promise((resolve) => setTimeout(resolve, 5000)); // poll every 5 seconds
  }
}

main();
```

### 2.4 Calling `execute_payment` from your backend

Your backend (merchant) is responsible for triggering payment collection when the interval elapses.

```js
// payment-collector.js
import * as StellarSdk from "@stellar/stellar-sdk";

const RPC_URL = process.env.STELLAR_RPC_URL;
const CONTRACT_ID = process.env.CONTRACT_ID;
const MERCHANT_SECRET = process.env.MERCHANT_SECRET_KEY; // stored in secret manager
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE;

const server = new StellarSdk.SorobanRpc.Server(RPC_URL);
const merchantKeypair = StellarSdk.Keypair.fromSecret(MERCHANT_SECRET);

/**
 * Attempt to collect a subscription payment.
 * Returns the transaction hash on success, throws on failure.
 */
async function collectPayment(subscriberAddress, merchantAddress) {
  const account = await server.getAccount(merchantKeypair.publicKey());

  const contract = new StellarSdk.Contract(CONTRACT_ID);
  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "execute_payment",
        StellarSdk.nativeToScVal(subscriberAddress, { type: "address" }),
        StellarSdk.nativeToScVal(merchantAddress, { type: "address" })
      )
    )
    .setTimeout(30)
    .build();

  const preparedTx = await server.prepareTransaction(tx);
  preparedTx.sign(merchantKeypair);

  const result = await server.sendTransaction(preparedTx);

  if (result.status === "PENDING") {
    // Poll for confirmation
    let txResult;
    for (let i = 0; i < 10; i++) {
      await new Promise((r) => setTimeout(r, 3000));
      txResult = await server.getTransaction(result.hash);
      if (txResult.status !== "NOT_FOUND") break;
    }
    if (txResult?.status === "SUCCESS") return result.hash;
    throw new Error(`Transaction failed: ${txResult?.status}`);
  }

  throw new Error(`Submission failed: ${result.status}`);
}

export { collectPayment };
```

---

## Step 3: Webhook Setup for Real-Time Payment Notifications

Deliver payment events to your application via HTTP webhooks so your backend can react in real time without polling.

### 3.1 Webhook dispatcher

```js
// webhook-dispatcher.js
import crypto from "crypto";
import fetch from "node-fetch";

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

/**
 * Sign and deliver a webhook payload to a registered endpoint.
 */
async function deliverWebhook(endpoint, eventType, payload) {
  const body = JSON.stringify({ event: eventType, data: payload, timestamp: Date.now() });
  const signature = crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-SorobanPay-Signature": `sha256=${signature}`,
      "X-SorobanPay-Event": eventType,
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Webhook delivery failed: ${response.status} ${await response.text()}`);
  }

  return response;
}

export { deliverWebhook };
```

### 3.2 Webhook event types

| Event type | Trigger | Payload fields |
|-----------|---------|---------------|
| `subscription.created` | `subscribe` contract event | `subscriber`, `merchant`, `amount`, `interval`, `ledger` |
| `payment.succeeded` | `executed` contract event | `subscriber`, `merchant`, `amount`, `txHash`, `ledger` |
| `payment.failed` | Failed `execute_payment` call | `subscriber`, `merchant`, `errorCode`, `ledger` |
| `subscription.cancelled` | `cancel` contract event | `subscriber`, `merchant`, `ledger` |

### 3.3 Receiving and verifying webhooks (Express.js)

```js
// webhook-receiver.js (on your customer's server)
import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());

const WEBHOOK_SECRET = process.env.SOROBANPAY_WEBHOOK_SECRET;

function verifySignature(body, signature) {
  const expected = "sha256=" + crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

app.post("/webhooks/sorobanpay", express.raw({ type: "application/json" }), (req, res) => {
  const signature = req.headers["x-sorobanpay-signature"];
  if (!verifySignature(req.body, signature)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  const { event, data } = JSON.parse(req.body);

  switch (event) {
    case "payment.succeeded":
      console.log(`Payment received from ${data.subscriber}: ${data.amount}`);
      // Grant access, send receipt email, etc.
      break;
    case "payment.failed":
      console.log(`Payment failed for ${data.subscriber}: error ${data.errorCode}`);
      // Notify subscriber, suspend access, etc.
      break;
    case "subscription.cancelled":
      console.log(`Subscription cancelled by ${data.subscriber}`);
      // Revoke access, send cancellation confirmation
      break;
  }

  res.status(200).json({ received: true });
});

app.listen(3000);
```

---

## Step 4: Handle Plan Upgrades and Downgrades

Plan changes in SorobanPay are implemented by calling `subscribe` again with the new `amount` and/or `interval`. The contract treats this as an upsert on the existing subscription record.

### 4.1 Upgrade flow (subscriber pays more)

```js
// plan-change.js
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Update a subscription's plan by calling subscribe() with new parameters.
 * The subscriber must sign this transaction.
 *
 * @param {string} subscriberAddress - The subscriber's public key
 * @param {string} merchantAddress - The merchant's public key
 * @param {string} tokenAddress - The SEP-41 token contract address
 * @param {number} newAmount - New payment amount in token base units
 * @param {number} newInterval - New interval in seconds
 */
async function updateSubscription(
  subscriberAddress,
  merchantAddress,
  tokenAddress,
  newAmount,
  newInterval,
  { rpcUrl, contractId, networkPassphrase }
) {
  const server = new StellarSdk.SorobanRpc.Server(rpcUrl);
  const account = await server.getAccount(subscriberAddress);
  const contract = new StellarSdk.Contract(contractId);

  const tx = new StellarSdk.TransactionBuilder(account, {
    fee: StellarSdk.BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        "subscribe",
        StellarSdk.nativeToScVal(subscriberAddress, { type: "address" }),
        StellarSdk.nativeToScVal(merchantAddress, { type: "address" }),
        StellarSdk.nativeToScVal(tokenAddress, { type: "address" }),
        StellarSdk.nativeToScVal(newAmount, { type: "i128" }),
        StellarSdk.nativeToScVal(newInterval, { type: "u64" })
      )
    )
    .setTimeout(30)
    .build();

  const prepared = await server.prepareTransaction(tx);
  const xdr = prepared.toXDR();

  // Return the XDR so the subscriber can sign it via Freighter
  return xdr;
}

// Example: upgrade from $10/month (30 days) to $20/month
const xdr = await updateSubscription(
  subscriberPublicKey,
  merchantPublicKey,
  usdcContractAddress,
  20_000_000,  // $20 in USDC (7 decimal places)
  2_592_000,   // 30 days in seconds
  { rpcUrl, contractId, networkPassphrase }
);

// Send xdr to the frontend for Freighter signing
```

### 4.2 Important notes on plan changes

- The `next_payment` timestamp is **not reset** by a plan update — the next collection happens on the original schedule.
- For upgrades, some SaaS platforms charge a prorated amount immediately. Implement this as a separate one-off payment via the Stellar SDK (`payment` operation), not via the subscription contract.
- For downgrades, apply the new amount at the start of the next billing cycle to avoid confusion.

---

## Step 5: Handle Cancellations and Service Termination

Cancellations can be initiated by the subscriber (on-chain `cancel` call) or by your platform (e.g., for non-payment).

### 5.1 Subscriber-initiated cancellation

The subscriber calls `cancel(subscriber, merchant)` on the contract — this removes the subscription storage entry. Your indexer detects the absence of future `executed` events or listens for the transaction.

```js
// Detect cancellation by watching for cancel() calls to your contract
// (There is no explicit "cancelled" event in the current contract — 
//  detect by polling the subscription storage or monitoring for cancel() calls)

async function checkSubscriptionActive(subscriberAddress, merchantAddress) {
  // If execute_payment returns error code 4 (NoActiveSubscription),
  // the subscription has been cancelled
  try {
    // Simulate the call (read-only simulation, does not submit)
    const server = new StellarSdk.SorobanRpc.Server(rpcUrl);
    const account = await server.getAccount(merchantKeypair.publicKey());
    const contract = new StellarSdk.Contract(contractId);

    const tx = new StellarSdk.TransactionBuilder(account, { fee: "100", networkPassphrase })
      .addOperation(
        contract.call(
          "execute_payment",
          StellarSdk.nativeToScVal(subscriberAddress, { type: "address" }),
          StellarSdk.nativeToScVal(merchantAddress, { type: "address" })
        )
      )
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);
    // If simulation succeeds (or returns PaymentNotDue), subscription is active
    return true;
  } catch (err) {
    if (err.message?.includes("NoActiveSubscription")) return false;
    throw err;
  }
}
```

### 5.2 Platform-initiated service termination

```js
// service-terminator.js

/**
 * Revoke a user's access when their subscription lapses.
 * Call this when execute_payment repeatedly fails or subscription is cancelled.
 */
async function terminateService(subscriberAddress, reason) {
  console.log(`Terminating service for ${subscriberAddress}: ${reason}`);

  // 1. Mark the user inactive in your database
  await db.setUserInactive(subscriberAddress, { reason });

  // 2. Send termination email
  await email.send({
    to: await db.getUserEmail(subscriberAddress),
    subject: "Your SorobanPay subscription has ended",
    body: `Your subscription was terminated: ${reason}. Resubscribe at any time to restore access.`,
  });

  // 3. Revoke API keys, sessions, etc.
  await auth.revokeAllSessions(subscriberAddress);
}

// Grace period: give subscribers N days after a failed payment before terminating
async function handlePaymentFailure(subscriberAddress, failureCount) {
  const GRACE_PERIOD_DAYS = 3;
  const MAX_RETRIES = 3;

  if (failureCount >= MAX_RETRIES) {
    await terminateService(subscriberAddress, "payment_failed_max_retries");
  } else {
    const nextRetry = new Date(Date.now() + 24 * 60 * 60 * 1000); // retry tomorrow
    await db.schedulePaymentRetry(subscriberAddress, nextRetry, failureCount + 1);
    // Optionally warn the subscriber after the first failure
    if (failureCount === 1) {
      await email.send({
        to: await db.getUserEmail(subscriberAddress),
        subject: "Payment issue — action required",
        body: `We couldn't collect your subscription payment. Please check your wallet allowance. We'll retry in ${GRACE_PERIOD_DAYS} days.`,
      });
    }
  }
}
```

---

## Step 6: Revenue Reporting and Accounting Exports

### 6.1 Building a revenue ledger from events

Every `executed` event is your invoice. Build a revenue ledger by persisting each event with its ledger timestamp.

```js
// revenue-reporter.js
import * as StellarSdk from "@stellar/stellar-sdk";

/**
 * Fetch all executed payment events for a date range and aggregate revenue.
 */
async function getRevenueReport(startLedger, endLedger, merchantAddress) {
  const server = new StellarSdk.SorobanRpc.Server(process.env.STELLAR_RPC_URL);

  const events = await server.getEvents({
    startLedger,
    filters: [
      {
        type: "contract",
        contractIds: [process.env.CONTRACT_ID],
        topics: [["AAAADwAAAAhleGVjdXRlZA==", "*", merchantAddress]],
      },
    ],
    pagination: { limit: 200 },
  });

  const payments = events.events.map((e) => {
    const [, subscriber] = e.topic.map((t) => StellarSdk.scValToNative(t));
    const amount = StellarSdk.scValToNative(e.value);
    return {
      subscriber,
      amount: Number(amount),
      ledger: e.ledger,
      txHash: e.txHash,
      // Convert ledger close time to Date (approximate: each ledger ≈ 5 seconds)
      timestamp: new Date(e.ledgerClosedAt),
    };
  });

  const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
  const uniqueSubscribers = new Set(payments.map((p) => p.subscriber)).size;

  return {
    period: { startLedger, endLedger },
    totalRevenue,
    uniqueSubscribers,
    paymentCount: payments.length,
    payments,
  };
}

// Example usage:
const report = await getRevenueReport(100000, 200000, merchantPublicKey);
console.log(`Revenue: ${report.totalRevenue} | Subscribers: ${report.uniqueSubscribers}`);
```

### 6.2 CSV export for accounting

```js
/**
 * Export payments to CSV for import into accounting software (QuickBooks, Xero, etc.)
 */
function exportToCSV(payments) {
  const header = "date,subscriber,amount,txHash,ledger\n";
  const rows = payments.map((p) =>
    [
      p.timestamp.toISOString(),
      p.subscriber,
      p.amount,
      p.txHash,
      p.ledger,
    ].join(",")
  );
  return header + rows.join("\n");
}

// Write to file
import fs from "fs";
const { payments } = await getRevenueReport(startLedger, endLedger, merchantPublicKey);
fs.writeFileSync("revenue-export.csv", exportToCSV(payments));
console.log("Exported to revenue-export.csv");
```

### 6.3 Monthly recurring revenue (MRR) calculation

```js
/**
 * Calculate MRR from active subscriptions.
 * Normalizes all subscription intervals to a monthly equivalent.
 */
function calculateMRR(activeSubscriptions) {
  const SECONDS_PER_MONTH = 2_592_000; // 30 days

  return activeSubscriptions.reduce((mrr, sub) => {
    // Monthly amount = amount × (seconds_per_month / interval)
    const monthlyAmount = sub.amount * (SECONDS_PER_MONTH / sub.interval);
    return mrr + monthlyAmount;
  }, 0);
}

// Example: load active subscriptions from your DB
const subs = await db.getActiveSubscriptions(merchantPublicKey);
const mrr = calculateMRR(subs);
console.log(`Current MRR: ${mrr} token units`);
```

---

## References

- [README.md → Architecture](../README.md#architecture)
- [README.md → Contract entry points](../README.md#contract-entry-points)
- [README.md → Security model](../README.md#security-model)
- [README.md → Events emitted](../README.md#events-emitted)
- [docs/deployment.md](./deployment.md) — Full production deployment guide
- [docs/faq.md](./faq.md) — Frequently asked questions
- [Stellar SDK documentation](https://stellar.github.io/js-stellar-sdk/)
- [Soroban RPC getEvents](https://developers.stellar.org/docs/data/rpc/api-reference/methods/getEvents)
