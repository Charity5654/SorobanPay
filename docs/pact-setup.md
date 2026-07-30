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

## Quick start

### 1. Install Pact in both frontend and backend

```bash
# Frontend (consumer)
cd frontend
npm install --save-dev @pact-foundation/pact@12

# Backend (provider)
cd backend
npm install --save-dev @pact-foundation/pact@12
```

### 2. Generate the pact file (consumer tests)

```bash
cd frontend
npx jest tests/pact/api.consumer.pact.test.ts --verbose
```

This writes `pacts/SorobanPayFrontend-SorobanPayBackend.json` at the repo root.

### 3. Verify the backend satisfies the contract (provider tests)

```bash
cd backend
npx jest tests/pact/api.provider.pact.test.ts --verbose
```

The provider test reads the pact file and replays every interaction against the
real Express app (with mocked Prisma). The test fails if any interaction is not
satisfied.

---

## CI integration

The CI pipeline (`.github/workflows/ci.yml`) runs both steps automatically:

```
pact-consumer (frontend) → uploads pact file as artifact
                         ↓
pact-provider (backend)  ← downloads pact file → verifies
```

If the consumer test generates a contract that the backend cannot satisfy, the
`pact-provider` job fails and the PR cannot be merged.

---

## File-based sharing (no Pact Broker required)

Pact files are committed to `pacts/` at the repo root. This is the simplest
approach for a monorepo: no external Pact Broker service is required.

For multi-team or multi-repo setups, consider [PactFlow](https://pactflow.io)
(free tier available for OSS projects).

---

## Adding a new contract

1. Identify the API call the frontend makes (URL, method, headers, body).
2. Add an `addInteraction` block in `frontend/tests/pact/api.consumer.pact.test.ts`.
3. Add a corresponding `stateHandlers` entry in `backend/tests/pact/api.provider.pact.test.ts`
   that seeds the correct mock DB state.
4. Run consumer tests → run provider tests → both must pass.
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
Run consumer tests first: `cd frontend && npx jest tests/pact/api.consumer.pact.test.ts`

**"Provider state not found"**  
The state description in `addInteraction` must match exactly (case-sensitive) the
key in `stateHandlers`. Check for typos.

**"Interaction not matched"**  
Run with `logLevel: 'debug'` in the Verifier options to see the actual vs expected
request/response diff.

**Consumer and provider on different versions**  
Both must use the same major version of `@pact-foundation/pact`. Check with
`npm list @pact-foundation/pact` in each directory.
