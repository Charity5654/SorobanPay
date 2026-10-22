# Token Decimals, Rounding Rules, and Safe Conversion

## How amounts are stored

The contract stores and transfers amounts as **raw integer units** — the smallest
indivisible unit of the token, with no decimal interpretation applied on-chain.

This matches the SEP-41 (Stellar Asset Contract) interface:
`transfer(from, to, amount)` where `amount` is an `i128` in the token's base unit.

The contract never reads, stores, or enforces a decimal configuration. All decimal
handling is an **off-chain responsibility**.

---

## 1. Decimal concepts

### 1.1 User amounts vs. integer units

A "user amount" is the human-readable number you see in a wallet or UI
(e.g., "5.00 USDC"). An "integer unit" is the on-chain representation — the same
value multiplied by `10^decimals` and truncated to an integer.

```
user amount = 5.00 USDC
decimals    = 7
base units  = 5.00 × 10^7 = 50_000_000
```

The contract always receives and emits **base units**. The frontend, backend, and CLI
scripts are responsible for converting in both directions.

### 1.2 Common token scales

| Token | Decimals | 1 "whole" unit = | Example: 5.00 tokens |
|-------|----------|------------------|----------------------|
| USDC (Circle) | 7 | `10_000_000` base units | `50_000_000` |
| Stellar native XLM (SAC) | 7 | `10_000_000` stroops | `50_000_000` |
| Most SAC-wrapped assets | 7 | `10_000_000` base units | `50_000_000` |
| Custom tokens | varies | depends on token contract | query `decimals()` |

**Always query the token contract's `decimals()` view function before constructing an
`amount`.** Never assume 7. A custom token may use 0, 2, 6, 8, 18, or any other
value.

---

## 2. Off-chain amount construction

### 2.1 TypeScript / JavaScript

```typescript
import { SorobanRpc, Contract, nativeToScVal } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");

// 1. Fetch token decimals from the token contract
const tokenContract = new Contract(tokenAddress);
// simulateTransaction or call via server — illustrative:
const decimals: number = 7; // replace with actual decimals() call result

// 2. Convert user amount to base units — use BigInt to avoid float precision errors
function toBaseUnits(humanAmount: string, decimals: number): bigint {
  // Split on the decimal point
  const [whole, frac = ""] = humanAmount.split(".");
  // Pad or truncate the fractional part to exactly `decimals` digits
  const fracPadded = frac.slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * BigInt(10 ** decimals) + BigInt(fracPadded);
}

// 3. Examples
toBaseUnits("5.00", 7)      // → 50_000_000n
toBaseUnits("5.1234567", 7) // → 51_234_567n
toBaseUnits("5.12345678", 7) // → 51_234_567n  (truncated, not rounded — see §3)
toBaseUnits("0.0000001", 7) // → 1n             (minimum non-zero amount)

// 4. Pass baseUnits to subscribe()
const baseUnits = toBaseUnits("5.00", decimals);
await contract.call(
  "subscribe",
  subscriberScVal,
  merchantScVal,
  tokenScVal,
  nativeToScVal(baseUnits, { type: "i128" }),
  nativeToScVal(interval, { type: "u64" }),
);
```

> **Do not use `Math.round(humanAmount * 10 ** decimals)`.** Floating-point
> multiplication is lossy for values like `0.1` and can produce off-by-one errors
> in base units. Use string-based or BigInt arithmetic instead.

### 2.2 Python

```python
from decimal import Decimal, ROUND_DOWN

def to_base_units(human_amount: str, decimals: int) -> int:
    """
    Convert a human-readable amount string to integer base units.
    Truncates (does not round) sub-unit fractions.
    """
    scale = Decimal(10) ** decimals
    # ROUND_DOWN truncates toward zero — safe for payment amounts
    value = (Decimal(human_amount) * scale).quantize(Decimal("1"), rounding=ROUND_DOWN)
    return int(value)

# Examples
to_base_units("5.00", 7)       # → 50_000_000
to_base_units("5.1234567", 7)  # → 51_234_567
to_base_units("5.12345678", 7) # → 51_234_567  (truncated)
to_base_units("0.0000001", 7)  # → 1           (minimum non-zero)
```

---

## 3. Rounding rules

### 3.1 Always truncate (floor toward zero) when converting user → base units

For payment amounts, truncation is the safest default:

- It never charges more than the user intended.
- It avoids collecting a fraction of a cent that has no meaningful representation.
- It matches the behaviour expected by the contract's `amount > 0` guard.

**Example:**

| User input | Decimals | Truncated base units | What NOT to do (round) |
|---|---|---|---|
| `5.12345678` | 7 | `51_234_567` | `51_234_568` (over-charges) |
| `0.00000009` | 7 | `0` ← invalid! | `0` (same — rejected by contract) |

If truncation produces `0`, reject the input before submitting: the contract
returns `AmountMustBePositive` (error code 1) for any `amount ≤ 0`.

### 3.2 Always use string or BigInt arithmetic — never floats

Floating-point multiplication produces incorrect results for common amounts:

```javascript
// ❌ WRONG — float arithmetic
Math.round(0.1 * 10 ** 7)  // 1000000  (should be 1_000_000 — off by 0 here, but...)
Math.round(0.3 * 10 ** 7)  // 2999999  (should be 3_000_000 — wrong by 1)

// ✅ CORRECT — BigInt arithmetic via string parsing
toBaseUnits("0.3", 7)  // → 3_000_000n
```

### 3.3 Display rounding: round to display precision

When converting base units back to a user-facing string, choose a display precision
appropriate for the token and context. Use standard half-up rounding for display only
— never for the on-chain value.

```typescript
function toHumanAmount(baseUnits: bigint, decimals: number, displayDecimals = 2): string {
  const scale = BigInt(10 ** decimals);
  const whole = baseUnits / scale;
  const frac = baseUnits % scale;
  // Format fractional part with leading zeros, then round to displayDecimals
  const fracStr = frac.toString().padStart(decimals, "0");
  const displayFrac = fracStr.slice(0, displayDecimals);
  return `${whole}.${displayFrac}`;
}

// Examples (USDC, 7 decimals, display 2 decimals)
toHumanAmount(50_000_000n, 7, 2)  // "5.00"
toHumanAmount(51_234_567n, 7, 2)  // "5.12"  (truncated for display)
toHumanAmount(1n, 7, 2)           // "0.00"  (below display precision — warn user)
```

---

## 4. Minimum meaningful amounts

The contract enforces:
- `amount > 0` (error `AmountMustBePositive`, code 1)
- `amount ≤ 1_000_000_000_000_000_000` (1 × 10¹⁸, error `AmountTooLarge`, code 9)

The contract does **not** enforce a minimum human-readable amount. Off-chain callers
should validate the user-facing amount is meaningful before submitting:

```typescript
function validateAmount(humanAmount: string, decimals: number): void {
  const baseUnits = toBaseUnits(humanAmount, decimals);

  if (baseUnits <= 0n) {
    throw new Error(
      `Amount "${humanAmount}" is too small — it rounds to 0 base units. ` +
      `Minimum is ${1n} base unit (${(1 / 10 ** decimals).toFixed(decimals)} tokens).`
    );
  }

  const MAX_AMOUNT = 1_000_000_000_000_000_000n; // 1e18
  if (baseUnits > MAX_AMOUNT) {
    throw new Error(
      `Amount "${humanAmount}" exceeds the contract maximum of ${MAX_AMOUNT} base units.`
    );
  }
}
```

### Practical minimums by token

| Token | Decimals | Minimum on-chain amount | Human-readable |
|-------|----------|-------------------------|----------------|
| USDC | 7 | 1 base unit | `0.0000001` USDC |
| XLM (SAC) | 7 | 1 stroop | `0.0000001` XLM |
| Custom (2 dec.) | 2 | 1 base unit | `0.01` tokens |

Any amount below these values cannot be expressed on-chain and will be rejected.
UI validation should surface a clear error message before the transaction is built.

---

## 5. Querying token decimals at runtime

Always fetch decimals from the token contract. Do not hardcode the value.

### TypeScript

```typescript
import { SorobanRpc, Contract, scValToNative, xdr } from "@stellar/stellar-sdk";

async function getTokenDecimals(
  tokenAddress: string,
  rpcUrl: string
): Promise<number> {
  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // Build a minimal transaction to call decimals()
  // (abbreviated — use server.simulateTransaction in practice)
  const contract = new Contract(tokenAddress);
  // ... build and simulate tx ...
  // The return value is a u32 ScVal
  const decimals: number = scValToNative(returnValue); // e.g. 7
  return decimals;
}
```

### Stellar CLI

```bash
stellar contract invoke \
  --id "$TOKEN_ADDRESS" \
  --source alice \
  --network testnet \
  -- decimals
# Expected output: 7
```

### Caching recommendation

Cache the `decimals()` result per token address in memory for the lifetime of a
backend process. The value is immutable — SEP-41 tokens do not change their decimal
scale after deployment.

```typescript
const decimalsCache = new Map<string, number>();

async function cachedDecimals(tokenAddress: string, rpcUrl: string): Promise<number> {
  if (!decimalsCache.has(tokenAddress)) {
    decimalsCache.set(tokenAddress, await getTokenDecimals(tokenAddress, rpcUrl));
  }
  return decimalsCache.get(tokenAddress)!;
}
```

---

## 6. Multi-token subscriptions

Each subscription stores the token address alongside the amount, so different
subscriber–merchant pairs can use different tokens with different decimal scales.
There is no single global decimal value.

The contract enforces only:
- `amount > 0`
- `amount ≤ 1 × 10¹⁸` base units

When indexing events from multiple subscriptions that use different tokens, always
look up the correct decimal scale for each token before displaying amounts:

```typescript
async function formatPaymentEvent(event: { amount: bigint; token: string }, rpcUrl: string) {
  const decimals = await cachedDecimals(event.token, rpcUrl);
  return toHumanAmount(event.amount, decimals, 2);
}
```

---

## 7. Safe amount ceiling

The `MAX_AMOUNT` constant (`1e18`) is denominated in **base units**. For a 7-decimal
token:

```
1e18 base units ÷ 10^7 = 1e11 whole tokens = 100,000,000,000 tokens
```

This ceiling is far above any realistic subscription amount and exists solely to
prevent accidental overflow in downstream arithmetic. It is not a business limit.

Practical business limits should be set via `set_max_amount` at the contract level
(admin-controlled, returns `AmountExceedsLimit` error code 18 if exceeded) or via
front-end validation.

---

## 8. Displaying amounts to users

When reading a subscription's `amount` from `get_subscription`, convert back to
human-readable form before displaying:

```typescript
const data = await contract.call("get_subscription", subscriberScVal, merchantScVal);
const decimals = await cachedDecimals(data.token, RPC_URL);

const humanAmount = toHumanAmount(data.amount, decimals, 2);
console.log(`Subscription: ${humanAmount} tokens per interval`);
```

Avoid showing raw base unit values to end users. `50000000` is confusing; `5.00 USDC`
is clear.

---

## 9. Summary table

| Responsibility | Where handled |
|---|---|
| Decimal scale of a token | Off-chain — query token's `decimals()` |
| Converting user amount → base units | Off-chain — before calling `subscribe` |
| Rounding rule (user → base) | Truncate (floor) — never round up |
| Converting base units → user amount | Off-chain — when displaying to users |
| Rounding rule (base → display) | Round to display precision (half-up OK) |
| Transferring the correct base-unit amount | On-chain — contract passes `amount` directly to `token.transfer` |
| Enforcing amount > 0 | On-chain — `AmountMustBePositive` (code 1) |
| Enforcing amount ≤ 1e18 | On-chain — `AmountTooLarge` (code 9) |
| Enforcing per-deployment cap | On-chain — `AmountExceedsLimit` (code 18), set by admin via `set_max_amount` |

---

## See Also

- [docs/contract-api.md](./contract-api.md) — full `subscribe` parameter reference
- [README.md → Error codes](../README.md#error-codes) — `AmountMustBePositive`, `AmountTooLarge`, `AmountExceedsLimit`
- [docs/tokens.md](./tokens.md) — SEP-41 token contract integration details
- `contracts/subscription/src/lib.rs` — amount validation logic (`validate_inputs`)
