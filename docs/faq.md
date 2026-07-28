# SorobanPay — Frequently Asked Questions

Covers common questions about the smart contract, wallet interactions, payment execution, and subscription cancellation.

---

## Wallet & Connection

### Which wallet does SorobanPay use?

SorobanPay uses [Freighter](https://www.freighter.app), a browser extension wallet for Stellar. It is required to sign and submit transactions from the frontend. No other wallets are currently supported.

### Why does my wallet show "Disconnected"?

The frontend has not yet received approval from Freighter. Click the Freighter extension icon, find the site under **Connected Sites**, click **Connect**, then reload the page. The badge will turn green once connected.

### The Freighter signing popup never appears — what do I do?

1. Confirm the extension is installed (Chrome/Brave or Firefox).
2. The app must be served over `http://localhost` or `https://` — Freighter blocks `file://` origins.
3. Disable other wallet extensions temporarily; they can conflict with the injected Freighter API.
4. Try a hard reload (`Ctrl+Shift+R` / `Cmd+Shift+R`).

### I get "wrong network" errors — how do I fix that?

Open Freighter and switch networks so it matches `NEXT_PUBLIC_NETWORK_PASSPHRASE` in `frontend/.env.local`:

| Network | Passphrase |
|---------|-----------|
| Testnet | `Test SDF Network ; September 2015` |
| Mainnet | `Public Global Stellar Network ; September 2015` |

### Does SorobanPay ever hold my tokens?

No. The contract is non-custodial — every payment transfers tokens **directly from subscriber to merchant** via SEP-41 `transfer`. No balance is ever stored in the contract.

---

## Approval Flow

### What does the subscriber approve when they subscribe?

Calling `subscribe` does two things:

1. **Stores a subscription record** on-chain (`subscriber`, `merchant`, `token`, `amount`, `interval`, `next_payment`).
2. **Requires a SEP-41 token allowance** — the subscriber must separately call `token.approve(contract_id, amount)` (or higher) so the contract is authorized to pull tokens on payment day.

The frontend `buildAndSubmitSubscribe` function handles the `subscribe` contract call. Granting the token allowance is a separate step that should be completed before or alongside subscription creation.

### What is the approval flow step by step?

```
1. Subscriber fills the form and clicks "Authorize Subscription"
2. A confirmation modal shows the exact parameters (merchant, token, amount, interval)
3. Subscriber clicks "Confirm & Authorize"
4. Frontend builds the `subscribe` transaction and calls prepareTransaction (simulation)
5. Freighter popup appears — subscriber reviews and approves
6. Frontend signs with Freighter, submits to Soroban RPC, and polls for confirmation
7. On success: SuccessCard shows the transaction hash and next-steps guidance
```

### Why does the form require a confirmation step before Freighter opens?

The confirmation modal lets the subscriber review the exact on-chain parameters — merchant address, token contract, amount, and interval — before the Freighter popup appears. This prevents accidental subscriptions and mirrors the double-confirm pattern common in DeFi UIs.

### Can I revoke approval without cancelling the subscription?

Yes. Calling `token.approve(contract_id, 0)` revokes the SEP-41 allowance. Future `execute_payment` calls will fail with `TransferFailed` (error 7). The subscription record stays on-chain but payments cannot be collected until the allowance is restored. This is a softer stop than `cancel`, which removes the record entirely.

---

## Payment Execution

### Who triggers payments and when?

The **merchant** (or an automated backend acting on the merchant's behalf) calls `execute_payment(subscriber, merchant)`. The contract enforces that:

- A subscription exists for the pair.
- The current ledger timestamp is ≥ `next_payment`.

The subscriber does **not** need to do anything for recurring payments after the initial `subscribe`.

### How is the next payment date calculated?

On a successful transfer, `next_payment` is set to `now + interval` (current ledger time plus the interval in seconds). This means:

- **On-time collection**: next due date advances normally.
- **Late collection**: the delay is absorbed — the schedule shifts forward from the actual collection time, not the original due date.

This prevents "bunching" (two payments becoming due at once) but does mean billing dates can drift if payments are consistently late.

### What happens if my balance is too low when payment is due?

The contract checks the subscriber's token balance before attempting the transfer. If it is insufficient:

1. A `payment_transfer_failure` event is emitted.
2. The subscription record is **not changed** — it remains active and can be retried immediately.
3. The merchant receives error code `7` (`TransferFailed`).

The merchant or their backend can retry `execute_payment` once the subscriber has topped up.

### What fees does `execute_payment` cost?

`execute_payment` is the most expensive entry point because it invokes two cross-contract calls on the SEP-41 token (`balance` + `transfer`). Always run `simulateTransaction` first — do not hardcode fees. A rough guide:

| Entry point | Recommended min `instructions` |
|-------------|-------------------------------|
| `subscribe` | 150,000 |
| `execute_payment` | 500,000 |
| `cancel` | 50,000 |

Add a 10–25 % buffer above the simulation result for safety.

### What is the earliest a payment can be collected?

The first payment is collectible **immediately** after `subscribe` — the initial `next_payment` is set to `subscribe_time + interval`, so the very first payment window opens after one full interval. Re-reading: `next_payment = now + interval` at subscribe time, so the merchant must wait one interval before the first collect.

---

## Subscription Cancellation

### How does a subscriber cancel?

Call `cancel(subscriber, merchant)` signed by the subscriber:

```bash
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- cancel \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT
```

Or via the SDK:

```typescript
const op = contract.call(
  "cancel",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
);
```

### What does cancel actually do?

1. Verifies the subscription exists (returns `NoActiveSubscription` / error 4 if not).
2. Removes the record from persistent storage.
3. Emits a `cancel` event so off-chain indexers can immediately mark the relationship as ended.

After cancellation, any `execute_payment` call for that pair returns `NoActiveSubscription`.

### Can the merchant cancel a subscription?

No. `cancel` requires a signature from the **subscriber**. Only the subscriber can remove their own subscription record.

### What happens to in-flight payments after cancel?

If a `cancel` transaction and an `execute_payment` transaction are submitted in the same ledger, whichever is ordered first by the Soroban host wins. If `cancel` executes first, `execute_payment` returns `NoActiveSubscription`. If `execute_payment` executes first, the payment succeeds and then `cancel` removes the record. The contract has no lock mechanism between the two.

### Will my subscription expire automatically if I never cancel?

Eventually, yes. Each subscription entry has a storage TTL:

- **Minimum TTL**: ~30 days (518,400 ledgers)
- **Maximum TTL**: ~365 days (6,307,200 ledgers)

`subscribe` and each successful `execute_payment` reset the TTL to the maximum. If no successful payment occurs for a full year (e.g., the subscriber's balance is consistently zero), the entry is evicted by the Soroban host and future calls return `NoActiveSubscription`. Explicit `cancel` is still recommended rather than relying on expiry.

---

## Error Reference

| Code | Name | Common cause | Fix |
|------|------|-------------|-----|
| 1 | `AmountMustBePositive` | `amount ≤ 0` | Enter a positive amount |
| 2 | `IntervalTooShort` | `interval < 86400 s` | Use at least 86,400 s (1 day) |
| 3 | `IntervalTooLong` | `interval > 31536000 s` | Use at most 31,536,000 s (1 year) |
| 4 | `NoActiveSubscription` | Pair not found or already cancelled | Check addresses; re-subscribe if needed |
| 5 | `PaymentNotDue` | Too early to collect | Wait until `next_payment` timestamp |
| 6 | `Unauthorized` | Auth signature missing or wrong signer | Use the correct account in Freighter |
| 7 | `TransferFailed` | Insufficient balance | Top up subscriber balance and retry |
| 8 | `InvalidTimestamp` | Ledger clock is zero | Unusual network state; retry |
| 9 | `AmountTooLarge` | `amount > 10¹⁸` | Use a smaller amount |
| 10 | `SelfSubscription` | `subscriber == merchant` | Use different addresses |
| 11 | `InvalidTokenAddress` | Token is the contract itself | Use a valid SEP-41 token address |

---

For deeper technical details see [docs/contract-api.md](contract-api.md), [docs/events.md](events.md), and [docs/architecture.md](architecture.md).
