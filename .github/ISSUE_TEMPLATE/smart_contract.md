---
name: Smart Contract Change
about: Propose or report an issue related to the Soroban subscription contract
title: "[CONTRACT] "
labels: contract
assignees: ""
---

## Summary

<!-- One-sentence description of the change or issue. -->

## Contract Entry Point(s) Affected

<!-- Check all that apply. -->
- [ ] `subscribe(subscriber, merchant, token, amount, interval)`
- [ ] `execute_payment(subscriber, merchant)`
- [ ] `cancel(subscriber, merchant)`
- [ ] `get_subscription(subscriber, merchant)` (read-only)
- [ ] Storage / TTL logic
- [ ] Event emission
- [ ] New entry point (describe below)

## Description

<!-- Detailed explanation of the proposed change or the observed bug, including relevant contract state transitions. -->

## Security Implications

<!-- This section is required for all contract changes. -->

### Auth / Authorization

<!-- Does this change affect `require_auth` checks or introduce new authorization requirements? -->

### Storage / TTL

<!-- Does this change alter what is written to persistent storage, or how TTL is managed? -->

### Cross-Contract Calls

<!-- Does this change add, remove, or modify calls to external contracts (e.g. SEP-41 token `transfer`, `approve`)? -->

### Economic / Invariant Impact

<!-- Could this change affect token balances, payment amounts, or the non-custodial guarantee that the contract never holds funds? -->

### Denial-of-Service Surface

<!-- Could an adversary exploit this change to lock subscriptions, inflate storage, or block payments? -->

## Test Plan

<!-- Describe the tests you will add or modify. Reference existing test files where applicable
     (contracts/subscription/src/lib.rs unit tests, property-based tests). -->

- [ ] Unit test for happy path
- [ ] Unit test for error / edge cases
- [ ] Property-based test (if invariant is affected)
- [ ] Manual testnet verification

## Checklist

- [ ] `make test` passes locally
- [ ] No new `unsafe` code introduced
- [ ] `docs/contract-api.md` updated if interface changes
- [ ] `README.md` error-code table updated if new errors added
- [ ] Migration / re-deployment plan described (if storage layout changes)
