# SorobanPay Frontend

Next.js frontend for the SorobanPay recurring-payment protocol on Stellar/Soroban.

## Table of Contents

- [Quick start](#quick-start)
- [Environment variables](#environment-variables)
- [Transaction builder interface](#transaction-builder-interface)
  - [How `buildAndSubmitSubscribe` works](#how-buildandsubmitsubscribe-works)
  - [Two-phase flow (recommended)](#two-phase-flow-recommended)
  - [Legacy all-in-one flow](#legacy-all-in-one-flow)
  - [Other exported builders](#other-exported-builders)
  - [How to extend the builder](#how-to-extend-the-builder)
- [Component overview](#component-overview)
- [Running tests](#running-tests)

---

## Quick start

```bash
cd frontend
cp .env.example .env.local   # fill in CONTRACT_ID, RPC_URL, etc.
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and connect your Freighter wallet.

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | ✅ | Deployed SorobanPay contract address (C…). Run `bash deploy/deploy.sh` to get one. |
| `NEXT_PUBLIC_RPC_URL` | ✅ | Soroban RPC endpoint (e.g. `https://soroban-testnet.stellar.org`). |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ | Stellar network passphrase matching the RPC target. |
| `NEXT_PUBLIC_NETWORK_NAME` | optional | Display label shown in the UI (`Testnet` / `Mainnet`). |

---

## Transaction builder interface

All on-chain interactions are encapsulated in
[`src/lib/transaction_builder.ts`](src/lib/transaction_builder.ts).
The file exposes typed async functions that build, sign, and submit Soroban
transactions through Freighter without any global state.

### How `buildAndSubmitSubscribe` works

Every subscription builder follows the same five-step pipeline:

```
Step 1  getAccount(publicKey)
        Fetches the current account sequence number from the Soroban RPC.
        The TransactionBuilder needs this to construct a valid XDR envelope.

Step 2  TransactionBuilder.addOperation(contract.call('subscribe', …))
        Encodes the contract call with the five arguments (subscriber,
        merchant, token, amount, interval) converted to ScVal types.
        No network I/O at this point.

Step 3  server.prepareTransaction(tx)
        Sends a simulation request to the RPC. The RPC runs the contract
        in a sandbox, injects the exact resource fee, and returns updated
        XDR. This step also surfaces contract-level errors early (e.g.
        invalid interval, self-subscription) before asking the user to sign.

Step 4  signTx(preparedTx.toXDR(), networkPassphrase)
        Passes the prepared XDR to Freighter via wallet_manager.signTx().
        Freighter shows the user a signing prompt. Returns signed XDR on
        approval; throws on user rejection.

Step 5  server.sendTransaction(parsedTx)
        Submits the signed transaction to the RPC. The node returns a
        status of PENDING, DUPLICATE, or ERROR immediately. The function
        throws on ERROR; otherwise it returns the transaction hash plus the
        server instance for downstream polling.
```

### Two-phase flow (recommended)

`buildSignAndSubmitSubscribe` implements steps 1–5 and returns as soon as
the transaction is accepted by the RPC. The UI transitions to a "confirming"
state and polls via `useTransactionPoller`:

```ts
import { buildSignAndSubmitSubscribe } from '@/lib/transaction_builder';
import { useTransactionPoller } from '@/hooks/useTransactionPoller';

const { txHash, server } = await buildSignAndSubmitSubscribe(
  { subscriber, merchant, token, amount, interval },
  CONTRACT_ID,
  publicKey,
  NETWORK_PASSPHRASE,
  RPC_URL,
);

// Hand off to the poller — component renders a live progress indicator
useTransactionPoller.startPolling(txHash, server);
```

This approach is preferred for user-facing flows because:

- The UI can show an intermediate "confirming on-chain…" state.
- `useTransactionPoller` uses exponential back-off, reducing RPC load.
- Signing and submission errors are handled before confirmation polling begins.

### Legacy all-in-one flow

`buildAndSubmitSubscribe` wraps `buildSignAndSubmitSubscribe` and additionally
polls in-process (fixed 1 s interval, 60 s timeout) until the transaction is
confirmed or times out. It returns only the confirmed `txHash`.

```ts
import { buildAndSubmitSubscribe } from '@/lib/transaction_builder';

// Blocks until confirmed or throws on timeout
const { txHash } = await buildAndSubmitSubscribe(
  { subscriber, merchant, token, amount, interval },
  CONTRACT_ID,
  publicKey,
  NETWORK_PASSPHRASE,
  RPC_URL,
);
```

> **Deprecated.** Prefer the two-phase approach above. The in-process poll
> uses a fixed 1 s interval and provides no intermediate UI feedback.

### Other exported builders

| Function | Contract entry point | Who authorises |
|---|---|---|
| `buildAndSubmitExecutePayment` | `execute_payment` | Merchant |
| `buildAndSubmitBatchExecutePayment` | `execute_payment` (sequential) | Merchant |

`buildAndSubmitBatchExecutePayment` iterates entries and calls
`buildAndSubmitExecutePayment` per subscriber. Failures are captured per-entry
and do not stop the batch — the caller receives a `BatchExecutePaymentResult`
with `successCount`, `failureCount`, and per-entry details.

When the on-chain `batch_execute_payment` entry point is deployed, the
client-side loop should be replaced with a single multi-operation transaction
for atomicity and lower fees.

### How to extend the builder

To wrap a new Soroban entry point (e.g. `pause(subscriber, merchant)`):

**1. Add parameter and result interfaces** near the top of the file,
following the `SubscribeParams` / `SubscribeResult` naming pattern:

```ts
export interface PauseParams {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
}

export interface PauseResult {
  txHash: string;
}
```

**2. Validate all addresses** before any network calls using the helpers
from `validation.ts`:

```ts
if (!isValidGAddress(params.subscriber)) {
  throw new Error(`Invalid subscriber address: ${params.subscriber}`);
}
```

**3. Build the operation** with the correct ScVal conversions:

```ts
contract.call(
  'pause',
  new Address(params.subscriber).toScVal(),
  new Address(params.merchant).toScVal(),
)
```

Type mapping reference:

| TypeScript | ScVal conversion |
|---|---|
| `string` (G/C address) | `new Address(value).toScVal()` |
| `number` / `bigint` (i128) | `nativeToScVal(BigInt(value), { type: 'i128' })` |
| `number` / `bigint` (u64) | `nativeToScVal(BigInt(value), { type: 'u64' })` |
| `boolean` | `nativeToScVal(value, { type: 'bool' })` |

**4. Wrap `prepareTransaction` in a try/catch** and surface a readable error:

```ts
try {
  preparedTx = await server.prepareTransaction(tx);
} catch (err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  throw new Error(`Transaction preparation failed: ${msg}`);
}
```

**5. Choose a polling strategy:**

- Return `{ txHash, server }` early (like `buildSignAndSubmitSubscribe`) if
  the UI needs a live progress indicator.
- Poll in-process with `pollForConfirmation` (like `buildAndSubmitExecutePayment`)
  for simpler fire-and-forget flows.

**6. Export and wire up** the new function, then import it in the component
that needs it.

---

## Component overview

| Component | Location | Purpose |
|---|---|---|
| `SubscriptionForm` | `src/components/SubscriptionForm.tsx` | Full subscription creation form; calls `buildSignAndSubmitSubscribe` |
| `FeeEstimate` | `src/components/FeeEstimate.tsx` | Simulates the transaction and shows the estimated resource fee |
| `ShareQRCode` | `src/components/ShareQRCode.tsx` | Generates a QR code for a subscription payment link |
| `AddressBook` | `src/components/AddressBookModal.tsx` | Saved label ↔ address pairs, persisted in localStorage |

---

## Running tests

```bash
# Unit tests (Jest)
cd frontend
npm test

# End-to-end tests (Playwright)
npm run test:e2e
```

Individual test files for the transaction builder:

```
src/lib/transaction_builder.test.ts              # subscribe happy path
src/lib/transaction_builder.execute_payment.test.ts
src/lib/transaction_builder.timeout.test.ts
src/lib/transaction_builder.rpc-failures.test.ts
src/lib/transaction_builder.scval.test.ts        # ScVal encoding edge cases
```
