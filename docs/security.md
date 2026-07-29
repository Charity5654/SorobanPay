# Secrets Management

Practical guidance for keeping SorobanPay secrets out of version control and safe in production.

---

## Never commit secrets

- **`.gitignore`** — ensure these patterns are present:
  ```
  .env
  .env.local
  .env.production
  ```
- Use `backend/.env.example` (committed, no real values) as the canonical template.
- Consider a pre-commit hook to catch accidental secret commits:
  ```bash
  # .git/hooks/pre-commit  (or use the `detect-secrets` / `gitleaks` tools)
  git diff --cached --name-only | grep -qE '\.env$' && echo "ERROR: .env staged" && exit 1
  ```

---

## Local development

Copy the example file and fill in real values — never commit the result:

```bash
cp backend/.env.example backend/.env
```

Load at runtime with [dotenv](https://github.com/motdotla/dotenv):

```ts
import 'dotenv/config'; // or require('dotenv').config()
```

Only call this in development; production environments inject vars directly (see below).

---

## Production secret stores

| Option | Best for |
|--------|----------|
| **AWS Secrets Manager** | AWS-hosted deployments; supports automatic rotation |
| **HashiCorp Vault** | Self-hosted or multi-cloud; fine-grained access policies |
| **Platform env vars** | Railway, Render, Fly.io — set in the dashboard, injected at runtime |

For platform deployments (Railway/Render/Fly.io), set each variable in the project's environment settings UI. No secret store SDK is required.

For AWS Secrets Manager, retrieve at startup:

```ts
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManagerClient({ region: 'us-east-1' });
const { SecretString } = await client.send(
  new GetSecretValueCommand({ SecretId: 'sorobanpay/backend' })
);
const secrets = JSON.parse(SecretString!);
```

---

## Secrets reference

| Variable | Sensitivity | Notes |
|----------|-------------|-------|
| `DATABASE_URL` | 🔴 High | Contains credentials; never log or expose |
| `RPC_URL` | 🟡 Medium | High if it embeds a paid-provider API key |
| `NETWORK_PASSPHRASE` | 🟢 Low | Public value, but keep env-configurable |
| `CONTRACT_ID` | 🟢 Low | Public on-chain address; still env-configurable |
| `WEBHOOK_SECRET` | 🔴 High | Used to verify HMAC signatures on incoming webhooks |
| `OPERATOR_PRIVATE_KEY` | ⛔ Never | See note below |

### ⛔ Private keys do not belong in the backend

SorobanPay is **non-custodial**. Transaction signing happens exclusively in the browser via Freighter. The backend is read-only with respect to the chain — it polls events but never submits transactions. **Never store a Stellar private key or mnemonic in the backend environment.**

---

## Key rotation

1. **DATABASE_URL** — rotate the database password in your DB provider, update the secret in your store, redeploy (or trigger a rolling restart). Revoke the old credential immediately after.
2. **WEBHOOK_SECRET** — generate a new secret, update both the secret store and the webhook sender's configuration simultaneously to avoid dropped events during rotation.
3. **RPC API keys** — generate a new key in the provider dashboard, update `RPC_URL`, then revoke the old key.

Automate rotation where possible (AWS Secrets Manager supports scheduled Lambda-based rotation for RDS credentials).

---

## Checklist

- [ ] `.env` is in `.gitignore`
- [ ] No real values in `backend/.env.example`
- [ ] Production vars set in secret store or platform dashboard
- [ ] `DATABASE_URL` rotated at least annually (or on any suspected compromise)
- [ ] No private keys anywhere in the backend codebase or environment

---

## Delegated Subscribe Security Model (SC-24)

The operator contract pattern introduces a new actor — the **operator** — into
the authorization chain.  This section describes the security properties,
constraints, and risks of delegated subscription creation.

---

### What the subscriber authorizes

When a subscriber creates a delegated subscription, they sign exactly two
authorization entries:

| # | Contract | Function | Parameters signed |
|---|---------|---------|------------------|
| 1 | `operator_id` | `delegate_subscribe` | protocol_id, subscriber, merchant, token, amount, interval |
| 2 | `protocol_id` | `subscribe` | subscriber, merchant, token, amount, interval |

Entry 2 is the critical one: it is a sub-invocation auth entry that permits the
operator contract to call `subscribe()` with **exactly those parameters**.
Soroban's host enforces parameter binding — the operator cannot alter any field.

**Consequence:** a subscriber who signs these entries is authorizing one specific
subscription.  They are not giving the operator a general-purpose key to create
arbitrary subscriptions.

---

### What the operator can and cannot do

| Capability | Can the operator? | Notes |
|-----------|------------------|-------|
| Create a subscription with the signed params | ✅ Yes | Core purpose |
| Change amount, merchant, token, or interval | ❌ No | Auth is parameter-scoped |
| Cancel a subscription on behalf of subscriber | ❌ No | `cancel()` requires subscriber auth directly |
| Collect payments | ❌ No | `execute_payment()` requires merchant auth |
| Hold subscriber funds | ❌ No | Protocol never holds balances; transfers are direct |
| Create a second subscription with the same auth | ❌ No | Auth entries are single-use |

---

### Risks and mitigations

#### 1. Subscriber unknowingly signs a malicious auth entry

**Risk:** A subscriber could be tricked into signing auth entries with
unfavorable parameters (e.g., a larger amount or a fraudulent merchant address).

**Mitigation:**
- Wallets (e.g., Freighter) display the full parameter set before signing.
- The subscriber should verify `merchant`, `token`, `amount`, and `interval`
  match the service they are subscribing to.
- Off-chain platforms should present a clear confirmation screen before
  requesting the signature.

#### 2. Operator contract is compromised or malicious

**Risk:** A compromised operator contract could replay valid auth entries or
manipulate parameters via a WASM upgrade.

**Mitigation:**
- Auth entries are **ledger-bounded**: they include a `valid_until_ledger` that
  expires them after a short window (recommend ≤ 60 ledgers, ~5 minutes).
- Each auth entry is **single-use** — Soroban's host marks them consumed on
  execution.
- Consider deploying the operator contract as **immutable** (no `set_code()`
  capability) for high-trust integrations.
- Subscribers can revoke future payments at any time by reducing their token
  allowance to zero: `token.approve(subscriber, protocol_id, 0, ...)`.

#### 3. Operator admin key compromise

**Risk:** If the admin key is compromised, an attacker can unpause a paused
operator and resume delegated subscriptions.

**Mitigation:**
- Store the `OPERATOR_ADMIN_KEY` in a secrets manager (e.g., AWS Secrets
  Manager or HashiCorp Vault), never in environment files.
- Consider using a multisig policy contract as the admin instead of a plain key.
- Rotate admin keys on any suspected compromise.
- Note: even if the admin key is compromised, the attacker **cannot** create
  subscriptions for subscribers without a fresh subscriber signature.

#### 4. Replay attacks

**Risk:** An auth entry is replayed after the original subscription is cancelled.

**Mitigation:**
- Auth entries contain a `valid_until_ledger` bound.  Short expiry windows (5–15
  minutes) make replay windows negligible.
- After cancellation, the subscriber can optionally create a new subscription
  with different parameters, making any stale auth entry parameter-mismatch.

---

### Operator private key: never in the backend

The same principle that applies to Stellar account private keys applies here:

> **Never store the operator's Soroban account private key in the backend
> environment.**

If your operator contract needs to submit transactions (e.g., to pause itself),
use a dedicated, minimally-funded account with no other permissions.  Treat it
like an API service account, not a custody wallet.

---

### Token allowance interaction

Delegated subscribe does **not** change the token allowance model:

- The subscriber still grants `token.approve(subscriber, protocol_id, amount × N, expiry)`
  to the **protocol** contract (not the operator).
- The operator contract never touches token allowances.
- Revoking allowance immediately prevents all future payments regardless of
  subscription state (this is unchanged from the direct subscribe flow).

---

### Checklist

- [ ] Operator contract deployed with a **short-lived admin key** or multisig policy
- [ ] `valid_until_ledger` set to ≤ 60 ledgers in auth entries
- [ ] Wallet UI displays full subscription parameters before subscriber signs
- [ ] Operator contract deployed as immutable if high-trust integration
- [ ] `OPERATOR_ADMIN_KEY` stored in secret manager, not in `.env` or source code
- [ ] Token allowance expiry aligned with subscription duration
- [ ] Off-chain monitoring of `delegated_subscribe` events for anomaly detection

