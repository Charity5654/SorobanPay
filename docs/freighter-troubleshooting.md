# Freighter Troubleshooting Guide

This guide covers the three most common failure categories when using Freighter with SorobanPay: wallet connection issues, signing failures, and rejected or failed transactions. Each section explains what is happening in the code, how to diagnose the problem, and the steps to resolve it.

---

## Table of contents

1. [Connection issues](#1-connection-issues)
2. [Signing failures](#2-signing-failures)
3. [Rejected and failed transactions](#3-rejected-and-failed-transactions)
4. [Environment and configuration errors](#4-environment-and-configuration-errors)
5. [Contract errors returned on-chain](#5-contract-errors-returned-on-chain)
6. [Diagnostic checklist](#6-diagnostic-checklist)

---

## 1. Connection issues

### 1.1 Freighter not detected — "Wallet not connected" badge stays gray

**What happens in the code**

`wallet_manager.ts` runs `detectFreighter()` on startup. It polls `isConnected()` every 100 ms for up to 3 seconds. If Freighter never responds the `freighterInstalled` flag stays `false`, the form renders a yellow warning banner, and the Submit button is permanently disabled.

**Causes and fixes**

| Cause | Fix |
|---|---|
| Extension not installed | Install Freighter for [Chrome/Brave](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk) or [Firefox](https://addons.mozilla.org/en-US/firefox/addon/freighter/). |
| Page served from `file://` | Freighter blocks `file://` origins. Run the app via `npm run dev` so it is served from `http://localhost`. |
| Extension disabled in browser | Go to browser extensions settings and enable Freighter. |
| Conflicting wallet extension | Disable other Stellar wallet extensions (e.g. xBull, Rabet) and hard-reload. |
| Firefox — extension loaded after page render | Firefox injects content scripts asynchronously. The 3-second polling loop handles this, but an extremely slow browser startup may still lose the race. Hard-reload (`Ctrl+Shift+R`) after Firefox finishes loading. |

**Verify the extension is visible**

Open the browser console on `http://localhost:3000` and run:

```javascript
window.freighter
```

If the result is `undefined`, the extension is either absent or blocked. If it returns an object, Freighter is injected but `isConnected()` may still fail if the extension is locked — unlock it in the popup first.

---

### 1.2 Site permission not granted — connection prompt never finishes

**What happens in the code**

`connectWallet()` in `wallet_manager.ts` calls `isAllowed()` and, if the site is not whitelisted, calls `setAllowed()` followed by `requestAccess()`. If the user dismisses the permission popup without approving it, `requestAccess()` returns `{ error: "..." }` and `connectWallet()` throws `Access was denied: <reason>`.

**Fix**

1. Click the Freighter extension icon in the browser toolbar.
2. If the site appears under **Not allowed**, click **Allow**.
3. Click **Connect Wallet** in the app again and approve the popup.

To reset a previously denied permission:

1. Open Freighter → Settings → Connected Sites.
2. Remove `localhost` from the list.
3. Reload the page and reconnect.

---

### 1.3 Empty public key returned after connection

**What happens in the code**

After `requestAccess()` succeeds, `connectWallet()` calls `getAddress()`. If the result has no `address` field it throws `Freighter returned an empty public key.`

**Causes and fixes**

- Freighter was locked between the access grant and the address lookup. Unlock the extension and click Connect again.
- No account is set up in Freighter. Create or import a Stellar account in the extension.
- The extension was updated mid-session and restarted its background process. Hard-reload the page.

---

### 1.4 RPC unreachable — NetworkBadge shows red dot

**What happens in the code**

`SubscriptionForm.tsx` renders a `NetworkBadge` that fires a `POST` to `RPC_URL` on mount. A network failure sets the badge to "RPC unreachable" (red dot). The form is still rendered, but `buildAndSubmitSubscribe` will fail at `server.getAccount()`.

**Fix**

1. Check `NEXT_PUBLIC_RPC_URL` in `frontend/.env.local`.
2. Verify the value matches the network Freighter is set to:

   | Network | Correct RPC URL |
   |---|---|
   | Testnet | `https://soroban-testnet.stellar.org` |
   | Mainnet | `https://mainnet.stellar.validationcloud.io/v1/<YOUR_KEY>` |

3. If using a custom RPC, confirm the endpoint is reachable from your machine:
   ```bash
   curl -s -X POST https://soroban-testnet.stellar.org \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq .
   ```
   A healthy response returns `"status":"healthy"`.

---

## 2. Signing failures

### 2.1 Signing popup never appears

**What happens in the code**

`signTx()` in `wallet_manager.ts` calls `signTransaction(xdr, { networkPassphrase })`. Freighter should open a popup. If it doesn't, the call hangs until the user interaction timeout or the browser pop-up blocker silently swallows it.

**Fixes**

- Disable the browser's pop-up blocker for `localhost`. In Chrome: address bar → the blocked popup icon → **Always allow pop-ups from localhost**.
- Confirm Freighter is unlocked (enter PIN if prompted in the extension popup).
- If another wallet extension is active, it may intercept the signing request. Disable it and retry.
- Hard-reload the page. The Freighter background service worker may have crashed.

---

### 2.2 "Transaction signing failed" / "User declined" error

**What happens in the code**

If `signTransaction()` returns `{ error: "..." }`, `signTx()` throws `Transaction signing failed: <error>`. `classifyError()` in `SubscriptionForm.tsx` matches keywords `user declined`, `rejected`, `signing failed`, or `user rejected` and renders the error card with title **"Signing cancelled"**.

The form data is preserved — no fields are cleared — so the user can review and resubmit.

**Fix**

1. Click **Authorize Subscription** again.
2. When the Freighter popup opens, review the transaction details and click **Approve**.
3. If you want to use a different account, switch accounts in Freighter before resubmitting.

To approve silently without reviewing every time during development, you can enable **Auto-approve** in Freighter's dev settings — but never do this on Mainnet.

---

### 2.3 Wrong network error at signing time

**What happens in the code**

`signTx()` passes `networkPassphrase` to Freighter. If Freighter is set to a different network, it rejects the XDR with a passphrase mismatch. `classifyError()` matches `wrong network`, `passphrase`, or `network mismatch` and renders **"Wrong network"**.

**Fix**

1. Open Freighter → click the network name in the top-right corner.
2. Switch to the network that matches `NEXT_PUBLIC_NETWORK_PASSPHRASE` in `frontend/.env.local`:

   | `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Freighter network setting |
   |---|---|
   | `Test SDF Network ; September 2015` | Testnet |
   | `Public Global Stellar Network ; September 2015` | Mainnet |

3. Reload the page and resubmit.

---

### 2.4 "Freighter returned an empty signed transaction XDR"

**What happens in the code**

`signTx()` checks that `result.signedTxXdr` is non-empty after signing. An empty value means Freighter completed the call but returned no XDR — unusual but possible when the extension restarts mid-request.

**Fix**

Reload the page and retry. If it recurs, check for a Freighter update — this has been a bug in older versions.

---

## 3. Rejected and failed transactions

### 3.1 Transaction submission failed — ERROR status from RPC

**What happens in the code**

After signing, `buildAndSubmitSubscribe()` calls `server.sendTransaction()`. If the RPC returns `status: "ERROR"`, it throws `Transaction submission failed: <base64 XDR error result>`. This happens before the polling loop starts, so no hash is returned.

**Common causes**

| Cause | Details |
|---|---|
| Transaction fee too low | Surge pricing on Mainnet. The `BASE_FEE` constant in `transaction_builder.ts` uses the Stellar SDK default. Always simulate first (see below). |
| Malformed XDR | Signing corrupted the transaction. Usually caused by a version mismatch between the SDK and Freighter. |
| Account sequence out of sync | Two browser tabs submitted transactions for the same account simultaneously. |
| Contract not deployed | The `CONTRACT_ID` in `.env.local` refers to a contract that does not exist on this network. |

**Fix for fee issues**

Always simulate before submitting in production. The SDK's `prepareTransaction()` already does this — it fills `minResourceFee` automatically. If the base fee is still rejected, increase `BASE_FEE` in `transaction_builder.ts`:

```typescript
// transaction_builder.ts — increase from BASE_FEE (100) to a fixed value
const tx = new TransactionBuilder(account, {
  fee: '10000', // 10,000 stroops; adjust based on simulateTransaction output
  networkPassphrase,
})
```

**Fix for sequence errors**

Reload the page to re-fetch the account sequence number from `server.getAccount()`. Do not submit from multiple tabs for the same account simultaneously.

---

### 3.2 Transaction confirmation timeout

**What happens in the code**

`pollForConfirmation()` in `transaction_builder.ts` polls `server.getTransaction(hash)` once per second for up to 60 attempts. If the status never leaves `NOT_FOUND` (still in mempool) or `FAILED`, it throws `Transaction confirmation timeout after 60 seconds. Hash: <hash>`. `classifyError()` matches `timeout` and renders **"Transaction timed out"**.

**Important:** the transaction may still confirm after the timeout. The hash is captured before polling starts. Check it on [Stellar Expert](https://stellar.expert) or [Stellar Laboratory](https://laboratory.stellar.org) before resubmitting.

**Fix**

1. Copy the transaction hash from the error card's technical details.
2. Look it up on [Stellar Expert (testnet)](https://stellar.expert/explorer/testnet) or [mainnet](https://stellar.expert/explorer/public).
3. If it confirmed successfully, the subscription is live — do not resubmit.
4. If it is still pending after 5 minutes, the transaction was likely dropped. Resubmit from the form (the data was preserved).

---

### 3.3 Transaction failed on-chain — FAILED status

**What happens in the code**

When `server.getTransaction(hash)` returns `FAILED`, `pollForConfirmation()` throws `Transaction failed on-chain: <resultMetaXdr>`. This means the transaction was included in a ledger but the smart contract returned an error. The `resultMetaXdr` is base-64 encoded Stellar XDR that contains the precise error.

**Decode the XDR**

```bash
stellar tx decode --xdr <resultMetaXdr>
```

Or use [Stellar Laboratory → XDR Viewer](https://laboratory.stellar.org/#xdr-viewer) to decode it in the browser.

The decoded output will include a `contractError` field with the numeric error code. Map it using the table in [section 5](#5-contract-errors-returned-on-chain).

---

### 3.4 Insufficient balance

**What happens in the code**

`execute_payment` in `lib.rs` calls `token_client.balance(&subscriber)` before attempting the transfer. If `balance < amount`, it emits a `payment_transfer_failure` event and returns `ContractError::TransferFailed` (error 7). On the frontend, `classifyError()` matches `insufficient balance`, `not enough`, or `underfunded` and renders **"Insufficient balance"**.

**Fix**

| Network | Action |
|---|---|
| Testnet | Fund via [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test) |
| Mainnet | Send XLM (minimum ~2 XLM for base reserve + transaction fee) to your address |

For token balance (not XLM): ensure you hold enough of the specific SEP-41 token the subscription uses. The contract checks the token balance, not XLM directly.

---

### 3.5 Token allowance too low

**What happens in the code**

The `subscribe` call in `lib.rs` reads `token_client.allowance(&subscriber, &contract_address)`.

- In **strict mode** (`strict: true`): returns `ContractError::InsufficientAllowance` (error 14) if `allowance < amount`.
- In **non-strict mode** (`strict: false`, the default): emits a `low_allowance` event as a warning but continues.

Regardless of the subscribe result, `execute_payment` calls `token.transfer()` which will fail inside the token contract if the contract's allowance has been revoked or was never set.

**Fix**

Grant the SorobanPay contract a token allowance at least equal to the subscription amount. Using the Stellar CLI:

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- approve \
  --from <YOUR_ADDRESS> \
  --spender <CONTRACT_ID> \
  --amount <AMOUNT> \
  --expiration-ledger 9999999
```

Or via the SDK:

```typescript
const tokenContract = new Contract(tokenContractId);
const approveOp = tokenContract.call(
  'approve',
  new Address(subscriberAddress).toScVal(),
  new Address(sorobanPayContractId).toScVal(),
  nativeToScVal(BigInt(amount), { type: 'i128' }),
  nativeToScVal(9999999, { type: 'u32' }), // expiration ledger
);
```

**Emergency stop:** to immediately prevent all future collections, set the allowance to `0`:

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> \
  --source alice \
  --network testnet \
  -- approve \
  --from <YOUR_ADDRESS> \
  --spender <CONTRACT_ID> \
  --amount 0 \
  --expiration-ledger 9999999
```

This is effective immediately and does not require calling `cancel` on the SorobanPay contract.

---

## 4. Environment and configuration errors

### 4.1 "Contract not configured" warning card

**Symptom:** Yellow card replaces the subscription form at startup.

**What happens in the code**

`SubscriptionForm.tsx` checks `if (!CONTRACT_ID)` immediately after all hooks. `CONTRACT_ID` comes from `frontend/src/constants/network.ts` which reads `process.env.NEXT_PUBLIC_CONTRACT_ID`. An empty or missing value renders `<ContractConfigError />` instead of the form.

**Fix**

1. Deploy the contract to get a valid address:
   ```bash
   CONTRACT_ID=$(bash deploy/deploy.sh)
   echo "Contract: $CONTRACT_ID"
   ```
2. Add the address to `frontend/.env.local`:
   ```env
   NEXT_PUBLIC_CONTRACT_ID=CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX
   ```
3. Restart the dev server — Next.js does not hot-reload `.env.local`:
   ```bash
   npm run dev
   ```

The warning card displays the current values of `RPC_URL`, `NETWORK_PASSPHRASE`, and `CONTRACT_ID` to assist diagnosis.

---

### 4.2 Contract deployed to wrong network

If the contract was deployed to Testnet but `NEXT_PUBLIC_NETWORK_PASSPHRASE` is set to the Mainnet passphrase (or vice versa), every transaction will fail with a passphrase mismatch or a "contract not found" error.

**Fix**

Ensure all three values in `.env.local` target the same network:

```env
# Testnet
NEXT_PUBLIC_CONTRACT_ID=C<your_testnet_contract>
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015

# Mainnet
# NEXT_PUBLIC_CONTRACT_ID=C<your_mainnet_contract>
# NEXT_PUBLIC_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<KEY>
# NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

Freighter's network selector must also match.

---

### 4.3 Transaction preparation failed

**What happens in the code**

`buildAndSubmitSubscribe()` calls `server.prepareTransaction(tx)` which simulates the transaction and injects resource fees. If simulation fails, it throws `Transaction preparation failed: <reason>`.

**Common reasons**

| Reason | Fix |
|---|---|
| Invalid contract ID | Verify `NEXT_PUBLIC_CONTRACT_ID` in `.env.local`. Deploy a fresh contract if needed. |
| Contract not initialized | After deploying, call `initialize(admin_address)` on the contract before any user interactions. |
| RPC endpoint unreachable | Check `NEXT_PUBLIC_RPC_URL`. Run the `curl` health check from [section 1.4](#14-rpc-unreachable--networkbadge-shows-red-dot). |
| Input validation bypassed | The contract's `subscribe` function rejects `amount ≤ 0`, `interval < 86400`, self-subscriptions, and mismatched token addresses. The form validates these before building the transaction, but direct SDK calls skip form validation. |

---

## 5. Contract errors returned on-chain

When a transaction lands on-chain but the contract returns an error, the error code is in the `resultMetaXdr`. The frontend's `classifyError()` also matches the `error(contract, #N)` string pattern that Soroban RPC includes in simulation failure messages.

| Code | Name | Trigger | Frontend message | Fix |
|---|---|---|---|---|
| 1 | `AmountMustBePositive` | `amount ≤ 0` | "Invalid amount" | Enter a positive integer. |
| 2 | `IntervalTooShort` | `interval < 86400 s` | "Invalid interval" | Minimum is 86,400 s (1 day). |
| 3 | `IntervalTooLong` | `interval > 31536000 s` | "Invalid interval" | Maximum is 31,536,000 s (365 days). |
| 4 | `NoActiveSubscription` | No subscription for the pair | Transaction failed | The subscription was already cancelled or never created. Resubscribe. |
| 5 | `PaymentNotDue` | `now < next_payment` | Transaction failed | The billing interval has not elapsed. Wait and retry. |
| 6 | `Unauthorized` | Auth check failed | "Authorisation failed" | Ensure the connected wallet matches the subscriber address. |
| 7 | `TransferFailed` | Subscriber balance < amount | "Insufficient balance" | Top up the subscriber's token balance. |
| 8 | `InvalidTimestamp` | Ledger timestamp is 0 or overflows | Transaction failed | Transient ledger issue; retry. |
| 9 | `AmountTooLarge` | `amount > 10¹⁸` | Transaction failed | Reduce the amount. |
| 10 | `SelfSubscription` | `subscriber == merchant` | Transaction failed | Merchant address cannot equal subscriber address. |
| 11 | `InvalidTokenAddress` | Token is contract's own address | Transaction failed | Use a valid SEP-41 token contract address (starts with `C`). |
| 14 | `InsufficientAllowance` | Strict mode and `allowance < amount` | Transaction failed | Approve a higher token allowance (see [section 3.5](#35-token-allowance-too-low)). |

---

## 6. Diagnostic checklist

Work through this checklist top-to-bottom before filing a bug report.

```
[ ] Freighter extension is installed and visible in the browser toolbar.
[ ] Freighter is unlocked (PIN entered, not showing a lock screen).
[ ] Freighter is set to the correct network (Testnet or Mainnet).
[ ] `NEXT_PUBLIC_NETWORK_PASSPHRASE` in `.env.local` matches Freighter's network.
[ ] `NEXT_PUBLIC_RPC_URL` in `.env.local` points to the correct Soroban RPC.
[ ] `NEXT_PUBLIC_CONTRACT_ID` in `.env.local` is set and starts with 'C'.
[ ] The contract was deployed to the same network as Freighter and `.env.local`.
[ ] The contract has been initialized (admin called `initialize(admin_address)` after deploy).
[ ] Dev server restarted after editing `.env.local` (`npm run dev`).
[ ] Page is served from `http://localhost`, not `file://`.
[ ] Pop-up blocker is disabled for `localhost`.
[ ] No conflicting wallet extensions are active.
[ ] Subscriber wallet holds sufficient XLM (≥ 2 XLM) and token balance.
[ ] Token allowance for the contract is ≥ subscription amount.
```

If all boxes are checked and the issue persists, open a bug report with:

- The full error message from the red error card (use **Show technical details**).
- The transaction hash (if one was returned).
- The values of `NETWORK_PASSPHRASE`, `RPC_URL`, and `CONTRACT_ID` from the error card or `.env.local`.
- Browser name and version, Freighter version, and Node.js version (`node -v`).
