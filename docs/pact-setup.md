# Pact Consumer-Driven Contract Tests

**Issue:** TEST-107  
**References:** [Pact documentation](https://pact.io), BE-52 (backend API)

---

## Overview

SorobanPay uses [Pact](https://docs.pact.io) to keep the frontend and backend API
in sync without requiring a live server. The approach is **consumer-driven**: the
frontend defines what it expects from the API, and the backend verifies it can
deliver exactly that.

```
Frontend (consumer)          Pact file             Backend (provider)
──────────────────────       ──────────────────     ──────────────────────
tests/pact/                  pacts/                 backend/tests/pact/
  api.consumer.pact.test.ts  ├─ SorobanPayFrontend- api.provider.pact.test.ts
    • records interactions    │  SorobanPayBackend
    • writes pact file ──────►│  .json ────────────► verifies backend satisfies
                                                      every recorded interaction
```

### Contracts covered

| ID | Endpoint | Description |
|----|----------|-------------|
| CONTRACT-1 | `GET /api/v1/subscriptions/merchant/:address` | Subscription list for a merchant |
| CONTRACT-2 | `GET /api/v1/subscriptions/merchant/:address/payments` | Payment history with pagination |
| CONTRACT-3 | `GET /health` | Health check — `{ status: "ok" }` |
| CONTRACT-4 | `POST /api/v1/webhooks/endpoints` | Webhook endpoint registration |
| CONTRACT-5 | `GET /api/v1/subscriptions/merchant/:address?token=` | Token-filtered subscription list |

---

## Run the current file-based workflow

Pact is already a development dependency in both packages. Install from each
lockfile when setting up a checkout or after dependency changes:

```bash
(cd frontend && npm ci)
```

```bash
(cd backend && npm ci)
```

### 1. Generate the consumer pact

Run the frontend consumer script from the repository root:

```bash
(cd frontend && npm run test:pact)
```

Jest runs `tests/pact/api.consumer.pact.test.ts` against Pact's local mock
server. A passing run writes
`pacts/SorobanPayFrontend-SorobanPayBackend.json` at the repository root. It
does not call a deployed backend or require wallet/API credentials.

### 2. Share the generated pact

This repository uses file-based sharing, not Pact Broker publication. Include
the generated pact JSON in the change and push it with the consumer change so
the provider verifier can read the same contract:

```bash
git status --short -- pacts/SorobanPayFrontend-SorobanPayBackend.json
git add pacts/SorobanPayFrontend-SorobanPayBackend.json
git commit -m "test(pact): update consumer contract"
git push
```

Expected result: the pact file is tracked in the branch and available at the
same path in the provider checkout. The current repository has no Pact Broker
URL, token, publisher command, or Pact CI job configured; do not add real
credentials to a pact file or commit.

### 3. Verify the provider

Run after the generated file is present at the repository root:

```bash
(cd backend && npm run test:pact)
```

The provider script runs
`tests/pact/api.provider.pact.test.ts`. It starts the covered Express routes on
a local random port, seeds in-memory Prisma mocks for each provider state, and
verifies the recorded interactions. A passing run reports the interactions as
verified; a request, response, or provider-state mismatch fails the Jest test.

---

## Broker publication and version selectors

The workflow above shares a committed JSON file. There is no Pact Broker
publication or Broker-based provider verification in the current setup, and
`.github/workflows/ci.yml` does not run the Pact scripts. Run the consumer and
provider commands above locally when changing a contract; a successful general
CI run should not be taken as evidence that Pact verification ran.

If the project later adopts a Pact Broker, publishing would upload a generated
consumer pact together with the consumer version and branch metadata. Provider
verification would then fetch pacts from the Broker rather than use `pactUrls`.
Broker credentials should be supplied through the CI secret store or local
environment, never committed or included in logs.

Broker version selectors decide which consumer versions a provider verifies.
For example, a Broker-backed verifier can select the consumer's main branch,
the branch matching the provider branch, and consumer versions currently
deployed or released:

```typescript
consumerVersionSelectors: [
  { mainBranch: true },
  { matchingBranch: true },
  { deployedOrReleased: true },
]
```

These selectors are not active in SorobanPay today: the current verifier uses
the single local pact path. Adding selectors requires Broker configuration and
version/branch metadata; it is not a filter applied to the committed file.

---

## File-based sharing (no Pact Broker required)

Pact files are committed to `pacts/` at the repo root. This is the simplest
approach for a monorepo: no external Pact Broker service is required.

For multi-team or multi-repo setups, a Pact Broker can provide centralized
publication and version selection, but adopting one requires explicit
configuration and credentials outside this file-based workflow.

---

## Adding a new contract

1. Identify the API call the frontend makes (URL, method, headers, body).
2. Add an `addInteraction` block in `frontend/tests/pact/api.consumer.pact.test.ts`.
3. Add a corresponding `stateHandlers` entry in `backend/tests/pact/api.provider.pact.test.ts`
   that seeds the correct mock DB state.
4. Run `(cd frontend && npm run test:pact)` to regenerate the JSON, then
  `(cd backend && npm run test:pact)` to verify it.
5. Update the contracts table in this README.

---

## Pact matchers reference

| Matcher | Import | Use |
|---------|--------|-----|
| `like(value)` | `MatchersV3` | Field must exist and be the same type |
| `string(example)` | `MatchersV3` | Must be a string; example used in mock |
| `integer(example)` | `MatchersV3` | Must be an integer |
| `eachLike(template)` | `MatchersV3` | Array with at least one element matching template |
| `nullValue()` | `MatchersV3` | Field must be `null` |
| `datetime(format, example)` | `MatchersV3` | ISO 8601 datetime string |

---

## Troubleshooting

**"Pact file not found"**  
Run `(cd frontend && npm run test:pact)` first. Confirm the generated file is
named `pacts/SorobanPayFrontend-SorobanPayBackend.json` at the repository root
and is present in the provider checkout.

**"Provider state not found"**  
The state description in `addInteraction` must match exactly (case-sensitive) the
key in `stateHandlers`. Check for typos.

**"Interaction not matched"**  
Compare the failed request and response with the consumer interaction's method,
path, query, headers, and body. Provider state descriptions are case-sensitive
and must exactly match the keys in `stateHandlers`. If more detail is needed,
temporarily enable debug logging in the verifier options; keep real credentials
and sensitive payloads out of pact fixtures and logs.

**Consumer and provider on different versions**  
Both packages declare Pact 12. Check their installed dependency with
`(cd frontend && npm ls @pact-foundation/pact)` and
`(cd backend && npm ls @pact-foundation/pact)`, then use `npm ci` to restore
versions from the matching lockfile if the install is inconsistent.
