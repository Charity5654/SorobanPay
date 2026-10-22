# Local Development Guide

Everything you need to run the contract tests, build the WASM, start the
frontend, and connect Freighter — all from a clean checkout.

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Rust (stable) | stable | `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh` |
| `wasm32-unknown-unknown` target | — | `rustup target add wasm32-unknown-unknown` |
| Stellar CLI | ≥ 21.x | `cargo install --locked stellar-cli --features opt` |
| Node.js | ≥ 18.x | https://nodejs.org |
| Freighter extension | latest | https://www.freighter.app |

---

## 1. Run the contract tests

Tests live in `contracts/subscription/src/` and exercise the full lifecycle
(`subscribe`, `execute_payment`, `cancel`), error paths, auth guards, event
emissions, and property-based invariants.

```bash
make test
```

This runs:

```bash
cargo test --manifest-path contracts/subscription/Cargo.toml
```

The test binary is compiled for the **native host** (not WASM). Do **not** set
`TARGET_TRIPLE` when running tests — the Rust test harness cannot execute
inside a WASM target.

Expected output on success:

```
running N tests
test ... ok
...
test result: ok. N passed; 0 failed
```

To run a single test by name:

```bash
cargo test --manifest-path contracts/subscription/Cargo.toml <test_name>
```

---

## 2. Build the WASM

```bash
make build
```

This compiles the contract to:

```
contracts/target/wasm32-unknown-unknown/release/soroban_subscription_contract.wasm
```

The Cargo profile uses `opt-level = "z"` and `lto = true` for minimum size.

**Override target or profile:**

```bash
make build TARGET_TRIPLE=wasm32-unknown-unknown PROFILE=release
```

**Clean artifacts:**

```bash
make clean
```

---

## 3. Start the frontend

### 3a. Deploy the contract (one-time per environment)

The frontend requires a live contract address.

```bash
# Create a testnet identity (one-time)
stellar keys generate alice --network testnet

# Fund it via Friendbot (testnet only — free)
stellar keys fund alice --network testnet

# Deploy and capture the contract address
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "Contract: $CONTRACT_ID"
```

### 3b. Configure environment variables

```bash
cp frontend/.env.example frontend/.env.local
```

Edit `frontend/.env.local`:

```env
NEXT_PUBLIC_CONTRACT_ID=<paste CONTRACT_ID here>
NEXT_PUBLIC_RPC_URL=https://soroban-testnet.stellar.org
NEXT_PUBLIC_NETWORK_PASSPHRASE=Test SDF Network ; September 2015
```

All three variables are required. The dev server will show a
`ContractConfigError` card if `NEXT_PUBLIC_CONTRACT_ID` is missing or empty.

### 3c. Install dependencies and run

```bash
cd frontend
npm install
npm run dev
```

The app is now running at **http://localhost:3000**.

**Other useful commands:**

```bash
npm run build        # Production build
npm start            # Serve production build
npm run type-check   # TypeScript type check (no emit)
```

---

## 4. Connect Freighter

1. **Install** the Freighter browser extension from
   https://www.freighter.app (Chrome/Brave or Firefox).

2. **Open Freighter** and create or import a wallet.

3. **Switch to Testnet**: click the network name in the top-right of the
   Freighter popup → select **Testnet**.

4. **Fund your wallet** on testnet via
   [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test).

5. **Open http://localhost:3000** — Freighter will prompt for a site
   connection on the first interaction. Approve it.

6. The **Connected** green badge appears in the `SubscriptionForm` header
   once Freighter grants the connection.

### Freighter must match the app's network

The `NEXT_PUBLIC_NETWORK_PASSPHRASE` in `.env.local` must match the network
selected in Freighter, or all transactions will be rejected.

| `.env.local` passphrase | Freighter network to select |
|-------------------------|-----------------------------|
| `Test SDF Network ; September 2015` | Testnet |
| `Public Global Stellar Network ; September 2015` | Mainnet |

### Common Freighter issues

| Symptom | Fix |
|---------|-----|
| "Wallet not connected" badge stays gray | Open Freighter → approve the `localhost` connection, then reload |
| Signing popup never appears | Confirm the app is on `http://localhost` (not `file://`); disable conflicting wallet extensions |
| Transaction rejected — wrong network | Switch Freighter to the network that matches `NEXT_PUBLIC_NETWORK_PASSPHRASE` |
| "Insufficient balance" | Fund via Friendbot (testnet) or send XLM (mainnet) |
| Popup closes before you can sign | Disable browser pop-up blockers for `localhost` |

---

## Quick reference

```bash
# 1. Test the contract
make test

# 2. Build the WASM
make build

# 3. Deploy to testnet + start the frontend
stellar keys generate alice --network testnet
stellar keys fund alice --network testnet
CONTRACT_ID=$(bash deploy/deploy.sh)
echo "NEXT_PUBLIC_CONTRACT_ID=$CONTRACT_ID" >> frontend/.env.local
cd frontend && npm install && npm run dev
```

Open http://localhost:3000, connect Freighter (set to Testnet), and you are
ready to create subscriptions on-chain.

---

## 5. Local Database and Redis lifecycle

The backend uses **PostgreSQL** as its primary data store and **Redis** for
BullMQ webhook queues and caching. Both are included in the Docker Compose
stack defined in `docker-compose.yml`.

> ⚠️ **Data-loss warning**: `docker compose down -v` removes named volumes
> (`sorobanpay-pgdata`, `sorobanpay-redisdata`) and **permanently deletes all
> local data**. Use `docker compose down` (without `-v`) to stop containers
> while preserving data.

---

### 5.1 Starting services

```bash
# Start PostgreSQL and Redis in the background
docker compose up -d postgres redis

# Verify both are healthy before starting the backend
docker compose ps
```

**Expected output:**

```
NAME                   STATUS              PORTS
sorobanpay-postgres    running (healthy)   0.0.0.0:5432->5432/tcp
sorobanpay-redis       running (healthy)   0.0.0.0:6379->6379/tcp
```

If either shows `starting` or `unhealthy`, wait a few seconds and re-run
`docker compose ps`. PostgreSQL typically takes 5–10 seconds to become ready.

**Starting the full stack (backend + indexer):**

```bash
docker compose up -d
```

**Stopping without deleting data:**

```bash
docker compose down
```

**Stopping and deleting all local data (destructive):**

```bash
# WARNING: this removes all PostgreSQL and Redis data permanently
docker compose down -v
```

---

### 5.2 Running database migrations

Migrations are managed with Prisma. Always run migrations after pulling
changes that touch `backend/prisma/schema.prisma`.

```bash
cd backend

# Copy environment file if not already done
cp .env.example .env
# Edit .env — set DATABASE_URL to:
#   postgresql://sorobanpay:sorobanpay@localhost:5432/sorobanpay

# Apply all pending migrations
npx prisma migrate deploy
```

**Expected output:**

```
Prisma schema loaded from prisma/schema.prisma
Datasource "db": PostgreSQL database "sorobanpay" at "localhost:5432"

1 migration found in prisma/migrations that need to be applied:
Applying migration `20260101000000_init`
The following migration(s) have been applied:
  migrations/
    └─ 20260101000000_init/
      └─ migration.sql
Done in 1.23s
```

**Check current migration status:**

```bash
npx prisma migrate status
```

---

### 5.3 Seeding local data

The seed script (`scripts/seed-local-db.ts`) inserts fixture merchants,
subscription plans, webhook endpoints, and indexer checkpoint state so the
local backend has data to work with immediately.

```bash
# From the project root
npx ts-node scripts/seed-local-db.ts
```

**Expected output:**

```
🌱 Seeding local database with fixture records...
  ✓ Inserted 2 test merchants
  ✓ Inserted 2 subscription plans
✅ Local database seed completed successfully.
```

**Seed data summary:**

| Record type | Count | Notes |
|-------------|-------|-------|
| Merchants | 2 | `GMERCHANT...0001` and `GMERCHANT...0002` |
| Subscription plans | 2 | Starter Tier (15 USDC/30d) and Pro Tier (49 USDC/30d) |
| Webhook endpoints | 1 per merchant | Points to `http://localhost:4000/webhooks/*` |

Seed addresses use the pattern `GMERCHANT0000000000000000000000000000000000000000000001` — valid Stellar G-address format, safe for local use, not associated with any real account.

---

### 5.4 Resetting local data

Use the reset script to wipe all local data and start fresh without removing
Docker volumes (i.e. without `docker compose down -v`):

```bash
# Reset only (truncates tables and flushes Redis queues)
bash scripts/seed-and-reset.sh --reset-only
```

**Expected output:**

```
Executing database reset...
🧹 Resetting local development database...
  ✓ Cleaned events, subscriptions, and webhook delivery records
  ✓ Flushed pending retry queues
  ✓ Reset indexer state cursor to initial baseline
✅ Local database reset completed.
Done.
```

**Reset then immediately re-seed (most common workflow):**

```bash
bash scripts/seed-and-reset.sh
```

**Seed only (no reset — adds records on top of existing data):**

```bash
bash scripts/seed-and-reset.sh --seed-only
```

> **What gets reset:**
> - `events`, `subscriptions`, `webhooks`, `audit_logs` tables are truncated.
> - Indexer cursor is reset to the initial blank cursor (next poll starts from
>   the current ledger).
> - Pending BullMQ retry queues in Redis are flushed.
>
> **What does NOT get reset:**
> - Prisma migration history (`_prisma_migrations` table) — not touched.
> - Docker volumes — remain intact; data is erased at the row level, not
>   the storage level.

---

### 5.5 Inspecting local data

#### PostgreSQL — psql

```bash
# Connect to the local database
docker exec -it sorobanpay-postgres psql -U sorobanpay -d sorobanpay

# List tables
\dt

# Count events indexed so far
SELECT COUNT(*) FROM "Event";

# View the last 5 payments
SELECT subscriber, merchant, amount, "createdAt"
FROM "AuditLog"
ORDER BY "createdAt" DESC
LIMIT 5;

# Check indexer cursor state
SELECT * FROM "IndexerState";

# Exit psql
\q
```

#### PostgreSQL — Prisma Studio (browser UI)

```bash
cd backend
npx prisma studio
```

Opens a browser UI at **http://localhost:5555** for point-and-click data
inspection and editing. All tables are visible and editable.

#### Redis — redis-cli

```bash
# Connect to local Redis
docker exec -it sorobanpay-redis redis-cli

# Show all keys (use with care on large datasets — SCAN is safer)
KEYS *

# Check BullMQ queue depth for webhook jobs
LLEN bull:webhooks:wait

# Check active (processing) jobs
LLEN bull:webhooks:active

# Inspect a specific key
GET "subscription:GABC...SUBSCRIBER:GXYZ...MERCHANT"

# Exit redis-cli
EXIT
```

#### Redis — SCAN (safe for large datasets)

```bash
docker exec -it sorobanpay-redis redis-cli --scan --pattern "bull:*" | head -20
```

---

### 5.6 Health checks

#### PostgreSQL

```bash
# Quick connectivity check
docker exec sorobanpay-postgres pg_isready -U sorobanpay -d sorobanpay
```

**Expected output:**

```
localhost:5432 - accepting connections
```

If it shows `no response`, the container is not running or not yet healthy —
check with `docker compose ps`.

#### Redis

```bash
docker exec sorobanpay-redis redis-cli ping
```

**Expected output:**

```
PONG
```

#### Backend health endpoint

Once the backend is running, the `/health` endpoint checks both PostgreSQL and
the Soroban RPC connection:

```bash
curl -s http://localhost:3001/health | python3 -m json.tool
```

**Expected response (HTTP 200):**

```json
{
  "status": "ok",
  "postgres": "connected",
  "rpc": "reachable",
  "contractId": "CABC...CONTRACT",
  "uptime": 42.3
}
```

**Degraded response (HTTP 503) — database unreachable:**

```json
{
  "status": "degraded",
  "postgres": "unreachable",
  "rpc": "reachable",
  "error": "connect ECONNREFUSED 127.0.0.1:5432"
}
```

Recovery: start the database with `docker compose up -d postgres` and wait for
the healthcheck to pass.

---

### 5.7 Common issues and fixes

| Symptom | Likely cause | Fix |
|---------|-------------|-----|
| `connect ECONNREFUSED 5432` | PostgreSQL not running | `docker compose up -d postgres` |
| `connect ECONNREFUSED 6379` | Redis not running | `docker compose up -d redis` |
| `P1001: Can't reach database server` | Wrong `DATABASE_URL` | Check `backend/.env` — host should be `localhost`, port `5432` |
| `Migration failed — relation already exists` | Partial migration applied | `npx prisma migrate resolve --applied <migration_name>` |
| `WRONGTYPE error` in Redis | Key type collision from old data | `docker exec sorobanpay-redis redis-cli FLUSHDB` (clears all Redis data) |
| Seed fails: `Unique constraint failed` | Seed data already exists | Run `bash scripts/seed-and-reset.sh --reset-only` first, then seed |
| `sorobanpay-postgres` container exits immediately | Port 5432 already in use | Stop local PostgreSQL: `sudo systemctl stop postgresql` |

> ⚠️ `redis-cli FLUSHDB` deletes **all** data in the currently selected Redis
> database. In development this is safe; do not run it against a shared or
> production Redis instance.
