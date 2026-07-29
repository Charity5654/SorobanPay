# SEP-41 Token Integration

SorobanPay is token-agnostic. Any token that fully implements the [SEP-41 token interface](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md) is compatible with the subscription contract.

---

## SEP-41 Interface Requirements

The contract calls three functions on the token contract. All three **must** be present and behave according to the SEP-41 specification for a token to be compatible:

| Function | Signature | Required by SorobanPay | Purpose |
|----------|-----------|------------------------|---------|
| `allowance` | `allowance(from: Address, spender: Address) → i128` | `execute_payment` — balance pre-check | Read remaining approved spend |
| `transfer` | `transfer(from: Address, to: Address, amount: i128)` | `execute_payment` | Move tokens subscriber → merchant |
| `balance` | `balance(id: Address) → i128` | `execute_payment` — balance pre-check | Read subscriber's current balance |
| `approve` | `approve(from: Address, spender: Address, amount: i128, expiration_ledger: u32)` | Called by subscriber off-chain before `subscribe` | Grant spending allowance to the contract |
| `decimals` | `decimals() → u32` | Off-chain only (amount construction) | Determine smallest unit scale |

> **Note:** `approve` is called directly by the subscriber's wallet/frontend before invoking `subscribe`. The contract itself never calls `approve` — it only calls `balance`, `allowance`, and `transfer`.

---

## Allowance Model

The contract **never holds funds**. Instead it relies on a pre-granted SEP-41 allowance:

```
Subscriber wallet
  │
  ├─ 1. token.approve(contract_id, amount × N, expiration_ledger)
  │       ↑ subscriber signs this off-chain, before calling subscribe()
  │
  └─ 2. contract.subscribe(subscriber, merchant, token, amount, interval)
            │
            └─ (later) contract.execute_payment(subscriber, merchant)
                          │
                          └─ token.transfer(subscriber, merchant, amount)
                                 ↑ authorized by the allowance granted in step 1
```

### Step-by-step allowance workflow

```
┌─────────────────────────────────────────────────────────────────────┐
│  Subscriber                                                          │
│                                                                      │
│  1. Call token.approve(                                              │
│         from     = subscriber_address,                               │
│         spender  = sorobanpay_contract_id,                           │
│         amount   = desired_amount_per_cycle × safety_multiplier,     │
│         expiry   = current_ledger + ttl_ledgers                      │
│     )                                                                │
│                                                                      │
│  2. Call contract.subscribe(                                         │
│         subscriber, merchant, token, amount_per_cycle, interval_sec  │
│     )                                                                │
│                                                                      │
│  3. (each interval) Merchant calls contract.execute_payment(         │
│         subscriber, merchant                                          │
│     )   ──► token.transfer(subscriber, merchant, amount_per_cycle)   │
└─────────────────────────────────────────────────────────────────────┘
```

### Allowance sizing guidance

Set the allowance to at least `amount_per_cycle`. For longer-lived subscriptions, grant a larger allowance so multiple payment cycles can be collected without requiring the subscriber to re-approve:

```typescript
// Grant enough for 12 monthly cycles (1 year)
const cyclesBuffer = 12n;
const allowanceAmount = amountPerCycle * cyclesBuffer;

const approveTx = await tokenContract.call(
  "approve",
  new Address(subscriberAddress).toScVal(),       // from
  new Address(sorobanPayContractId).toScVal(),    // spender
  nativeToScVal(allowanceAmount, { type: "i128" }), // amount
  nativeToScVal(currentLedger + 6_307_200, { type: "u32" }) // ~1 year expiry
);
```

> The allowance `expiration_ledger` is a ledger sequence number, not a Unix timestamp. At ~5 s/ledger, 6,307,200 ledgers ≈ 1 year.

---

## Revoking Allowance

A subscriber can stop all future payments **without calling `cancel`** by setting the allowance to zero:

```typescript
// Revoke all future payments immediately
await tokenContract.call(
  "approve",
  new Address(subscriberAddress).toScVal(),
  new Address(sorobanPayContractId).toScVal(),
  nativeToScVal(0n, { type: "i128" }),
  nativeToScVal(currentLedger + 1, { type: "u32" }) // expires next ledger
);
```

After this call, any `execute_payment` attempt will fail with `ContractError::TransferFailed` (error 7) because the token contract will reject the transfer.

> **Important:** Revoking the allowance does **not** remove the subscription from on-chain storage. Call `contract.cancel(subscriber, merchant)` to also clean up the storage entry and emit the `cancel` event (which off-chain indexers rely on).

---

## Token Validation in `subscribe`

The contract performs one validation on the token address at subscription time:

```rust
// SC-8: prevent the contract from subscribing to itself as a token
if token == env.current_contract_address() {
    return Err(ContractError::InvalidTokenAddress); // error 11
}
```

This is a sanity guard only. The contract does **not** verify that the supplied address implements SEP-41 at subscription time. If you pass a non-SEP-41 address, `subscribe` will succeed but every subsequent `execute_payment` will panic during the cross-contract call.

---

## Known Compatible Tokens

### Testnet

| Token | Symbol | Contract Address |
|-------|--------|-----------------|
| USD Coin | USDC | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |
| Euro Coin | EURC | `GB3Q6QDZYTHWT7E5PVS3W7FUT5GVAFC5KSZFFLPU25GO575XD24JKWNM` |
| Stellar Lumens (SAC wrapped) | XLM | `CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC` |

> Testnet addresses are subject to change when Circle or Stellar deploy new contract versions. Verify the current address at [Stellar Expert Testnet](https://testnet.stellar.expert).

### Mainnet

| Token | Symbol | Contract Address |
|-------|--------|-----------------|
| USD Coin | USDC | `CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75` |
| Euro Coin | EURC | `CZNS4PLBTP4Q4LRQH3NGTXLRM5CJXBR3LWDQ3ZZJPUVDWBMZDMQB4ZY` |
| Stellar Lumens (SAC wrapped) | XLM | `CAS3J7GYLGXMF6TDJBBYYSE3HQ6BBSMLNUQ34T6TZMYMW2EVH34XOWMA` |

> Always verify contract addresses against the [Stellar Asset Contract canonical source](https://developers.stellar.org/docs/tokens/stellar-asset-contract) before use on mainnet. Never trust hardcoded addresses in untrusted code.

---

## Decimal Handling

SEP-41 tokens store amounts as **raw integer base units** with no on-chain decimal interpretation. The contract passes `amount` directly to `token.transfer` — it never converts or rounds.

### Common token scales

| Token | Decimals | 1 whole unit = base units | Example: 5.00 tokens |
|-------|----------|--------------------------|----------------------|
| USDC | 7 | `10_000_000` | `50_000_000` |
| EURC | 7 | `10_000_000` | `50_000_000` |
| XLM (SAC) | 7 | `10_000_000` | `50_000_000` (= 5 XLM) |
| Custom token | varies | `10^decimals` | depends on token |

### Worked example: subscribing for 5 USDC/month

```typescript
import { SorobanRpc, Contract, Address, nativeToScVal } from "@stellar/stellar-sdk";

const server = new SorobanRpc.Server("https://soroban-testnet.stellar.org");
const tokenContract = new Contract(USDC_TESTNET_ADDRESS);

// 1. Fetch decimals from the token contract
const decimalsResult = await server.simulateTransaction(/* decimals() call */);
const decimals = 7; // USDC is always 7; or parse from simulateTransaction result

// 2. Convert human amount → base units
const humanAmount = 5.0;          // 5 USDC per month
const baseUnits = BigInt(Math.round(humanAmount * 10 ** decimals));
// baseUnits = 50_000_000n

// 3. Set monthly interval (30 days in seconds)
const interval = 30n * 24n * 60n * 60n; // 2_592_000n

// 4. Subscribe
const op = contract.call(
  "subscribe",
  new Address(subscriber).toScVal(),
  new Address(merchant).toScVal(),
  new Address(USDC_TESTNET_ADDRESS).toScVal(),
  nativeToScVal(baseUnits, { type: "i128" }),   // 50_000_000
  nativeToScVal(interval,  { type: "u64" }),    // 2_592_000
);
```

### Displaying amounts

When reading a subscription amount back from the chain, always fetch `decimals()` from the token contract before dividing:

```typescript
const data = await contract.call("get_subscription", subscriber, merchant);
const decimals = await fetchDecimals(data.token); // call token.decimals()

const humanAmount = Number(data.amount) / 10 ** decimals;
console.log(`${humanAmount.toFixed(2)} per interval`);
```

---

## Native XLM Wrapping

The Stellar network's native XLM asset is not a contract token and does not implement SEP-41. To use XLM with SorobanPay you must use the **Stellar Asset Contract (SAC)** wrapped version.

The SAC wrapper is a Soroban contract deployed by Stellar that implements the full SEP-41 interface on top of the native XLM balance. It is **not** a wrapped token in the ERC-20 sense — there is no lock-and-mint. The SAC reads and writes native XLM balances directly.

### Why wrapping is needed

| Property | Native XLM | SEP-41 SAC XLM |
|----------|-----------|----------------|
| Usable with SorobanPay | ❌ no SEP-41 interface | ✅ full SEP-41 |
| Requires token contract address | ❌ | ✅ (use SAC address above) |
| Shares balance with Freighter | ✅ same underlying balance | ✅ same underlying balance |
| Approve/allowance required | ❌ | ✅ same flow as USDC |

### Using SAC XLM

Substitute the SAC XLM contract address (`CAS3J7…` on mainnet, `CDLZFC3…` on testnet) wherever you would use a token address. The `approve → subscribe → execute_payment` flow is identical.

```bash
# subscribe with wrapped XLM on testnet
stellar contract invoke \
  --id $CONTRACT_ID --source alice --network testnet \
  -- subscribe \
  --subscriber GABC...ALICE \
  --merchant   GXYZ...MERCHANT \
  --token      CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC \
  --amount     50000000 \
  --interval   2592000
```

---

## Further Reading

- [SEP-41 specification](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
- [Stellar Asset Contract (SAC)](https://developers.stellar.org/docs/tokens/stellar-asset-contract)
- [docs/token-decimals.md](token-decimals.md) — decimal conversion reference and edge cases
- [docs/contract-api.md](contract-api.md) — full entry-point reference including error codes
- [README.md §Security model](../README.md#security-model) — how allowances relate to the non-custodial guarantee
