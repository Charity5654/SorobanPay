# Deployment Guide

This document covers production deployment of a platform built on SorobanPay.

## Pre-launch checklist

Before going live on Stellar **Mainnet**, complete every item in this checklist.

### Smart contract

- [ ] Run `make build` and verify the WASM compiles without errors.
- [ ] Run `make test` — all contract unit tests must pass.
- [ ] Run `make coverage` — line coverage must be ≥ 95% (enforced by CI).
- [ ] Run `bash scripts/integration-test.sh` — full subscribe → execute → cancel lifecycle must pass.
- [ ] Deploy to **Testnet** first and exercise the full user flow manually.
- [ ] Capture the deployed contract address and set it in `frontend/.env.local` as `NEXT_PUBLIC_CONTRACT_ID`.

### Frontend

- [ ] Run `npm run test:ci` in `frontend/` — all tests must pass, coverage must be ≥ 80%.
- [ ] Run `npm run type-check` — no TypeScript errors.
- [ ] Run `npm run build` — Next.js production build must succeed.
- [ ] Set all three environment variables in production:
  - `NEXT_PUBLIC_CONTRACT_ID`
  - `NEXT_PUBLIC_RPC_URL` (use a reliable mainnet RPC endpoint)
  - `NEXT_PUBLIC_NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015`
- [ ] Verify Freighter connects and a test subscription can be signed on Mainnet.

### Security

- [ ] Review [docs/security.md](./security.md) — ensure all secrets are managed correctly.
- [ ] Ensure `NEXT_PUBLIC_` variables do NOT contain private keys or secrets.
- [ ] Rotate any testnet keys before mainnet deployment.

### Legal & compliance

> These two documents are **templates only** — not legal advice.
> Consult a qualified lawyer before publishing.

- [ ] Customise and publish a **Privacy Policy** for your platform.
  Template: [docs/templates/privacy-policy.md](./templates/privacy-policy.md)
- [ ] Customise and publish **Terms of Service** for your platform.
  Template: [docs/templates/terms-of-service.md](./templates/terms-of-service.md)
- [ ] Fill in all `[PLACEHOLDER]` sections in both documents.
- [ ] Have both documents reviewed by legal counsel.
- [ ] Link both documents from your product's footer or onboarding flow.
- [ ] Confirm your data retention schedule matches the Privacy Policy
  (see BE-71 backend implementation).

### Monitoring

- [ ] Set up Codecov coverage badges (see README for badge links).
- [ ] Configure alerts for RPC endpoint availability.
- [ ] Set up error tracking (e.g. Sentry) for the frontend.

---

## Deploying the contract

See [README.md → Deployment](../README.md#deployment) for full instructions.

```bash
# Testnet
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Contract: $CONTRACT_ID"

# Mainnet
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh
```

## Environment variables reference

### `deploy/deploy.sh` variables

These variables control the deployment script. Set them before running `bash deploy/deploy.sh`.

| Variable | Default | Required | Allowed values | Description |
|----------|---------|----------|---------------|-------------|
| `STELLAR_NETWORK` | `testnet` | No | `testnet`, `mainnet` | Target Stellar network. Determines the RPC endpoint and network passphrase automatically — do not set `RPC_URL` or `PASSPHRASE` directly. |
| `STELLAR_IDENTITY` | `alice` | No | Any registered identity alias | Stellar CLI identity alias that signs and pays fees for the deploy transaction. Must be pre-created with `stellar keys generate` and funded. |

**Derived values** (set internally by the script — do not override):

| Derived variable | Testnet value | Mainnet value |
|-----------------|--------------|--------------|
| `RPC_URL` | `https://soroban-testnet.stellar.org` | `https://mainnet.stellar.validationcloud.io/v1/<key>` |
| `PASSPHRASE` | `Test SDF Network ; September 2015` | `Public Global Stellar Network ; September 2015` |

**Quick examples:**

```bash
# Testnet (all defaults)
bash deploy/deploy.sh

# Testnet — capture contract address
CONTRACT_ID=$(bash deploy/deploy.sh)

# Mainnet — explicit identity
STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh

# Mainnet — capture contract address
CONTRACT_ID=$(STELLAR_NETWORK=mainnet STELLAR_IDENTITY=my-mainnet-id bash deploy/deploy.sh)
echo "Deployed: $CONTRACT_ID"
```

### Frontend (`frontend/.env.local`) variables

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_CONTRACT_ID` | ✅ | Deployed contract address (`C…`) from `deploy.sh` stdout |
| `NEXT_PUBLIC_RPC_URL` | ✅ | Soroban RPC endpoint (must match the network Freighter is on) |
| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | ✅ | Stellar network passphrase — must match Freighter's selected network |

Copy `frontend/.env.example` to `frontend/.env.local` and fill in the values above. See [README.md → Frontend → Configure environment variables](../README.md#2-configure-environment-variables) for the full setup walkthrough.
