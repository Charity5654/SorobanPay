# Integration Tests

This directory contains shell scripts for integration testing the SorobanPay smart contract against a **real local Soroban node** — not a mock environment.

## Why integration tests?

The contract unit tests (in `contracts/subscription/src/test.rs`) use the Soroban SDK's built-in `testutils` mock environment. That is fast and reliable for unit-level correctness, but it cannot:

- Exercise the actual Soroban host version deployed on-chain.
- Test real cross-contract calls to a SEP-41 token contract.
- Verify fee estimation against actual resource usage.
- Catch host-version-specific differences between SDK mocks and production behaviour.

The integration test suite (`scripts/integration-test.sh`) solves this by running everything against a live Docker-based local Soroban node.

## Prerequisites

| Tool | Install |
|------|---------|
| Docker | https://docs.docker.com/get-docker/ |
| Stellar CLI | `cargo install --locked stellar-cli --features opt` |
| Rust + `wasm32-unknown-unknown` | https://rustup.rs + `rustup target add wasm32-unknown-unknown` |

## Running locally

```bash
# From the repo root
bash scripts/integration-test.sh
```

Expected runtime: 1–3 minutes (mostly waiting for the Docker node to start).

## What the script tests

| Step | Test |
|------|------|
| 1 | Start local Soroban node via `stellar/quickstart` Docker image |
| 2 | Create and fund test accounts (alice = subscriber, bob = merchant) |
| 3 | Build the subscription contract WASM |
| 4 | Deploy a test token (native XLM as SAC) |
| 5 | Deploy the subscription contract |
| 6 | Set token allowance (alice → contract) |
| 7 | `subscribe()` — create subscription |
| 8 | Verify subscription state |
| 9 | `execute_payment()` — first payment, verify token transfer |
| 10 | `execute_payment()` (again) — verify `PaymentNotDue` error |
| 11 | `cancel()` — remove subscription |
| 12 | `execute_payment()` after cancel — verify `NoActiveSubscription` error |
| 13 | Verify event emission (`subscribe`, `executed`, `cancel`) |

## CI

The integration tests run in a separate GitHub Actions job (`contract-integration`) with a 10-minute timeout. See `.github/workflows/ci.yml`.

The job requires Docker support on the CI runner (`ubuntu-latest` on GitHub Actions has Docker pre-installed).

## Troubleshooting

**Docker pull fails**

The `stellar/quickstart` image is hosted on Docker Hub. If rate-limited, authenticate with `docker login` or wait and retry.

**Node takes too long to start**

The script waits up to 60 seconds for the RPC health endpoint. On slow CI runners this may be insufficient. Increase `WAIT_SECS` cap at the top of the script.

**`stellar` not found**

Install with:
```bash
cargo install --locked stellar-cli --features opt
```

**`PaymentNotDue` not returned on second payment**

This is expected if the local node's ledger timestamp advanced more than `INTERVAL` seconds between the first and second payment. The test logs a warning but does not fail.
