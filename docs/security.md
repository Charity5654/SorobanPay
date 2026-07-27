# SorobanPay Security Model

This document is the authoritative security reference for SorobanPay. It covers the on-chain security model, authorization audit results, backend secrets management, circuit breaker runbook, frontend security, known limitations, and dependency auditing.

---

## Table of Contents

1. [Contract Security Model](#1-contract-security-model)
2. [Authorization Audit (SC-20)](#2-authorization-audit-sc-20)
3. [Backend Secrets Management](#3-backend-secrets-management)
4. [Circuit Breaker Runbook (SC-25)](#4-circuit-breaker-runbook-sc-25)
5. [Frontend Security](#5-frontend-security)
6. [Known Limitations and Mitigations](#6-known-limitations-and-mitigations)
7. [Dependency Security](#7-dependency-security)
8. [Security Disclosure Policy](#8-security-disclosure-policy)
9. [Pause / Unpause Runbook (SC-30)](#9-pause--unpause-runbook-sc-30)

---

## 1. Contract Security Model

### Non-custodial design

SorobanPay never holds token balances. All payment transfers go directly from `subscriber → merchant` via SEP-41 `transfer()`. The contract has no treasury address, no escrow wallet, and no upgrade authority over token contracts.

This means:
- A compromised contract cannot drain funds it does not hold.
- A compromised backend cannot move funds (it never submits token transfers).
- Subscribers retain full custody of their tokens between payment windows.

### Per-invocation authorization

Every entry point calls `require_auth()` before any state mutation:

| Entry point | Who must authorize | What they authorize |
|-------------|-------------------|---------------------|
| `subscribe` | `subscriber` | Create or overwrite the subscription record |
| `execute_payment` | `merchant` | Collect the next due payment |
| `execute_payment_batch` | `merchant` | Collect payments for a batch of subscribers |
| `cancel` | `subscriber` | Remove the subscription record |
| `get_subscription` | *(no auth)* | Read-only view — no state change |
| `version` | *(no auth)* | Read-only — returns version symbol |
| `contract_name` | *(no auth)* | Read-only — returns name symbol |

`require_auth()` is enforced by the Soroban host, not by application logic. A missing or invalid signature causes the entire transaction to fail before any code in the entry point runs.

### Allowance model

Subscribers grant a SEP-41 token allowance to the contract address:

```
subscriber.approve(contract_address, amount, expiry_ledger)
```

The contract's `execute_payment` then calls `token.transfer(subscriber, merchant, amount)`. This means:

- **Revoking the allowance** (`approve(contract_address, 0)`) prevents all future payments regardless of on-chain subscription state — subscribers have a unilateral emergency stop.
- **Reducing the allowance** below the subscription amount causes `execute_payment` to fail with `TransferFailed`.
- The contract does **not** require an allowance equal to all future payments — only enough for the next interval.

### Time-lock enforcement

`execute_payment` checks `now >= next_payment` before attempting any transfer. This check uses the Soroban ledger timestamp, which is set by the network validators and cannot be manipulated by the transaction submitter.

```
if now < data.next_payment {
    return Err(ContractError::PaymentNotDue);
}
```

Merchants cannot front-run or double-collect payments within the same billing window.

### Input validation

`subscribe` validates all inputs before touching storage:

| Check | Error | Condition |
|-------|-------|-----------|
| Self-subscription | `SelfSubscription` | `subscriber == merchant` |
| Positive amount | `AmountMustBePositive` | `amount <= 0` |
| Amount ceiling | `AmountTooLarge` | `amount > 10^18` |
| Interval floor | `IntervalTooShort` | `interval < 86400` (1 day) |
| Interval ceiling | `IntervalTooLong` | `interval > 31536000` (365 days) |
| Timestamp validity | `InvalidTimestamp` | ledger timestamp is 0 or would overflow |

### Storage TTL and expiry

Persistent entries have a TTL. Expired entries return `None` on read — identical to a cancelled subscription from the contract's perspective. `execute_payment` on an expired entry returns `NoActiveSubscription`, not a token transfer error.

See [docs/architecture.md](architecture.md#7-storage-ttl-and-entry-lifecycle) for the full TTL lifecycle.

---

## 2. Authorization Audit (SC-20)

This section documents which address is expected to authenticate at each contract entry point and what an attacker could do if they impersonated a different party.

### Auth matrix

| Entry point | Authenticating address | Auth position in code | Attack if wrong party |
|-------------|----------------------|----------------------|----------------------|
| `subscribe` | `subscriber` | Line 1, before any state read | Merchant cannot create subscriptions on behalf of users without their key |
| `execute_payment` | `merchant` | Line 1, before storage load | Subscriber cannot block collection by impersonating merchant; random address cannot trigger transfers |
| `execute_payment_batch` | `merchant` | Line 1, before loop | Only the declared merchant can batch-collect; one merchant cannot collect on behalf of another |
| `cancel` | `subscriber` | Line 1, before storage check | Merchant cannot cancel a subscriber's subscription unilaterally |

### Why `execute_payment` is merchant-authorized

This is a deliberate design choice. The merchant bears responsibility for collecting payments on schedule — authorizing as merchant means:

1. The subscriber does not need to be online to approve each collection (recurrence model).
2. The subscriber's auth (token allowance) is a separate, out-of-band authorization that limits transfer scope.
3. Merchants sign with their own key, creating an auditable on-chain record of who collected what and when.

### Why `subscribe` is subscriber-authorized

The subscriber's signature on `subscribe` is the primary consent signal. By signing this transaction, the subscriber:

1. Agrees to the specific amount, interval, token, and merchant.
2. Authorizes the contract to record this agreement.
3. Does **not** pre-authorize any token transfers — the token allowance is separate.

This two-step consent model (subscribe + approve) means revoking either the subscription (`cancel`) or the token allowance immediately halts future payments.

### `require_auth` placement rule

As a contributor, always call `require_auth()` as the **first statement** in any entry point, before any storage reads, logging, or external calls. This prevents auth bypass via state-dependent short-circuits.

```rust
// CORRECT
pub fn subscribe(env: Env, subscriber: Address, ...) -> Result<(), ContractError> {
    subscriber.require_auth();  // ← FIRST LINE
    // ... validation and storage writes
}

// WRONG — auth after a state read could be bypassed
pub fn subscribe(env: Env, subscriber: Address, ...) -> Result<(), ContractError> {
    let existing = env.storage().persistent().get(&key);  // ← state read BEFORE auth
    subscriber.require_auth();
    // ...
}
```

---

## 3. Backend Secrets Management

### Never commit secrets

Add these patterns to `.gitignore` (already present in the repo):

```
.env
.env.local
.env.production
*.pem
*.key
```

Use a pre-commit hook to catch accidental staging of secret files:

```bash
# .git/hooks/pre-commit  (chmod +x)
#!/bin/sh
STAGED=$(git diff --cached --name-only)
if echo "$STAGED" | grep -qE '^(backend/\.env|\.env\.local|\.env\.production)$'; then
  echo "ERROR: Secret file staged for commit. Unstage it: git reset HEAD <file>"
  exit 1
fi

# Optional: use gitleaks for deeper scanning
if command -v gitleaks >/dev/null 2>&1; then
  gitleaks protect --staged --no-banner
fi
```

### Secrets reference

| Variable | Sensitivity | Notes |
|----------|-------------|-------|
| `DATABASE_URL` | 🔴 High | Contains credentials; never log the full URL |
| `RPC_URL` | 🟡 Medium | High if it embeds a paid-provider API key (e.g., ValidationCloud) |
| `NETWORK_PASSPHRASE` | 🟢 Low | Public Stellar constant; still env-configurable for flexibility |
| `CONTRACT_ID` | 🟢 Low | Public on-chain address |
| `WEBHOOK_SECRET` | 🔴 High | Used to compute HMAC-SHA256 signatures; exposure allows forged webhooks |
| `OPERATOR_SECRET` | ⛔ Privileged | Stellar keypair for optional PaymentScheduler; see note below |
| `PORT` | 🟢 Low | Server port; no security impact |

### ⛔ `OPERATOR_SECRET` — handle with extreme care

`OPERATOR_SECRET` is a Stellar secret key (`S…`) used by the optional `PaymentScheduler` to submit `execute_payment` transactions. If compromised:

- The attacker can collect payments for any subscription on the contract where the operator is the merchant.
- They cannot steal funds held by the contract (there are none) or modify subscriptions.

**Never** set `OPERATOR_SECRET` unless the `PaymentScheduler` is actively needed. If not set, the scheduler is disabled and the backend is fully read-only.

### Local development

```bash
cd backend
cp .env.example .env
# Edit .env — fill in real DATABASE_URL, RPC_URL, CONTRACT_ID
# NEVER commit .env
```

Load secrets at runtime via `dotenv`:

```typescript
import 'dotenv/config'; // top of src/index.ts
```

### Platform deployments (Railway / Render / Fly.io)

Set variables in the platform's environment dashboard. No secret-store SDK needed. The app reads from `process.env` at runtime.

**Fly.io example:**

```bash
flyctl secrets set DATABASE_URL="postgresql://user:pass@host:5432/db"
flyctl secrets set WEBHOOK_SECRET="$(openssl rand -hex 32)"
```

**Render example:** Settings → Environment → Add Environment Variable (mark as secret).

### AWS Secrets Manager

For AWS-hosted deployments needing audit trails and automatic rotation:

```typescript
import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

async function loadSecrets() {
  const client = new SecretsManagerClient({ region: 'us-east-1' });
  const { SecretString } = await client.send(
    new GetSecretValueCommand({ SecretId: 'sorobanpay/backend/prod' })
  );
  if (!SecretString) throw new Error('Secret not found');

  const secrets = JSON.parse(SecretString);
  process.env.DATABASE_URL    = secrets.DATABASE_URL;
  process.env.WEBHOOK_SECRET  = secrets.WEBHOOK_SECRET;
  // Assign other secrets before starting the Express server
}

await loadSecrets();
// then import and start the app
```

Store secrets as a JSON object in a single AWS Secrets Manager entry. Enable automatic rotation for `DATABASE_URL` using the built-in RDS Lambda rotator.

### HashiCorp Vault

```bash
# Store
vault kv put secret/sorobanpay/backend \
  DATABASE_URL="postgresql://..." \
  WEBHOOK_SECRET="..."

# Retrieve in app startup (using node-vault or vault agent sidecar)
```

### Docker secrets (Compose / Swarm)

```yaml
# docker-compose.yml
secrets:
  webhook_secret:
    external: true
  db_url:
    external: true

services:
  backend:
    secrets:
      - webhook_secret
      - db_url
    environment:
      WEBHOOK_SECRET_FILE: /run/secrets/webhook_secret
      DATABASE_URL_FILE: /run/secrets/db_url
```

Read in app:

```typescript
import { readFileSync } from 'fs';

function readSecret(envKey: string, fileEnvKey: string): string {
  const filePath = process.env[fileEnvKey];
  if (filePath) return readFileSync(filePath, 'utf-8').trim();
  return process.env[envKey] ?? '';
}

const webhookSecret = readSecret('WEBHOOK_SECRET', 'WEBHOOK_SECRET_FILE');
```

### Key rotation procedure

**`DATABASE_URL` (password rotation):**

1. Create a new database user with the same privileges as the old one.
2. Update the secret in your store (AWS Secrets Manager, Vault, or platform dashboard).
3. Trigger a rolling restart of the backend service (`flyctl restart` / `render manual deploy` / `kubectl rollout restart`).
4. Verify the backend connects successfully (check `/health` endpoint).
5. Drop the old database user.
6. Estimated downtime: 0 seconds (rolling restart).

**`WEBHOOK_SECRET` rotation:**

1. Generate a new secret: `openssl rand -hex 32`.
2. Update both the backend environment and the webhook sender's configuration at the same time (coordinate with merchants using webhooks).
3. During the brief transition window, verify both old and new signatures to avoid dropped events:
   ```typescript
   function verifySignature(payload: string, signature: string, secrets: string[]): boolean {
     return secrets.some(secret => {
       const expected = createHmac('sha256', secret).update(payload).digest('hex');
       return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
     });
   }
   ```
4. Remove the old secret after all senders have switched.

**`OPERATOR_SECRET` rotation:**

1. Generate a new Stellar keypair: `stellar keys generate new-operator --network mainnet`.
2. Fund the new account with enough XLM for fees.
3. Update `OPERATOR_SECRET` in the secret store and redeploy.
4. Revoke the old keypair by setting it to zero balance or removing from any multisig setups.

---

## 4. Circuit Breaker Runbook (SC-25)

A "circuit breaker" for SorobanPay means stopping all payment collection and communicating clearly to users while a fix is prepared. Because the contract is non-upgradeable, the primary levers are:

1. **Subscriber action**: Revoke token allowance.
2. **Backend action**: Stop the `PaymentScheduler`.
3. **Merchant action**: Stop calling `execute_payment`.
4. **Protocol action**: Deploy a new contract version and migrate.

### Step-by-step incident response

#### Phase 1 — Detect and assess (target: within 15 minutes of alert)

1. Identify the affected entry point(s) and the nature of the issue:
   - Logic bug (wrong amount collected, wrong party authorized)?
   - Reentrancy or state corruption?
   - Dependency vulnerability (SEP-41 token bug)?
2. Determine scope: single subscription, all subscriptions for a token, or protocol-wide.
3. Open a private incident channel (Slack / Discord / email) with core contributors.
4. **Do not disclose publicly until mitigations are in place** unless data of subscribers is at immediate risk.

#### Phase 2 — Stop new payments (target: within 30 minutes)

**Backend — disable PaymentScheduler:**

```bash
# Fly.io
flyctl secrets unset OPERATOR_SECRET
flyctl restart

# Render
# Remove OPERATOR_SECRET in dashboard → manual deploy

# Docker Compose
docker compose stop backend
# Edit docker-compose.yml: remove OPERATOR_SECRET
docker compose up -d backend

# Kubernetes
kubectl set env deployment/backend OPERATOR_SECRET="" -n sorobanpay
kubectl rollout restart deployment/backend -n sorobanpay
```

**Merchant — stop calling execute_payment manually:**

Contact all merchants integrating the contract directly (via webhook, email, or Discord) and instruct them to pause automated collection scripts.

**Subscriber emergency stop (self-service):**

Instruct subscribers to revoke the token allowance via Freighter or the Stellar Laboratory:

```bash
stellar contract invoke \
  --id <TOKEN_CONTRACT_ID> --source <subscriber-key> --network mainnet \
  -- approve \
  --from <subscriber-address> \
  --spender <contract-address> \
  --amount 0 \
  --expiration_ledger 0
```

Publish this command in your status page and social channels immediately.

#### Phase 3 — Investigate and fix (target: within 24 hours for critical)

1. Reproduce the issue in a local test environment (`make test`).
2. Write a failing test that captures the bug.
3. Implement the fix.
4. Review: get sign-off from at least two contributors who are not the patch author.
5. Deploy to testnet and verify the fix with the failing test now passing.

#### Phase 4 — Deploy new contract

Because Soroban contracts are immutable once deployed, fixing a contract bug requires deploying a new contract instance:

```bash
# Deploy new version to mainnet
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh
NEW_CONTRACT_ID=$(...)
echo "New contract: $NEW_CONTRACT_ID"
```

**Migration steps:**

1. Announce the new contract address via all channels.
2. Update `NEXT_PUBLIC_CONTRACT_ID` in frontend `.env.local` and redeploy the frontend.
3. Update `CONTRACT_ID` in the backend environment and restart.
4. Communicate to merchants that they must update their integrations to the new contract address.
5. Instruct subscribers to re-subscribe on the new contract (subscriptions are not portable between contract instances).

#### Phase 5 — Post-incident (within 72 hours)

1. Write a post-mortem: timeline, root cause, impact assessment, remediation.
2. Publish a public summary (may omit sensitive technical details until patched).
3. Update this runbook with any new lessons learned.
4. File a CVE if the vulnerability is in a shared dependency.

### Severity levels

| Level | Criteria | Response time | Public disclosure |
|-------|----------|---------------|------------------|
| Critical | Funds at risk, active exploitation | Immediate (< 1 hour) | After mitigation |
| High | Auth bypass, data integrity | < 4 hours | After fix deployed |
| Medium | DoS, information leak | < 24 hours | With fix |
| Low | Edge case, no immediate risk | Next release | With fix |

---

## 5. Frontend Security

### Content Security Policy (FE-45)

Configure the following CSP in `next.config.mjs` to restrict resource loading:

```javascript
// next.config.mjs
const cspHeader = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' blob: data:;
  font-src 'self';
  object-src 'none';
  base-uri 'self';
  form-action 'self';
  connect-src 'self'
    https://soroban-testnet.stellar.org
    https://mainnet.stellar.validationcloud.io
    https://horizon-testnet.stellar.org
    https://horizon.stellar.org;
  frame-ancestors 'none';
`.replace(/\n/g, ' ');

export default {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          { key: 'Content-Security-Policy', value: cspHeader },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};
```

> Note: `unsafe-eval` is currently required for certain Stellar SDK WASM operations. Track [stellar-sdk#1234](https://github.com/stellar/js-stellar-sdk/issues) for resolution; remove once the SDK no longer requires it.

### Wallet signing security

Freighter's security model:

- The user's secret key **never leaves the Freighter extension**. The frontend receives a signed XDR envelope, not the private key.
- The frontend cannot construct a transaction that transfers more than the user approved — the Freighter UI shows the exact transaction to be signed.
- A compromised frontend can show a misleading UI, but cannot forge signatures.

**Contributor guidelines for transaction construction:**

1. Always use `simulateTransaction` before prompting for a signature — this catches errors before the user sees a signing prompt.
2. Never modify a transaction after simulation and before signing.
3. Display the decoded transaction details in the UI (`merchant`, `amount`, `token`, `interval`) so users can verify before signing.
4. Set transaction timeout (`timebounds`) to a reasonable value (e.g., 5 minutes) to prevent replay of stale signed transactions.

### Form input validation

The frontend performs client-side validation (`frontend/lib/validation.ts`) before constructing any transaction:

- Stellar address format (`StrKey.isValidEd25519PublicKey`)
- Amount bounds (positive, not exceeding `MAX_AMOUNT`)
- Interval bounds (86400 – 31536000 seconds)
- Token address format

Client-side validation is UX — it does not replace on-chain validation. The contract enforces all constraints independently.

### Freighter phishing risk

Warn users:
- Only install Freighter from the official [Chrome Web Store](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk) or [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/freighter/).
- Verify the URL is `freighter.app` before connecting.
- SorobanPay will **never** ask for your seed phrase.

---

## 6. Known Limitations and Mitigations

### No MEV protection

**Limitation:** Payment collection transactions are visible in the mempool before inclusion. A miner or validator could theoretically front-run `execute_payment` to collect a payment in a different transaction order, though there is no direct financial incentive to do so since the funds go to the declared merchant.

**Mitigation:** Soroban's fee market does not enable ordering by fee tip at the contract-call level. The time-lock (`now >= next_payment`) bounds the collection window but does not prevent ordering attacks within that window.

**Risk level:** Low. Front-running `execute_payment` does not benefit the attacker — the transfer always goes to the declared merchant, not to the transaction submitter.

### Trust assumptions on RPC nodes

**Limitation:** Both the frontend and the backend depend on Soroban RPC nodes to read chain state and broadcast transactions. A malicious or censoring RPC could:

- Return stale event data to the backend indexer.
- Drop broadcast transactions.
- Return incorrect simulation results.

**Mitigation:**

- Use multiple RPC endpoints in the backend (primary + fallback).
- The contract enforces all critical invariants on-chain — a lying RPC cannot forge payment events that did not occur.
- For critical operations, verify transaction inclusion by querying the ledger directly.

### Subscription entry expiry

**Limitation:** If a subscription entry's TTL expires (after ~365 days of no successful payments), the entry is garbage-collected by the Soroban host. A subsequent `execute_payment` call returns `NoActiveSubscription`. This can surprise merchants who expect stale subscriptions to be collectable indefinitely.

**Mitigation:** The backend `Reconciler` detects subscriptions that have not had a successful payment in an extended period and can alert merchants to re-subscribe or write off the account. See [docs/architecture.md](architecture.md#7-storage-ttl-and-entry-lifecycle).

### No multi-sig for `execute_payment`

**Limitation:** The `execute_payment` entry point only requires a single signature from `merchant`. A compromised merchant key allows an attacker to collect all due payments for that merchant's subscribers.

**Mitigation:** Use a Stellar multisig account as the merchant address for production deployments:

```bash
# Set merchant account to require 2-of-3 signatures
stellar account merge --network mainnet ...
```

### Protocol-wide pause (implemented — no individual subscription pause)

The contract now supports a **protocol-wide pause** via `pause_contract` / `unpause_contract` (see [§9 Pause / Unpause Runbook](#9-pause--unpause-runbook-sc-30)). This halts all state-mutating entry points simultaneously.

**Remaining limitation:** There is no mechanism to pause an individual subscription. The `is_paused` field exists in `SubscriptionData` but is not read by `execute_payment`.

**Mitigation for individual pauses:** Subscribers can achieve the equivalent by revoking their token allowance (`approve(contract, 0)`). Merchants can stop calling `execute_payment` for specific subscribers.

### Backend is a single point of failure for analytics

**Limitation:** The backend, including the `PaymentScheduler`, is optional infrastructure. If it goes down, the contract continues to function correctly — subscriptions can still be collected by merchants calling `execute_payment` directly. However, the merchant dashboard, payout summaries, and webhook notifications will be unavailable.

**Mitigation:** Use health monitoring (e.g., Uptime Robot on `/health`) and configure alerting for indexer lag. See [docs/architecture.md](architecture.md#6-deployment-topologies) for HA deployment options.

---

## 7. Dependency Security

### Rust / Cargo (contract)

Audit Cargo dependencies with `cargo audit`:

```bash
cargo install cargo-audit
cd contracts/subscription
cargo audit
```

For CI, add to `.github/workflows/ci.yml`:

```yaml
- name: Cargo audit
  run: cargo audit
  working-directory: contracts/subscription
```

Check for known advisories in the [RustSec Advisory Database](https://rustsec.org).

Key contract dependencies:

| Crate | Version | Purpose |
|-------|---------|---------|
| `soroban-sdk` | pinned | Soroban environment, types, storage |
| `soroban-token-sdk` (via `token::Client`) | pinned | SEP-41 token client |

Pin all dependency versions in `Cargo.toml` (no open ranges). The contract's `Cargo.lock` is committed to ensure reproducible builds.

### npm (backend + frontend)

Audit npm dependencies:

```bash
# Backend
cd backend && npm audit

# Frontend
cd frontend && npm audit
```

For CI:

```yaml
- name: npm audit (backend)
  run: npm audit --audit-level=high
  working-directory: backend

- name: npm audit (frontend)
  run: npm audit --audit-level=high
  working-directory: frontend
```

Use `npm audit fix` cautiously — prefer reviewing and pinning exact versions manually for security-sensitive packages.

### Dependabot

Enable Dependabot in `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /backend
    schedule:
      interval: weekly
    open-pull-requests-limit: 5

  - package-ecosystem: npm
    directory: /frontend
    schedule:
      interval: weekly
    open-pull-requests-limit: 5

  - package-ecosystem: cargo
    directory: /contracts/subscription
    schedule:
      interval: weekly
    open-pull-requests-limit: 3
```

### Supply chain integrity

- Do not use `latest` tags in Docker images — pin to a specific digest.
- Verify Stellar SDK releases against the [js-stellar-sdk changelog](https://github.com/stellar/js-stellar-sdk/releases) before upgrading.
- For the contract, always review `soroban-sdk` release notes before bumping — breaking changes to host function interfaces can silently alter contract behaviour.

---

## 8. Security Disclosure Policy

SorobanPay uses **coordinated disclosure**. If you find a security vulnerability:

1. **Do not open a public GitHub issue.**
2. Send a description of the vulnerability to the maintainers via **GitHub Security Advisories**:
   - Go to the repository → Security → Advisories → New Draft Advisory.
   - Include: affected component, description, reproduction steps, potential impact, and any suggested mitigations.
3. You will receive acknowledgement within **72 hours**.
4. We will work with you to understand and validate the issue, and coordinate a disclosure timeline of **90 days** from initial report (shorter for critical issues).
5. Once a fix is released, we will credit you (with your consent) in the release notes and advisory.

For questions about this policy, contact the repository maintainers via the GitHub Discussions tab.

---

## Checklist

- [ ] `.env` and secret files excluded from version control
- [ ] No real values in `backend/.env.example`
- [ ] Production secrets stored in a secret manager or platform dashboard
- [ ] `DATABASE_URL` rotated at least annually (or on any suspected compromise)
- [ ] `WEBHOOK_SECRET` set to a random 32-byte hex value
- [ ] `OPERATOR_SECRET` omitted unless `PaymentScheduler` is actively needed
- [ ] Pre-commit hook or `gitleaks` configured to prevent accidental secret commits
- [ ] `cargo audit` and `npm audit` passing in CI
- [ ] CSP headers configured in `next.config.mjs`
- [ ] Security advisory channel tested (can create a draft advisory)

---

## 9. Pause / Unpause Runbook (SC-30)

The `pause_contract` / `unpause_contract` entry points provide an on-chain circuit breaker that immediately halts all state-mutating operations without requiring coordination with merchants or subscribers. This section describes when and how to use it.

### When to use the pause

Pause the contract when you have **confirmed** (not merely suspected) one of the following:

| Scenario | Use pause? | Notes |
|----------|-----------|-------|
| Critical vulnerability in `subscribe`, `execute_payment`, or `cancel` | ✅ Yes | Stops exploitation immediately |
| Dependency vulnerability in a SEP-41 token contract | ✅ Yes | Prevents further transfers until assessed |
| Backend compromise (scheduler or indexer) | ⚠️ Optional | Backend cannot sign transactions; pause is precautionary |
| Suspected front-running or MEV | ❌ No | No financial incentive to front-run; do not pause lightly |
| Spam subscriptions (high volume, no exploits) | ❌ No | Rate-limit at the backend level instead |
| Network congestion or RPC outage | ❌ No | Pause does not help network-level issues |

**Pausing is disruptive.** All `subscribe`, `execute_payment`, `execute_payment_batch`, and `cancel` calls return `ContractPaused` (error 16) until unpause. Do not pause for anything less than a confirmed critical or high-severity issue.

### Prerequisites

The admin key must be:
- Stored in a **hardware wallet** or **multisig account** for mainnet use.
- Known and accessible to at least two team members (avoid single-key dependency).
- Funded with enough XLM to pay transaction fees (minimum 1 XLM recommended).

The contract must have been initialised with `initialize(admin)` before the pause functionality is available. Check with:

```bash
stellar contract invoke \
  --id <CONTRACT_ID> --network mainnet \
  -- is_paused
```

### Phase 1 — Pause (target: within 5 minutes of confirmed incident)

#### Using the Stellar CLI

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <admin-identity> \
  --network mainnet \
  -- pause_contract
```

#### Using the JavaScript SDK

```typescript
import { Contract, SorobanRpc, TransactionBuilder, Networks, Keypair } from "@stellar/stellar-sdk";

const server    = new SorobanRpc.Server("https://mainnet.stellar.validationcloud.io/v1/<KEY>");
const adminKey  = Keypair.fromSecret(process.env.ADMIN_SECRET!);
const contract  = new Contract(process.env.CONTRACT_ID!);
const account   = await server.getAccount(adminKey.publicKey());

const tx = new TransactionBuilder(account, {
  fee: "10000",
  networkPassphrase: Networks.PUBLIC,
})
  .addOperation(contract.call("pause_contract"))
  .setTimeout(30)
  .build();

const simResult = await server.simulateTransaction(tx);
if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
  throw new Error(`Simulation failed: ${JSON.stringify(simResult)}`);
}

const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
preparedTx.sign(adminKey);
const response = await server.sendTransaction(preparedTx);
console.log("Pause transaction:", response.hash);
```

#### Verify the pause

```bash
# Should print "true"
stellar contract invoke \
  --id <CONTRACT_ID> --network mainnet \
  -- is_paused
```

Query the `contract_paused` event to obtain an on-chain timestamp of when the pause was recorded:

```bash
stellar events \
  --id <CONTRACT_ID> \
  --network mainnet \
  --type contract \
  --start-ledger <recent-ledger>
```

### Phase 2 — Communicate (within 15 minutes)

1. Post in your internal incident channel: contract address, time of pause, severity level, and incident lead.
2. Notify merchants via webhook, email, or Discord that the contract is paused and `execute_payment` calls will fail with error 16 until further notice.
3. Optionally publish a status-page incident:
   - Status: **Investigating**
   - Message: "The SorobanPay contract has been temporarily paused to investigate a potential security issue. No funds are at risk at this time. We will update this page as the investigation proceeds."
4. Do **not** disclose technical vulnerability details until a fix is deployed.

### Phase 3 — Investigate and fix

While the contract is paused, no new transactions are processed.  You can still call read-only entry points (`get_subscription`, `is_paused`, `version`) to query state.

Follow the same investigation steps as the [Circuit Breaker Runbook (SC-25)](#4-circuit-breaker-runbook-sc-25), Phase 3.

### Phase 4 — Unpause or deploy a new version

#### Option A — Unpause (vulnerability was not exploitable or has a hotfix)

If the vulnerability can be resolved without a contract upgrade (e.g., a backend configuration change, a false alarm, or the exploit vector is no longer reachable):

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --source <admin-identity> \
  --network mainnet \
  -- unpause_contract
```

Verify:

```bash
# Should print "false"
stellar contract invoke \
  --id <CONTRACT_ID> --network mainnet \
  -- is_paused
```

Update your status page: **Resolved** — "The contract has been unpaused. Normal operations have resumed."

#### Option B — Deploy a new contract version (vulnerability requires code change)

Because Soroban contracts are immutable, a code fix requires deploying a new instance.  Follow Phase 4 of the [Circuit Breaker Runbook (SC-25)](#4-circuit-breaker-runbook-sc-25).

Keep the old contract **paused** (do not unpause it) to ensure subscribers and merchants migrate to the new address.

### Phase 5 — Post-incident

1. Write a post-mortem: timeline, root cause, impact assessment, remediation steps.
2. Update this runbook with any new lessons learned.
3. Verify that the `contract_paused` and `contract_unpaused` events were captured in your event indexer.
4. Re-run `make test` and `cargo audit` on the updated codebase.
5. File a CVE if the vulnerability involves a shared dependency.

### Severity and response time

| Severity | Pause immediately? | Response SLA |
|----------|--------------------|-------------|
| Critical — funds at risk, active exploit | ✅ Yes | Pause < 5 min; fix < 4 hr |
| High — auth bypass, state corruption | ✅ Yes | Pause < 15 min; fix < 24 hr |
| Medium — DoS, information leak | ⚠️ Evaluate | Fix < 72 hr; pause optional |
| Low — edge case, no immediate risk | ❌ No | Fix in next release |

### Admin key security

The admin key has no financial custody over contract funds (the contract holds no balances), but it controls contract availability.  A compromised admin key allows an attacker to pause the contract indefinitely (DoS).

Best practices:
- Use a **Stellar multisig account** (e.g., 2-of-3) as the admin address for mainnet.
- Store the admin secret in a hardware wallet (Ledger) or HSM — never in a `.env` file.
- Document the admin address in your incident runbook so any on-call engineer can verify pauses.
- Rotate the admin key by deploying a new contract with a different admin address (no admin-transfer mechanism exists in this version).

### Auth matrix update for admin entry points

The following rows supplement the auth matrix in [§2 Authorization Audit](#2-authorization-audit-sc-20):

| Entry point | Authenticating address | Effect when paused |
|-------------|----------------------|--------------------|
| `initialize` | `admin` (new) | Always available (creates AdminConfig) |
| `pause_contract` | `admin` | Always available (admin can pause a paused contract — no-op) |
| `unpause_contract` | `admin` | Always available (admin can unpause) |
| `is_paused` | *(no auth)* | Always available (read-only) |
| `subscribe` | `subscriber` | Returns `ContractPaused` (16) |
| `execute_payment` | `merchant` | Returns `ContractPaused` (16) |
| `execute_payment_batch` | `merchant` | Returns `ContractPaused` (16) |
| `cancel` | `subscriber` | Returns `ContractPaused` (16) |
| `get_subscription` | *(no auth)* | Unaffected — read-only |
| `version` | *(no auth)* | Unaffected — read-only |
| `contract_name` | *(no auth)* | Unaffected — read-only |
