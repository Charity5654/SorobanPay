# Architecture Workflow Diagrams

Visual diagrams for SorobanPay's system architecture, transaction flows, deployment pipeline, and event indexing. All diagrams use [Mermaid](https://mermaid.js.org/) syntax and render natively in GitHub, GitLab, and most Markdown previewers.

For the written architecture description and storage/event schemas see [docs/architecture.md](./architecture.md).

---

## Table of Contents

1. [System overview](#1-system-overview)
2. [Subscribe flow](#2-subscribe-flow)
3. [Execute payment flow](#3-execute-payment-flow)
4. [Cancel flow](#4-cancel-flow)
5. [Update subscription flow](#5-update-subscription-flow)
6. [Deployment pipeline](#6-deployment-pipeline)
7. [Event indexing flow](#7-event-indexing-flow)
8. [Wallet connection UX states](#8-wallet-connection-ux-states)

---

## 1. System overview

High-level component map showing all layers of SorobanPay and how they interact.

```mermaid
graph TB
    subgraph Browser["Browser (Subscriber)"]
        FE["Frontend<br/>Next.js 14 + TypeScript"]
        FW["Freighter Wallet<br/>Extension"]
    end

    subgraph Chain["Stellar / Soroban"]
        RPC["Soroban RPC<br/>getEvents · simulateTransaction · sendTransaction"]
        SC["Soroban Contract<br/>subscribe · execute_payment · cancel"]
        TOKEN["SEP-41 Token Contract<br/>transfer · balance · allowance"]
        LEDGER["Soroban Ledger<br/>Persistent Storage · TTL"]
    end

    subgraph OffChain["Off-Chain (Optional)"]
        BE["Backend / Indexer<br/>Node.js + PostgreSQL"]
        MERCHANT["Merchant Portal<br/>or Admin Panel"]
    end

    FE -- "1 signs tx" --> FW
    FW -- "2 returns signed tx" --> FE
    FE -- "3 submit/simulate" --> RPC
    RPC -- "4 invoke" --> SC
    SC -- "5 transfer" --> TOKEN
    SC -- "6 write/read" --> LEDGER
    SC -- "7 emit events" --> RPC
    RPC -- "8 poll getEvents()" --> BE
    BE -- "9 REST/GraphQL API" --> MERCHANT
    MERCHANT -- "10 trigger execute_payment" --> RPC
```

---

## 2. Subscribe flow

Detailed sequence: subscriber creates a new recurring payment agreement.

```mermaid
sequenceDiagram
    participant S as Subscriber (Freighter)
    participant F as Frontend (Next.js)
    participant R as Soroban RPC
    participant C as Soroban Contract
    participant L as Soroban Ledger

    S->>F: Fill form (merchant, token, amount, interval)
    F->>R: simulateTransaction(subscribe)
    R-->>F: fee estimate + resource budget
    F->>S: Freighter signing popup
    S-->>F: Signed transaction envelope
    F->>R: sendTransaction(signed tx)
    R->>C: invoke subscribe(subscriber, merchant, token, amount, interval)
    C->>C: require_auth(subscriber) ✓
    C->>C: Validate: subscriber ≠ merchant
    C->>C: Validate: 0 < amount ≤ 10¹⁸
    C->>C: Validate: 86400 ≤ interval ≤ 31536000
    C->>C: next_payment = ledger.timestamp + interval
    C->>L: persistent.set(DataKey::Subscription(subscriber, merchant))
    C->>L: extend_ttl(MIN_TTL=30d, MAX_TTL=365d)
    C->>R: emit event: subscribe(subscriber, merchant, token, amount)
    R-->>F: Transaction result (txHash, status)
    F-->>S: Success card with tx hash
```

---

## 3. Execute payment flow

Merchant collects a due recurring payment from a subscriber.

```mermaid
sequenceDiagram
    participant M as Merchant
    participant R as Soroban RPC
    participant C as Soroban Contract
    participant T as SEP-41 Token Contract
    participant L as Soroban Ledger

    M->>R: invoke execute_payment(subscriber, merchant)
    R->>C: execute_payment(subscriber, merchant)
    C->>C: require_auth(merchant) ✓
    C->>L: persistent.get(DataKey::Subscription(subscriber, merchant))

    alt No subscription found
        C-->>R: Err(NoActiveSubscription) [error 4]
    else Subscription exists
        C->>C: now = ledger.timestamp()
        alt now < next_payment
            C-->>R: Err(PaymentNotDue) [error 5]
        else Payment is due
            C->>T: balance(subscriber)
            alt balance < amount
                C->>R: emit payment_transfer_failure(subscriber, merchant, amount)
                C-->>R: Err(TransferFailed) [error 7]
            else Sufficient balance
                C->>T: transfer(subscriber → merchant, amount)
                T-->>C: Ok
                C->>C: next_payment = now + interval
                C->>L: persistent.set(updated SubscriptionData)
                C->>L: extend_ttl(MIN_TTL, MAX_TTL)
                C->>R: emit executed(subscriber, merchant, token, amount)
                C-->>R: Ok
            end
        end
    end
    R-->>M: Transaction result
```

---

## 4. Cancel flow

Subscriber terminates their subscription.

```mermaid
sequenceDiagram
    participant S as Subscriber (Freighter)
    participant F as Frontend (Next.js)
    participant R as Soroban RPC
    participant C as Soroban Contract
    participant L as Soroban Ledger

    S->>F: Click "Cancel subscription"
    F->>S: Freighter signing popup
    S-->>F: Signed transaction
    F->>R: sendTransaction(cancel)
    R->>C: invoke cancel(subscriber, merchant)
    C->>C: require_auth(subscriber) ✓
    C->>L: persistent.has(DataKey::Subscription) ?

    alt No subscription found
        C-->>R: Err(NoActiveSubscription) [error 4]
    else Subscription exists
        C->>L: persistent.remove(DataKey::Subscription)
        C->>R: emit cancel(subscriber, merchant)
        C-->>R: Ok
    end
    R-->>F: Transaction result
    F-->>S: Cancellation confirmed
```

---

## 5. Update subscription flow

Subscriber updates the amount or interval of an existing subscription.

```mermaid
sequenceDiagram
    participant S as Subscriber (Freighter)
    participant F as Frontend (Next.js)
    participant R as Soroban RPC
    participant C as Soroban Contract
    participant L as Soroban Ledger

    S->>F: Submit update (new amount, new interval)
    F->>S: Freighter signing popup
    S-->>F: Signed transaction
    F->>R: sendTransaction(update_subscription)
    R->>C: invoke update_subscription(subscriber, merchant, amount, interval)
    C->>C: require_auth(subscriber) ✓
    C->>L: persistent.get(DataKey::Subscription(subscriber, merchant))

    alt No subscription found
        C-->>R: Err(NoActiveSubscription) [error 4]
    else Subscription exists
        C->>C: Validate: 0 < amount ≤ 10¹⁸
        C->>C: Validate: 86400 ≤ interval ≤ 31536000
        C->>C: data.amount = new_amount
        C->>C: data.interval = new_interval
        C->>C: data.next_payment = now + new_interval
        C->>L: persistent.set(updated SubscriptionData)
        C->>L: extend_ttl(MIN_TTL, MAX_TTL)
        C->>R: emit subscribe(subscriber, merchant, token, new_amount)
        C-->>R: Ok
    end
    R-->>F: Transaction result
    F-->>S: Update confirmed
```

---

## 6. Deployment pipeline

How the contract is built, deployed, and connected to the frontend.

```mermaid
flowchart TD
    A[Developer runs\nmake build] --> B[cargo build --target wasm32-unknown-unknown --release]
    B --> C[contracts/target/.../soroban_subscription_contract.wasm]
    C --> D[bash deploy/deploy.sh]
    D --> E{STELLAR_NETWORK?}
    E -- testnet --> F[stellar contract deploy\n--network testnet\n--source alice]
    E -- mainnet --> G[stellar contract deploy\n--network mainnet\n--source my-mainnet-id]
    F --> H[Contract address printed to stdout\nCXXX...testnet]
    G --> I[Contract address printed to stdout\nCXXX...mainnet]
    H --> J[Copy address to\nfrontend/.env.local\nNEXT_PUBLIC_CONTRACT_ID=]
    I --> J
    J --> K[cd frontend && npm run dev\nor npm run build]
    K --> L[App running at\nhttp://localhost:3000]
```

---

## 7. Event indexing flow

How an optional off-chain backend indexes contract events for merchant dashboards.

```mermaid
flowchart LR
    subgraph Contract["Soroban Contract"]
        E1["subscribe event"]
        E2["executed event"]
        E3["payment_transfer_failure event"]
        E4["cancel event"]
    end

    subgraph RPC["Soroban RPC"]
        GE["getEvents()\ncursor-based pagination"]
    end

    subgraph Indexer["Backend Indexer (Node.js)"]
        POLL["Poll every 5–30s"]
        DECODE["Decode XDR topics + data\nscValToNative()"]
        PERSIST["Persist to DB"]
        STATE["Update indexer_state\n(save cursor)"]
    end

    subgraph DB["Database (PostgreSQL)"]
        SUB["subscriptions table"]
        PAY["payments table"]
        IDX["indexer_state table"]
    end

    subgraph API["REST / GraphQL API"]
        DASH["Merchant Dashboard"]
        ANALYTICS["Revenue Analytics"]
    end

    Contract --> RPC
    RPC --> POLL
    POLL --> DECODE
    DECODE --> PERSIST
    PERSIST --> SUB
    PERSIST --> PAY
    STATE --> IDX
    POLL --> STATE
    SUB --> API
    PAY --> API
    API --> DASH
    API --> ANALYTICS
```

---

## 8. Wallet connection UX states

State machine for the `SubscriptionForm` component's wallet and transaction lifecycle.

```mermaid
stateDiagram-v2
    [*] --> Disconnected : page load / Freighter not detected

    Disconnected --> Connected : user connects Freighter\nand approves site

    Connected --> AwaitingSignature : user submits form\n(isSubmitting = true)

    AwaitingSignature --> Success : user approves in Freighter\ntransaction confirmed\n(successData set)

    AwaitingSignature --> Error : user rejects\nor RPC / timeout error\n(txError set)

    Error --> AwaitingSignature : user fixes form\nand resubmits

    Success --> Connected : user clicks\n"Create another subscription"

    note right of Disconnected
        Gray badge · Submit disabled
        Yellow hint: "Connect your Freighter wallet"
    end note

    note right of Connected
        Green badge · Submit enabled
        Label: "Authorize Subscription"
    end note

    note right of AwaitingSignature
        Blue spinner + progress bar
        Submit disabled: "Submitting…"
    end note

    note right of Success
        Green SuccessCard
        Tx hash + next-steps guidance
    end note

    note right of Error
        Red alert with error message
        Form data preserved for retry
    end note
```
