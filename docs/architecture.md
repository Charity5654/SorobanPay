# SorobanPay Architecture

This document is the authoritative reference for SorobanPay's system architecture. It covers the three-layer design, data flows, component interactions, backend role definition, deployment topologies, and technology rationale.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Component Responsibility Matrix](#2-component-responsibility-matrix)
3. [Data Flow Diagrams](#3-data-flow-diagrams)
   - [subscribe flow](#31-subscribe-flow)
   - [execute_payment flow](#32-execute_payment-flow)
   - [cancel flow](#33-cancel-flow)
   - [Event indexing flow](#34-event-indexing-flow)
4. [Backend Role Definition](#4-backend-role-definition)
5. [Inter-Service Communication](#5-inter-service-communication)
6. [Deployment Topologies](#6-deployment-topologies)
   - [Single-server](#61-single-server)
   - [Docker Compose](#62-docker-compose)
   - [Kubernetes](#63-kubernetes)
7. [Storage TTL and Entry Lifecycle](#7-storage-ttl-and-entry-lifecycle)
8. [Technology Choices and Rationale](#8-technology-choices-and-rationale)
9. [Event Schema Reference](#9-event-schema-reference)
10. [Backend Service Inventory](#10-backend-service-inventory)

---

## 1. System Overview

SorobanPay is a non-custodial recurring payments protocol built on Stellar's Soroban smart contract platform. The system has three independent layers:

```mermaid
graph TD
    subgraph Browser["Browser (Subscriber / Merchant)"]
        FE["Frontend\nNext.js 14 + Freighter"]
    end

    subgraph Chain["Stellar Blockchain"]
        CONTRACT["Soroban Contract\nSubscriptionProtocol"]
        TOKEN["SEP-41 Token\nContract"]
        LEDGER["Persistent Storage\n(subscription entries)"]
    end

    subgraph Backend["Optional Backend (read-only)"]
        API["Express REST API\n:3001"]
        INDEXER["EventIndexer\n(cron every 5 min)"]
        SCHEDULER["PaymentScheduler\n(cron every 1 min)"]
        SUMMARY["PayoutSummaryGenerator\n(cron daily/weekly)"]
        RECONCILER["Reconciler\n(cron every hour)"]
        WEBHOOK["WebhookNotifier"]
        DB[("PostgreSQL\n(Prisma ORM)")]
    end

    RPC["Soroban RPC\nhttps://soroban-testnet.stellar.org"]

    FE -->|"sign & submit txn"| RPC
    RPC -->|"broadcast"| CONTRACT
    CONTRACT -->|"transfer()"| TOKEN
    CONTRACT -->|"set/get/remove"| LEDGER
    CONTRACT -->|"emit events"| RPC

    INDEXER -->|"getEvents()"| RPC
    SCHEDULER -->|"simulateTransaction()\nsubmitTransaction()"| RPC
    INDEXER -->|"upsert"| DB
    SUMMARY -->|"read/write"| DB
    RECONCILER -->|"read/write"| DB
    WEBHOOK -->|"HTTP POST"| MerchantEndpoint["Merchant\nWebhook Endpoint"]
    API -->|"SELECT"| DB
```

The contract is the **sole source of truth** for subscription state. The backend is **read-only with respect to the chain** — it observes events and serves derived data, but never alters chain state (except the optional `PaymentScheduler`, which can be disabled by omitting `OPERATOR_SECRET`).

---

## 2. Component Responsibility Matrix

| Concern | Contract | Frontend | Backend |
|---------|:--------:|:--------:|:-------:|
| Store subscription state | ✅ | ❌ | ❌ |
| Execute token transfer | ✅ | ❌ | ❌ |
| Enforce time-lock | ✅ | ❌ | ❌ |
| Emit structured events | ✅ | ❌ | ❌ |
| Manage storage TTL | ✅ | ❌ | ❌ |
| Sign transactions | ❌ | ✅ | ❌* |
| Submit transactions to RPC | ❌ | ✅ | ❌* |
| Display subscription UI | ❌ | ✅ | ❌ |
| Connect Freighter wallet | ❌ | ✅ | ❌ |
| Index contract events | ❌ | ❌ | ✅ |
| Detect cancellations | ❌ | ❌ | ✅ |
| Serve analytics REST API | ❌ | ❌ | ✅ |
| Generate payout summaries | ❌ | ❌ | ✅ |
| Send webhook notifications | ❌ | ❌ | ✅ |
| Reconcile chain vs. DB state | ❌ | ❌ | ✅ |

> *The `PaymentScheduler` can submit `execute_payment` transactions when `OPERATOR_SECRET` is configured, making it a semi-active participant. This mode is **opt-in** and disabled by default.

### What each component owns

**Smart Contract (`contracts/subscription/`):**
- Subscription records in Soroban persistent storage, keyed by `(subscriber, merchant)`.
- All token movement — transfers go directly subscriber → merchant via SEP-41 `transfer()`.
- Authorization enforcement via `require_auth()` on every entry point.
- Event publication to the Soroban event log.

**Frontend (`frontend/`):**
- Browser-side wallet connection and transaction signing via Freighter.
- User-facing forms for subscribing, viewing state, and cancelling.
- No server-side rendering logic; a static Next.js App Router app.

**Backend (`backend/`):**
- Derived read models built from indexed events (PostgreSQL via Prisma).
- Cron-scheduled indexing, summary generation, reconciliation, and (optionally) payment scheduling.
- REST endpoints consumed by merchant dashboards.
- Webhook delivery to merchant-configured endpoints.

---

## 3. Data Flow Diagrams

### 3.1 subscribe flow

```mermaid
sequenceDiagram
    actor Subscriber
    participant Freighter
    participant Frontend as Next.js Frontend
    participant RPC as Soroban RPC
    participant Contract as SubscriptionProtocol
    participant Token as SEP-41 Token

    Subscriber->>Frontend: Fill subscription form
    Frontend->>Freighter: buildTransaction(subscribe(...))
    Freighter-->>Subscriber: Prompt to approve
    Subscriber->>Freighter: Approve & sign
    Freighter-->>Frontend: signed XDR
    Frontend->>RPC: submitTransaction(signedXDR)
    RPC->>Contract: invoke subscribe(subscriber, merchant, token, amount, interval)
    Contract->>Contract: require_auth(subscriber)
    Contract->>Contract: validate inputs
    Contract->>Contract: write SubscriptionData to persistent storage
    Contract->>Contract: extend_ttl(key, MIN_TTL, MAX_TTL)
    Contract->>RPC: emit event "subscribe"
    RPC-->>Frontend: tx result
    Frontend-->>Subscriber: SuccessCard (tx hash)
```

**Key invariants:**
- `subscriber.require_auth()` is called before any state mutation.
- `next_payment = ledger_timestamp + interval` — the first payment window opens immediately.
- If the `(subscriber, merchant)` pair already exists, the record is overwritten (update semantics).

### 3.2 execute_payment flow

```mermaid
sequenceDiagram
    actor Merchant
    participant RPC as Soroban RPC
    participant Contract as SubscriptionProtocol
    participant Token as SEP-41 Token
    participant Backend as Backend EventIndexer

    Merchant->>RPC: invoke execute_payment(subscriber, merchant)
    RPC->>Contract: execute_payment(subscriber, merchant)
    Contract->>Contract: require_auth(merchant)
    Contract->>Contract: load SubscriptionData
    Contract->>Contract: check now >= next_payment
    Contract->>Token: balance(subscriber)
    alt insufficient balance
        Contract->>RPC: emit "payment_transfer_failure"
        Contract-->>RPC: Err(TransferFailed)
    else sufficient balance
        Contract->>Token: transfer(subscriber, merchant, amount)
        Contract->>Contract: next_payment = now + interval
        Contract->>Contract: persist updated SubscriptionData
        Contract->>Contract: extend_ttl(key, MIN_TTL, MAX_TTL)
        Contract->>RPC: emit "payment_transfer_success"
        Contract->>RPC: emit "executed"
        Contract-->>RPC: Ok(())
    end
    Backend->>RPC: getEvents() [every 5 min]
    RPC-->>Backend: events
    Backend->>Backend: persist to PostgreSQL
```

**Late-payment rescheduling:** When a payment is collected after its scheduled time, `next_payment` is set to `now + interval` (not `old_next_payment + interval`). This prevents schedule drift from cascading across billing cycles. See the contract source for the full design rationale.

### 3.3 cancel flow

```mermaid
sequenceDiagram
    actor Subscriber
    participant Frontend as Next.js Frontend
    participant RPC as Soroban RPC
    participant Contract as SubscriptionProtocol
    participant Backend as Backend EventIndexer

    Subscriber->>Frontend: Click Cancel
    Frontend->>RPC: invoke cancel(subscriber, merchant)
    RPC->>Contract: cancel(subscriber, merchant)
    Contract->>Contract: require_auth(subscriber)
    Contract->>Contract: has(key)?
    alt no subscription
        Contract-->>RPC: Err(NoActiveSubscription)
    else subscription exists
        Contract->>Contract: remove(key)
        Contract->>RPC: emit "cancel"
        Contract-->>RPC: Ok(())
    end
    Backend->>RPC: getEvents() [next poll]
    RPC-->>Backend: cancel event
    Backend->>Backend: mark subscription inactive in DB
```

### 3.4 Event indexing flow

```mermaid
flowchart TD
    A["node-cron: every 5 min"] --> B["EventIndexer.fetchAndStoreEvents()"]
    B --> C["SorobanRpc.getEvents()\nfilter: contractId, startLedger"]
    C --> D{"events.length > 0?"}
    D -->|No| E["log: no new events"]
    D -->|Yes| F["for each event"]
    F --> G["decodeScValSymbol(topics[0])"]
    G --> H{"eventType in\n{subscribe, executed}?"}
    H -->|No| I["skip"]
    H -->|Yes| J["decode subscriber, merchant,\ntoken, amount"]
    J --> K{"duplicate\nin DB?"}
    K -->|Yes| I
    K -->|No| L["prisma.event.create()"]
    L --> M{"eventType == executed?"}
    M -->|Yes| N["AuditLogger.logPayment()"]
    M -->|No| O["done"]
    N --> O

    P["node-cron: every hour"] --> Q["Reconciler.run()"]
    Q --> R["fetchChainEventsFromDB()"]
    Q --> S["PrismaSubscriptionDB.load()"]
    R --> T["reconcile(chainEvents, db)"]
    S --> T
    T --> U["apply repairs"]
    U --> V["log errors"]
```

---

## 4. Backend Role Definition

The backend is **read-only with respect to the chain**. It never submits transactions, never holds funds, and never stores private keys.

### Definitive statement

> The SorobanPay backend polls `getEvents()` from Soroban RPC to build derived read models in PostgreSQL. It exposes these models via a REST API and sends webhook notifications to merchant-configured endpoints. It does **not** submit transactions to the Stellar network except via the opt-in `PaymentScheduler` (disabled by default).

### Service roles

| Service | Trigger | Role |
|---------|---------|------|
| `EventIndexer` | cron every 5 min | Polls Soroban RPC, decodes and persists `subscribe` and `executed` events |
| `PayoutSummaryGenerator` | cron daily at 01:00, weekly Sunday at 02:00 | Aggregates payment history into `PayoutSummary` rows per merchant |
| `PaymentScheduler` | cron every 1 min (opt-in) | Submits `execute_payment` for due subscriptions; **disabled if `OPERATOR_SECRET` is unset** |
| `Reconciler` | cron every hour | Compares chain event log against DB state; emits repair actions |
| `WebhookNotifier` | triggered by indexer | HTTP POST to merchant webhook URLs on significant events |
| `Express REST API` | on-demand HTTP | Serves `/api/summaries/:merchant` and `/api/reconcile` endpoints |

### What the backend does NOT do

- It does not store subscriber funds or merchant balances.
- It does not have authority over the smart contract.
- It cannot cancel or modify subscriptions.
- It does not hold Stellar keypairs (unless `OPERATOR_SECRET` is set for the optional scheduler).
- It is not required for the contract to function — subscriptions work without any backend deployed.

---

## 5. Inter-Service Communication

### How the REST API reads from the indexer's database

The `EventIndexer` and the REST API share the same PostgreSQL database (accessed via Prisma). There is no message bus between them — the indexer writes rows to `Event`, `AuditLog`, and `PayoutSummary` tables, and the API reads from those tables directly.

```
EventIndexer ──writes──► PostgreSQL ◄──reads── Express REST API
                              ▲
PayoutSummaryGenerator ──writes─┘
```

This is an intentional simplicity choice: for the traffic volume of a merchant dashboard, a shared database is sufficient and avoids operational complexity.

### How the webhook worker consumes events

The `WebhookNotifier` is not a separate process — it is called inline from the `EventIndexer` after a successful event persist. The delivery is HTTP POST with HMAC-SHA256 signature (signed with `WEBHOOK_SECRET`).

```mermaid
sequenceDiagram
    participant Indexer as EventIndexer
    participant DB as PostgreSQL
    participant WH as WebhookNotifier
    participant Merchant as Merchant Endpoint

    Indexer->>DB: prisma.event.create(decoded)
    Indexer->>DB: SELECT webhook_endpoints WHERE merchant=...
    Indexer->>WH: notifyMerchant(event, endpoints)
    WH->>WH: compute HMAC-SHA256(payload, WEBHOOK_SECRET)
    WH->>Merchant: POST /webhook {event, signature}
    Merchant-->>WH: 200 OK
    WH->>DB: prisma.webhookDelivery.create(attempt, status)
```

Failed deliveries (non-2xx or timeout) are recorded in `WebhookDelivery` for retry inspection. The backend uses an exponential-backoff retry loop within the `PaymentScheduler` retry helper (`backend/src/lib/retry.ts`).

### Reconciler

The `Reconciler` (hourly cron) compares the DB's view of subscriptions against the event log to detect drift. It uses `fetchChainEventsFromDB()` to reconstruct chain state from stored events, then diffs against the live `subscriptions` table. Detected discrepancies are logged as `repairs` or `errors`.

---

## 6. Deployment Topologies

### 6.1 Single-server

Suitable for development, staging, or low-traffic production.

```
┌─────────────────────────────────────────────────────────┐
│  Single VM or VPS                                        │
│                                                          │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────┐  │
│  │  Next.js      │  │  Express      │  │  PostgreSQL │  │
│  │  (port 3000)  │  │  (port 3001)  │  │  (port 5432)│  │
│  └───────────────┘  └───────────────┘  └─────────────┘  │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │  nginx reverse proxy (ports 80 / 443)               │ │
│  │  /         → Next.js :3000                          │ │
│  │  /api      → Express :3001                          │ │
│  └─────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

**Setup:**

```bash
# 1. Start PostgreSQL
sudo systemctl start postgresql
createdb sorobanpay

# 2. Backend
cd backend
cp .env.example .env  # fill in DATABASE_URL, RPC_URL, CONTRACT_ID
npx prisma migrate deploy
npm start  # listens on :3001

# 3. Frontend
cd frontend
cp .env.example .env.local  # fill in NEXT_PUBLIC_CONTRACT_ID
npm run build
npm start  # listens on :3000
```

### 6.2 Docker Compose

For reproducible local development or single-host production with service isolation.

```yaml
# docker-compose.yml
version: "3.9"

services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: sorobanpay
      POSTGRES_USER: soroban
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - pgdata:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U soroban"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    environment:
      DATABASE_URL: postgresql://soroban:${POSTGRES_PASSWORD}@postgres:5432/sorobanpay
      RPC_URL: ${RPC_URL}
      CONTRACT_ID: ${CONTRACT_ID}
      NETWORK_PASSPHRASE: ${NETWORK_PASSPHRASE}
      PORT: 3001
      WEBHOOK_SECRET: ${WEBHOOK_SECRET}
    ports:
      - "3001:3001"
    depends_on:
      postgres:
        condition: service_healthy
    command: sh -c "npx prisma migrate deploy && node dist/index.js"

  frontend:
    build: ./frontend
    environment:
      NEXT_PUBLIC_CONTRACT_ID: ${CONTRACT_ID}
      NEXT_PUBLIC_RPC_URL: ${RPC_URL}
      NEXT_PUBLIC_NETWORK_PASSPHRASE: ${NETWORK_PASSPHRASE}
    ports:
      - "3000:3000"

volumes:
  pgdata:
```

```bash
# Start all services
cp .env.example .env  # fill in secrets
docker compose up -d

# View logs
docker compose logs -f backend
```

### 6.3 Kubernetes

For production workloads requiring horizontal scaling, rolling deployments, and secret management via Kubernetes Secrets or an external vault.

```mermaid
graph TD
    subgraph Cluster["Kubernetes Cluster"]
        subgraph NS["Namespace: sorobanpay"]
            ING["Ingress\nnginx-ingress"]
            FE_SVC["Service\nfrontend :3000"]
            BE_SVC["Service\nbackend :3001"]
            FE_DEPLOY["Deployment\nfrontend\n(2 replicas)"]
            BE_DEPLOY["Deployment\nbackend\n(2 replicas)"]
            DB_SVC["Service\npostgres :5432"]
            DB_SS["StatefulSet\npostgres\n(1 replica)"]
            PVC["PersistentVolumeClaim\n10Gi"]
            SECRETS["Secret\nsorobanpay-secrets"]
        end
    end

    Internet["Internet"] --> ING
    ING -->|"/"| FE_SVC
    ING -->|"/api"| BE_SVC
    FE_SVC --> FE_DEPLOY
    BE_SVC --> BE_DEPLOY
    BE_DEPLOY --> DB_SVC
    DB_SVC --> DB_SS
    DB_SS --> PVC
    BE_DEPLOY -.->|"envFrom"| SECRETS
    FE_DEPLOY -.->|"envFrom"| SECRETS
```

**Minimal manifest snippets:**

```yaml
# secrets.yaml (values are base64-encoded)
apiVersion: v1
kind: Secret
metadata:
  name: sorobanpay-secrets
  namespace: sorobanpay
type: Opaque
data:
  DATABASE_URL: <base64>
  WEBHOOK_SECRET: <base64>
  OPERATOR_SECRET: <base64>   # optional; omit to disable PaymentScheduler

---
# backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: backend
  namespace: sorobanpay
spec:
  replicas: 2
  selector:
    matchLabels:
      app: backend
  template:
    metadata:
      labels:
        app: backend
    spec:
      containers:
        - name: backend
          image: your-registry/sorobanpay-backend:latest
          ports:
            - containerPort: 3001
          envFrom:
            - secretRef:
                name: sorobanpay-secrets
          env:
            - name: RPC_URL
              value: "https://soroban-testnet.stellar.org"
            - name: PORT
              value: "3001"
          readinessProbe:
            httpGet:
              path: /health
              port: 3001
            initialDelaySeconds: 10
            periodSeconds: 5
```

**Scaling considerations:**

- The `EventIndexer` cron job should run on **one replica only** (use a leader-election sidecar or disable horizontal scaling for cron-bearing pods, or extract crons into a dedicated `CronJob` resource).
- The REST API and `WebhookNotifier` are stateless and scale horizontally.
- Use `PodDisruptionBudget` to maintain availability during rolling updates.

---

## 7. Storage TTL and Entry Lifecycle

Soroban persistent entries have a TTL measured in ledgers (not wall-clock time). SorobanPay sets explicit TTL values on every write:

| Constant | Ledgers | Wall-clock (approx.) |
|----------|---------|----------------------|
| `MIN_TTL_LEDGERS` | 518,400 | ~30 days |
| `MAX_TTL_LEDGERS` | 6,307,200 | ~365 days |

`extend_ttl(key, MIN_TTL, MAX_TTL)` is a no-op if the remaining TTL is already above `MIN_TTL`. When extension is needed, the entry is bumped to `MAX_TTL`.

```
subscribe()         ─────────────────────────────────────► TTL = MAX (~365 days)
execute_payment()   ─────────────────────────────────────► TTL reset to MAX
get_subscription()  ─────────────────────────────────────► TTL reset to MAX
cancel()            → entry removed (TTL irrelevant)
```

Subscriptions that go a full year without a successful payment expire and are garbage-collected by the Soroban host — they cannot be read or paid against. A new `subscribe()` recreates the entry.

---

## 8. Technology Choices and Rationale

### Why Soroban

Soroban is Stellar's smart contract platform, chosen for:

- **WASM execution**: Contracts compile to compact, deterministic WASM. SorobanPay's optimised release binary is typically < 30 KB.
- **Persistent storage with TTL**: Native support for per-entry storage lifetimes, essential for garbage-collecting stale subscriptions without contract-level cleanup logic.
- **SEP-41 token interface**: A standard fungible-token interface on Stellar, enabling compatibility with USDC, XLM wrapped tokens, and any other SEP-41 asset without bespoke integrations.
- **Per-invocation auth**: `require_auth()` enforces fresh signatures on every call, eliminating stored session vulnerabilities.
- **Low fees**: Soroban resource fees are predictable and far lower than EVM-equivalent operations, making micro-subscription amounts (e.g., $1/month) economically viable.
- **Finality in ~5 seconds**: Stellar's consensus produces irreversible ledger finality in one round, with no probabilistic confirmation lag.

### Why Next.js 14

- **App Router**: React Server Components enable static rendering of UI shell; client components are hydrated only where wallet interaction is needed.
- **TypeScript**: End-to-end type safety from Stellar SDK types to form state.
- **Tailwind CSS**: Utility-first styling colocated with components; no separate CSS bundle.
- **Zero server-side secrets**: The frontend has no backend-facing API routes. All Soroban RPC calls originate in the browser, consistent with the non-custodial model.

### Why PostgreSQL + Prisma

- **ACID transactions**: Event upserts are idempotent; duplicate events from cursor re-processing are handled by unique constraints.
- **Structured queries**: Complex analytics (revenue by merchant, payment frequency, subscriber churn) require relational joins that document stores make awkward.
- **Prisma ORM**: Type-safe schema migrations and generated client eliminate a class of runtime errors from raw SQL string building.
- **Operational maturity**: Managed PostgreSQL is available on every major cloud provider (RDS, Cloud SQL, Supabase, Neon) with point-in-time recovery.

### Why Express (not Fastify / NestJS / Hono)

- Minimal dependency surface for a read-only analytics API.
- `node-cron` integration is straightforward in a single Express process.
- The backend is not a critical path for the protocol — it enhances UX but is not required for subscription correctness.

---

## 9. Event Schema Reference

All events are published to the Soroban event log and available via `getEvents()` RPC.

| Event | Topics | Data | Emitted by |
|-------|--------|------|-----------|
| `subscribe` | `(symbol, subscriber, merchant, token)` | `amount: i128` | `subscribe()` |
| `executed` | `(symbol, subscriber, merchant, token)` | `amount: i128` | `execute_payment()`, `execute_payment_batch()` |
| `payment_transfer_failure` | `(symbol, subscriber, merchant)` | `amount: i128` | `execute_payment()`, `execute_payment_batch()` |
| `payment_transfer_success` | `(symbol, subscriber, merchant)` | `amount: i128` | `execute_payment_batch()` |
| `cancel` | `(symbol, subscriber, merchant)` | `()` | `cancel()` |
| `batch_execute_initiated` | `(symbol, merchant)` | `batch_size: i128` | `execute_payment_batch()` |

**Decoding example (TypeScript):**

```typescript
import { xdr, scValToNative } from "@stellar/stellar-sdk";

function decodeEvent(topics: string[], value: string) {
  const [type, subscriber, merchant, token] = topics.map((t) =>
    scValToNative(xdr.ScVal.fromXDR(t, "base64"))
  );
  const amount = BigInt(scValToNative(xdr.ScVal.fromXDR(value, "base64")));
  return { type, subscriber, merchant, token, amount };
}
```

For the full event reference and RPC query examples, see [docs/events.md](events.md).

---

## 10. Backend Service Inventory

| File | Service | Schedule | Description |
|------|---------|----------|-------------|
| `src/services/eventIndexer.ts` | `EventIndexer` | every 5 min | Polls RPC, decodes events, persists to `Event` and `AuditLog` |
| `src/services/payoutSummaryGenerator.ts` | `PayoutSummaryGenerator` | daily 01:00, weekly Sun 02:00 | Aggregates payments into `PayoutSummary` rows |
| `src/services/paymentScheduler.ts` | `PaymentScheduler` | every 1 min (opt-in) | Submits `execute_payment` for due subscriptions |
| `src/services/reconciler.ts` | `Reconciler` | every hour | Diffs chain event log vs. DB; applies repairs |
| `src/services/webhookNotifier.ts` | `WebhookNotifier` | triggered | HTTP POST to merchant endpoints on events |
| `src/routes/subscriptions.ts` | REST | on-demand | `GET /api/subscriptions/:subscriber` |
| `src/routes/summaries.ts` | REST | on-demand | `GET /api/summaries/:merchant` |
| `src/routes/reconcile.ts` | REST | on-demand | `POST /api/reconcile` |
| `src/routes/health.ts` | REST | on-demand | `GET /health` — liveness check |
| `src/routes/auditLogs.ts` | REST | on-demand | `GET /api/audit-logs/:merchant` |

### Prisma schema summary

| Table | Purpose |
|-------|---------|
| `Event` | Raw decoded contract events (`subscribe`, `executed`) |
| `AuditLog` | Enriched payment records with tx hash and status |
| `PayoutSummary` | Aggregated daily/weekly revenue per merchant |
| `WebhookEndpoint` | Registered merchant webhook URLs |
| `WebhookDelivery` | Per-attempt delivery log (status code, error, retry count) |

---

## References

- [Soroban RPC Documentation](https://developers.stellar.org/docs/learn/soroban-rpc/events)
- [SEP-41 Token Interface](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md)
- [Stellar JavaScript SDK](https://developers.stellar.org/docs/learn/stellar-sdk)
- [Freighter Wallet](https://www.freighter.app)
- [Prisma ORM](https://www.prisma.io/docs)
- [docs/events.md](events.md) — full event reference
- [docs/security.md](security.md) — security model and secrets management
- [docs/contract-api.md](contract-api.md) — entry point parameter reference
