# Token Decimals and Amount Units

## How amounts are stored

The contract stores and transfers amounts as **raw integer units** — the smallest indivisible unit of the token, with no decimal interpretation applied on-chain.

This matches the SEP-41 (Stellar Asset Contract) interface: `transfer(from, to, amount)` where `amount` is an `i128` in the token's base unit.

The contract never reads, stores, or enforces a decimal configuration. All decimal handling is an **off-chain responsibility**.

---

## Common token scales

| Token | Decimals | 1 "whole" unit = |
|-------|----------|------------------|
| USDC (Circle) | 7 | `10_000_000` base units |
| Stellar native XLM (SAC) | 7 | `10_000_000` stroops |
| Most SAC-wrapped assets | 7 | `10_000_000` base units |
| Custom tokens | varies | depends on token contract |

**Always query the token contract's `decimals()` view before constructing an `amount`.**

---

## Off-chain amount construction

Before calling `subscribe`, convert a human-readable amount to base units:

```typescript
import { SorobanRpc, Contract } from "@stellar/stellar-sdk";

// 1. Fetch token decimals from the token contract
const tokenContract = new Contract(tokenAddress);
const decimals: number = await tokenContract.call("decimals"); // e.g. 7

// 2. Convert: 5.00 USDC → 50_000_000 base units
const humanAmount = 5.00;
const baseUnits = BigInt(Math.round(humanAmount * 10 ** decimals));

// 3. Pass baseUnits as the `amount` parameter to subscribe()
await contract.call("subscribe", subscriber, merchant, token, baseUnits, interval);
```

```python
from stellar_sdk import SorobanServer, Address

server = SorobanServer("https://soroban-testnet.stellar.org")

# Fetch decimals
decimals = token_contract.functions["decimals"].call()  # e.g. 7

# 5.00 USDC → 50_000_000
base_units = int(5.00 * 10 ** decimals)
```

---

## Displaying amounts to users

When reading a subscription's `amount` from `get_subscription`, convert back to human-readable form:

```typescript
const data = await contract.call("get_subscription", subscriber, merchant);
const decimals = await tokenContract.call("decimals");

const humanAmount = Number(data.amount) / 10 ** decimals;
console.log(`${humanAmount} tokens per interval`);
```

---

## Multi-token subscriptions

Because each subscription stores the token address alongside the amount, different subscriber–merchant pairs can use different tokens with different decimal scales. There is no assumption of a single global token.

The contract enforces only:
- `amount > 0`
- `amount <= 1_000_000_000_000_000_000` (1 × 10¹⁸ base units — a safe ceiling well below `i64::MAX`)

It does **not** enforce a minimum human-readable amount. A value like `amount = 1` is valid; it transfers one base unit, which may be `0.0000001` USDC — effectively a no-op in human terms. Off-chain callers should validate that the human-readable amount is meaningful before submitting.

---

## Safe amount ceiling

The `MAX_AMOUNT` constant (`1e18`) is denominated in **base units**. For a 7-decimal token:

```
1e18 base units = 1e11 whole tokens = 100,000,000,000 tokens
```

This ceiling is far above any realistic subscription amount and exists solely to prevent accidental overflow in downstream arithmetic, not to impose a business limit.

---

## Summary

| Responsibility | Where handled |
|---------------|---------------|
| Decimal scale of a token | Off-chain (query token's `decimals()`) |
| Converting human amount → base units | Off-chain, before calling `subscribe` |
| Converting base units → human amount | Off-chain, when displaying to users |
| Transferring the correct base-unit amount | On-chain (the contract passes `amount` directly to `token.transfer`) |
| Enforcing amount > 0 and ≤ 1e18 | On-chain |
