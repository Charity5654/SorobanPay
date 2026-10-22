# Frontend Environment Configuration

This document explains how to configure `frontend/.env.local` for local development, CI, and production deployments of the SorobanPay Next.js frontend.

---

## Table of Contents

1. [Quick setup](#quick-setup)
2. [Environment variable reference](#environment-variable-reference)
3. [Testnet configuration](#testnet-configuration)
4. [Mainnet configuration](#mainnet-configuration)
5. [How Next.js NEXT\_PUBLIC\_ variables work](#how-nextjs-next_public_-variables-work)
6. [What happens when variables are missing](#what-happens-when-variables-are-missing)
7. [Security: never commit .env.local](#security-never-commit-envlocal)
8. [Verifying your configuration](#verifying-your-configuration)

---

## Quick setup

```bash
# From the repo root
cp frontend/.env.example frontend/.env.local

# Deploy the contract and capture the address
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Contract: $CONTRACT_ID"

# Paste the address into frontend/.env.local
# Then start the dev server
cd frontend
npm install
npm run dev
```

Open http://localhost:3000 in a browser with the [Freighter extension](https://www.freighter.app) installed and set to **Testnet**.

---

## Environment variable reference

All three variables are required for the app to function correctly.

| Variable | Required | Default in `.env.example` | Description |
|---|---|---|---|
| `NEXT_PUBLIC_CONTRACT_ID` | ✅ Yes | `CXXX…` (placeholder) | Deployed Soroban contract address (56-character `C…` string) output by `deploy/deploy.sh`. |
| `NEXT_PUBLIC_RPC_URL` | ✅ Yes | Testnet RPC | Soroban RPC endpoint. Use the testnet URL for local development; use a mainnet RPC URL for production. |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ Yes | Testnet passphrase | Stellar network passphrase. Must exactly match the network your Freighter wallet is set to. |

### NEXT\_PUBLIC\_CONTRACT\_ID

The 56-character Soroban contract address, starting with `C`.

**How to get it:**

```bash
# Deploy to testnet (requires stellar-cli and a funded identity)
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "$CONTRACT_ID"
```

Copy the printed address and paste it into `frontend/.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ID=CABC...YOUR_CONTRACT_ADDRESS
```

If this variable is blank or missing, the app renders a yellow **"Contract not configured"** warning card instead of the subscription form. See [What happens when variables are missing](#what-happens-when-variables-are-missing).

---

### NEXT\_PUBLIC\_RPC\_URL

The Soroban JSON-RPC endpoint that the frontend uses to simulate and submit transactions.

| Network | URL |
|---|---|
| Testnet | `https://soroban-testnet.stellar.org` |
| Mainnet (Validation Cloud) | `https://mainnet.stellar.validationcloud.io/v1/<YOUR_API_KEY>` |
| Mainnet (SDF horizon) | `https://horizon.stellar.org` (limited RPC support) |

> **Note:** For production mainnet deployments you need a funded RPC provider API key (e.g., [Validation Cloud](https://www.validationcloud.io), [QuickNode](https://www.quicknode.com/chains/stellar), or [Ankr](https://www.ankr.com/rpc/stellar/)). The SDF-hosted testnet RPC is free and sufficient for development.

---

### NEXT\_PUBLIC\_NETWORK\_PASSPHRASE

The Stellar network passphrase. This value is embedded in every signed transaction and must exactly match the network that Freighter is configured to use. A mismatch causes Freighter to reject the transaction with a "wrong network" error.

| Network | Passphrase |
|---|---|
| Testnet | `Test SDF Network ; September 2015` |
| Mainnet | `Public Global Stellar Network ; September 2015` |

> The passphrase includes spaces and a semicolon — copy it exactly as shown, including the trailing space before the semicolon.

---

## Testnet configuration

Use this setup for local development and testing. No real funds are required.

```env
NEXT_PUBLIC_CONTRACT_ID=CABC...YOUR_TESTNET_CONTRACT
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

1. Deploy a fresh contract: `CONTRACT_ID=$(bash deploy/deploy.sh)`
2. Fund your Freighter wallet via [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test).
3. Set Freighter to **Testnet**.

---

## Mainnet configuration

For production deployments with real XLM and real token balances.

```env
NEXT_PUBLIC_CONTRACT_ID=CXYZ...YOUR_MAINNET_CONTRACT
NEXT_PUBLIC_RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_API_KEY>
NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015
```

**Steps:**

1. Generate a mainnet identity: `stellar keys generate my-mainnet-id --network mainnet`
2. Fund it with at least 2 XLM (covers base reserve + fees).
3. Deploy: `STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh`
4. Set Freighter to **Mainnet**.
5. Never use a testnet contract address with the mainnet passphrase (and vice versa) — the transaction will be rejected.

---

## How Next.js NEXT\_PUBLIC\_ variables work

Next.js embeds environment variables with the `NEXT_PUBLIC_` prefix at **build time** directly into the client-side JavaScript bundle. This means:

- They are visible in the browser — do not store secrets here.
- Changes require a server restart (`npm run dev`) or a production rebuild (`npm run build`) to take effect.
- Variables without the `NEXT_PUBLIC_` prefix are server-only and not available in browser code. All three SorobanPay variables need to be in the browser, so all three use the prefix.

For more detail see the [Next.js environment variables documentation](https://nextjs.org/docs/app/guides/environment-variables).

---

## What happens when variables are missing

### Missing `NEXT_PUBLIC_CONTRACT_ID`

The app renders a yellow **"Contract not configured"** warning card in place of the subscription form. The card also displays the current values of `RPC_URL` and `NETWORK_PASSPHRASE` so you can verify those are set correctly.

**Fix:** deploy the contract and set `NEXT_PUBLIC_CONTRACT_ID` in `.env.local`, then restart the dev server.

### Missing `NEXT_PUBLIC_RPC_URL`

The app cannot submit or simulate transactions. The subscription form may appear, but all transaction attempts will fail with a network error.

**Fix:** set the correct RPC URL for your target network.

### Missing `NEXT_PUBLIC_NETWORK_PASSPHRASE`

Transaction signing will fail because Freighter requires a matching network passphrase in the transaction envelope. The error appears in the Freighter popup or as a rejected-transaction error card in the app.

**Fix:** set the passphrase that matches the network your Freighter wallet is set to.

---

## Security: never commit .env.local

`.env.local` is listed in `frontend/.gitignore` (and the root `.gitignore`) and must never be committed to the repository.

While `NEXT_PUBLIC_` variables do not contain secrets (they are embedded in public JS anyway), committing `.env.local` is bad practice because:

- It can accidentally expose future secrets if you add server-side variables later.
- It forces every developer to use the same contract address, which causes confusion when working on multiple environments.

The file `.env.example` is the only env file committed to the repo. It contains safe placeholder values and acts as documentation for new developers.

---

## Verifying your configuration

After setting up `.env.local`, start the dev server and visit http://localhost:3000. You should see:

| Indicator | Meaning |
|---|---|
| Subscription form visible | `NEXT_PUBLIC_CONTRACT_ID` is set correctly |
| Freighter badge shows **Connected** (green) | Wallet is connected and network matches passphrase |
| No "Wrong network" errors | `NEXT_PUBLIC_NETWORK_PASSPHRASE` matches Freighter's network |
| Transactions simulate successfully | `NEXT_PUBLIC_RPC_URL` is reachable |

If the yellow warning card appears, check the current values displayed at the bottom of the card and compare against the [variable reference](#environment-variable-reference) above.
