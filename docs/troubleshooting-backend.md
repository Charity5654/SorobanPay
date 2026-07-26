# Backend Troubleshooting Guide

This guide covers the SorobanPay backend services: the **event indexer**, **payout summary generator**, **payment scheduler**, **webhook notifier**, and the **reconciler**. For Freighter/frontend issues see [README.md §Troubleshooting Freighter](../README.md#troubleshooting-freighter). For deployment issues see [README.md §Troubleshooting](../README.md#troubleshooting).

---

## Quick Reference

| Symptom | Likely Cause | Section |
|---------|-------------|---------|
| Indexer lag growing indefinitely | RPC rate limiting or network congestion | [Indexer lag](#indexer-lag-growing-indefinitely) |
| Duplicate payment records in DB | Cursor not persisted atomically | [Duplicate records](#duplicate-payment-records-in-database) |
| Webhooks not delivering | DB `webhookEndpoint` rows inactive or missing | [Webhooks not delivering](#webhooks-not-delivering) |
| API returning `401 Unauthorized` | Missing or expired JWT / wrong secret | [401 Unauthorized](#api-returning-401-unauthorized) |
| API returning `503 Service Unavailable` | PostgreSQL connection pool exhausted | [503 errors](#api-returning-503-service-unavailable) |
| `cancel` events missing from audit trail | Indexer only indexes `subscribe`/`executed` | [Missing cancel events](#cancel-events-missing-from-audit-trail) |
| Payment scheduler not running | `OPERATOR_SECRET` not configured | [Scheduler disabled](#payment-scheduler-not-running) |
| Reconciler reporting errors | Chain events diverge from DB state | [Reconciler errors](#reconciler-errors) |

---

## Indexer Lag Growing Indefinitely

**Symptom:** The `EventIndexer` cron job runs every 5 minutes but processed ledger falls further and further behind the chain tip. Logs show repeated `Error fetching events` messages.

**Likely causes:**
1. The Soroban RPC endpoint is rate-limiting the polling requests.
2. The RPC node is unreachable or returning 5xx errors.
3. `CONTRACT_ID` is misconfigured — the `getEvents` filter returns no results.

**Resolution:**

1. Check the backend logs for the exact error:
   ```bash
   # If running with Docker Compose:
   docker compose logs --tail=100 backend

   # If running directly:
   npm run dev 2>&1 | tail -100
   ```

2. Confirm the RPC endpoint is reachable:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" \
     "https://soroban-testnet.stellar.org" \
     -X POST -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth","params":{}}'
   # Expected: 200
   ```

3. If rate-limited, configure a paid or alternative RPC endpoint in `.env`:
   ```env
   # Primary (paid endpoint with higher rate limits)
   RPC_URL=https://mainnet.stellar.validationcloud.io/v1/<YOUR_KEY>
   ```
   The `EventIndexer` constructor accepts a single `rpcUrl`. To add failover, extend `EventIndexer` to retry with a backup URL on `429` or network errors.

4. Verify `CONTRACT_ID` matches the deployed contract:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network testnet \
     -- get_subscription \
     --subscriber <any_address> \
     --merchant   <any_address>
   # If the contract ID is correct you get an error (no subscription), not a connection failure.
   ```

5. If the RPC node is consistently unreachable, switch to the backup testnet endpoint:
   ```env
   RPC_URL=https://horizon-testnet.stellar.org
   ```
   Note: use the Soroban RPC URL, not the Horizon URL, for `getEvents`.

---

## Duplicate Payment Records in Database

**Symptom:** The `payments` table (or `events` table) has two or more rows with the same `(subscriber, merchant, token, amount, ledgerTimestamp)`.

**Cause:** The `EventIndexer.processEvent` method uses `prisma.event.findFirst` to check for duplicates before inserting, but if two indexer processes run concurrently (e.g., after a crash + restart with overlapping `startLedger`), both may pass the check before either writes.

**Immediate fix — run deduplication query:**

```sql
-- Identify duplicates
SELECT type, subscriber, merchant, token, amount, "ledgerTimestamp", COUNT(*) AS cnt
FROM "Event"
GROUP BY type, subscriber, merchant, token, amount, "ledgerTimestamp"
HAVING COUNT(*) > 1;

-- Delete extras, keeping the row with the smallest id
DELETE FROM "Event"
WHERE id NOT IN (
  SELECT MIN(id)
  FROM "Event"
  GROUP BY type, subscriber, merchant, token, amount, "ledgerTimestamp"
);
```

**Permanent fix:** Add a unique constraint to the schema (tracked as BE-63):

```prisma
// In prisma/schema.prisma — add to the Event model:
@@unique([type, subscriber, merchant, token, amount, ledgerTimestamp])
```

Then migrate:

```bash
cd backend
npx prisma migrate dev --name add-event-unique-constraint
```

This turns concurrent-insert races into a constraint violation that the indexer can safely catch and discard.

---

## Webhooks Not Delivering

**Symptom:** Merchants registered webhook endpoints but are not receiving `payment.executed` or `payment.failed` events. The `webhookDelivery` table shows no rows, or all rows have `success = false`.

**Step 1 — Check that endpoint records exist and are active:**

```sql
SELECT id, merchant, url, active FROM "WebhookEndpoint" WHERE merchant = '<merchant_address>';
```

If no rows exist, the endpoint was never registered. If `active = false`, re-enable it:

```sql
UPDATE "WebhookEndpoint" SET active = true WHERE merchant = '<merchant_address>';
```

**Step 2 — Check webhook delivery history:**

```sql
SELECT url, event, "statusCode", attempt, success, error, "createdAt"
FROM "WebhookDelivery"
WHERE merchant = '<merchant_address>'
ORDER BY "createdAt" DESC
LIMIT 20;
```

Common `statusCode` values and their meaning:

| Status | Meaning | Fix |
|--------|---------|-----|
| `0` | Network error (DNS failure, connection refused, timeout) | Verify the URL is reachable from the backend host |
| `401` / `403` | Endpoint rejected the request | Check the endpoint's auth requirements; add a shared secret header |
| `404` | Endpoint URL no longer exists | Update the webhook URL |
| `429` | Endpoint is rate-limiting SorobanPay | Contact the merchant; add back-off |
| `5xx` | Endpoint server error | Retry will happen automatically (up to 5 attempts) |

**Step 3 — Retry exhausted deliveries manually:**

If all 5 retry attempts were exhausted (`attempt = 5`, `success = false`), the delivery is abandoned. To re-trigger manually, insert a new delivery row or redeploy the webhook notifier with a lower `MAX_ATTEMPTS` guard temporarily.

**Step 4 — Verify the `WEBHOOK_SECRET` env var is set** (if endpoints require HMAC verification):

```bash
grep WEBHOOK_SECRET backend/.env
```

If it is empty, generate a new secret and update all registered endpoints:

```bash
openssl rand -hex 32
# Paste the result into backend/.env as WEBHOOK_SECRET=<value>
```

---

## API Returning 401 Unauthorized

**Symptom:** Requests to protected API endpoints return `HTTP 401` with a body like `{"error":"Unauthorized"}` or `{"error":"jwt expired"}`.

**Cause:** The JWT bearer token in the `Authorization` header is missing, malformed, or past its `exp` claim.

**Resolution:**

1. Re-authenticate to obtain a fresh token:
   ```bash
   curl -X POST http://localhost:3001/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"address":"<stellar_address>","signature":"<signed_challenge>"}'
   ```
   See `docs/security.md` for the full wallet-auth challenge/response flow.

2. Check the token's `exp` claim without a library:
   ```bash
   # Decode the payload (second segment) of a JWT:
   echo "<YOUR_JWT>" | cut -d. -f2 | base64 -d 2>/dev/null | python3 -m json.tool
   # Look for "exp": <unix_timestamp>
   date -d "@<exp_value>"   # Linux
   date -r <exp_value>       # macOS
   ```

3. If the token is valid but still rejected, verify `JWT_SECRET` (or equivalent signing key env var) in the backend `.env` matches the value the token was signed with. Rotating the secret invalidates all existing tokens.

4. If this affects automated scripts, generate a long-lived token or use a service-account identity with a longer `exp`.

---

## API Returning 503 Service Unavailable

**Symptom:** API endpoints return `HTTP 503` intermittently, especially under load. Backend logs show Prisma errors like `PrismaClientKnownRequestError: Too many connections`.

**Cause:** PostgreSQL connection pool is exhausted. The Prisma client uses a default pool size of `connection_limit = <cpu_count * 2 + 1>`. Under high request concurrency this can be exceeded.

**Resolution:**

1. Check current PostgreSQL connection count:
   ```sql
   SELECT count(*) FROM pg_stat_activity WHERE datname = 'sorobanpay';
   ```

2. Check the maximum allowed connections:
   ```sql
   SHOW max_connections;
   ```

3. Increase the Prisma connection pool by appending `connection_limit` to `DATABASE_URL`:
   ```env
   DATABASE_URL="postgresql://user:password@localhost:5432/sorobanpay?schema=public&connection_limit=20"
   ```
   Set `connection_limit` to roughly `max_connections / (number_of_backend_replicas) - 5` (leave headroom for direct psql sessions).

4. If running multiple backend replicas, consider adding **PgBouncer** in transaction-pool mode between the app and PostgreSQL to multiplex connections:
   ```env
   DATABASE_URL="postgresql://user:password@pgbouncer:5432/sorobanpay?schema=public&pgbouncer=true"
   ```

5. Check for slow or idle queries holding connections:
   ```sql
   SELECT pid, state, wait_event_type, wait_event, query, now() - query_start AS duration
   FROM pg_stat_activity
   WHERE datname = 'sorobanpay' AND state != 'idle'
   ORDER BY duration DESC;
   ```
   Kill stuck sessions:
   ```sql
   SELECT pg_terminate_backend(pid) FROM pg_stat_activity
   WHERE datname = 'sorobanpay' AND state = 'idle in transaction'
   AND now() - query_start > interval '5 minutes';
   ```

---

## Cancel Events Missing from Audit Trail

**Symptom:** The `cancel` event is emitted by the contract (visible on Stellar Expert / `getEvents`), but there is no corresponding row in the `AuditLog` or `Event` table.

**Cause:** `EventIndexer.processEvent` filters events against `SUPPORTED_EVENT_TYPES = new Set(['subscribe', 'executed'])`. The `cancel` event type is intentionally excluded from the DB-level event table. Cancellation audit records are managed separately by the `AuditLogger` service via the `/api/reconcile` route.

**Resolution:**

1. Verify the `cancel` event is on-chain:
   ```bash
   stellar events \
     --contract-id $CONTRACT_ID \
     --network testnet \
     --start-ledger <ledger_before_cancel>
   # Look for a "cancel" topic entry.
   ```

2. If you need `cancel` events in the `events` table, extend `SUPPORTED_EVENT_TYPES` in `eventIndexer.ts`:
   ```typescript
   const SUPPORTED_EVENT_TYPES = new Set(['subscribe', 'executed', 'cancel']);
   ```
   Note that `cancel` events have only 2 topics (`symbol`, `subscriber`, `merchant`) and a unit `()` data value — the `decodeScValAmount` call will return `null`. Add a guard in `processEvent`:
   ```typescript
   const amount = eventType === 'cancel' ? '0' : decodeScValAmount(event.value);
   ```

3. If the reconciler has run and is not finding the cancellation, re-index from the ledger just before the `cancel` transaction. See [Re-indexing from a specific ledger](#re-indexing-from-a-specific-ledger).

---

## Payment Scheduler Not Running

**Symptom:** Due payments are not being executed automatically. The log line `[scheduler] OPERATOR_SECRET not set — payment scheduler disabled.` is visible on startup.

**Cause:** `OPERATOR_SECRET` is not set in the backend `.env`. The `PaymentScheduler` is disabled when this variable is absent.

**Resolution:**

1. Generate and set the operator secret (the Stellar secret key of the account that will sign `execute_payment` transactions):
   ```bash
   # Generate a new keypair (testnet)
   stellar keys generate operator --network testnet
   stellar keys fund operator --network testnet

   # Print the secret key
   stellar keys show operator
   ```

2. Add to `backend/.env`:
   ```env
   OPERATOR_SECRET=S...  # 56-character Stellar secret key
   ```

3. Restart the backend. The scheduler will begin processing due payments on the 1-minute cron cycle.

> **Security note:** The operator account only needs enough XLM to pay transaction fees (a few stroops per transaction). Do not fund it with large balances. See [docs/security.md](security.md) for key storage recommendations.

---

## Reconciler Errors

**Symptom:** The hourly reconciliation cron logs `Reconciliation errors: [...]`. The `GET /api/reconcile` endpoint returns non-empty `errors` array.

**Cause:** The reconciler compares on-chain event data (fetched from the DB's `events` table) against the `subscriptions` projection. Mismatches arise from:
- Missed event pages during indexer downtime.
- Manual database edits.
- A re-deployed contract with a different `CONTRACT_ID`.

**Resolution:**

1. Call the reconcile endpoint manually and inspect the output:
   ```bash
   curl -s http://localhost:3001/api/reconcile | jq .
   # Output: { "repairs": [...], "errors": [...] }
   ```

2. For each error, check whether the subscription exists on-chain:
   ```bash
   stellar contract invoke \
     --id $CONTRACT_ID --network testnet \
     -- get_subscription \
     --subscriber <subscriber> \
     --merchant   <merchant>
   ```
   - If it exists on-chain but not in the DB, the indexer missed the `subscribe` event. Re-index (see below).
   - If it is in the DB but not on-chain, it was cancelled or expired. Mark it inactive in the DB.

3. Re-index from the last known good ledger (see next section).

---

## Re-indexing from a Specific Ledger

Use this procedure when you need to backfill missed events or recover from indexer downtime.

### Find the last indexed ledger

```sql
SELECT MAX("ledgerTimestamp") AS last_ledger FROM "Event";
```

### Re-index via the API

The `EventIndexer.fetchAndStoreEvents(startLedger?)` method accepts an optional `startLedger` argument. You can trigger a targeted re-index via the reconcile API (if wired) or directly via a one-off script:

```typescript
// scripts/reindex.ts
import { EventIndexer } from '../backend/src/services/eventIndexer';
import 'dotenv/config';

const indexer = new EventIndexer(
  process.env.RPC_URL!,
  process.env.CONTRACT_ID!
);

const startLedger = parseInt(process.argv[2], 10);
if (isNaN(startLedger)) {
  console.error('Usage: npx ts-node scripts/reindex.ts <start_ledger>');
  process.exit(1);
}

console.log(`Re-indexing from ledger ${startLedger}…`);
await indexer.fetchAndStoreEvents(startLedger);
console.log('Done.');
```

Run it:

```bash
cd backend
npx ts-node scripts/reindex.ts 12345678
```

### Notes

- The Soroban RPC `getEvents` call returns a maximum of **4,320 ledgers** (~6 hours) per request. For large gaps, loop in batches:
  ```bash
  for start in $(seq 12000000 4320 12500000); do
    npx ts-node scripts/reindex.ts $start
  done
  ```
- Duplicate events are safely ignored — the indexer checks for an existing row with the same `(type, subscriber, merchant, token, amount, ledgerTimestamp)` before inserting.

---

## Checking Indexer Health

The backend exposes a health endpoint that reports service status:

```bash
curl -s http://localhost:3001/health | jq .
```

Expected healthy response:

```json
{
  "status": "ok",
  "db": "connected",
  "rpc": "reachable",
  "lastIndexedLedger": 12345678,
  "uptime": 3600
}
```

| Field | Healthy value | Action if unhealthy |
|-------|---------------|---------------------|
| `status` | `"ok"` | Check logs for startup errors |
| `db` | `"connected"` | Verify `DATABASE_URL`; check Postgres is running |
| `rpc` | `"reachable"` | Verify `RPC_URL`; check network/firewall |
| `lastIndexedLedger` | Close to current ledger | Indexer is lagging — see [Indexer lag](#indexer-lag-growing-indefinitely) |

If the `/health` endpoint itself returns a non-200 status code:

```bash
# Check if the process is running
ps aux | grep "node"

# Check the port is bound
ss -tlnp | grep 3001

# Restart the service
npm run dev
```

---

## Checking the Prisma Database Schema

If you see Prisma errors like `The table 'public.Event' does not exist`, the database migrations have not been applied.

```bash
cd backend

# Check pending migrations
npx prisma migrate status

# Apply all pending migrations
npx prisma migrate deploy

# Regenerate the Prisma client
npx prisma generate
```

---

## Common Environment Variable Issues

| Problem | Check | Fix |
|---------|-------|-----|
| `CONTRACT_ID` is blank | `echo $CONTRACT_ID` | Run `bash deploy/deploy.sh` and paste the output |
| `DATABASE_URL` connection refused | `psql $DATABASE_URL -c '\q'` | Start PostgreSQL; verify host/port/credentials |
| `RPC_URL` returns `401` | `curl -v $RPC_URL` | Add your API key to the URL for paid endpoints |
| `NETWORK_PASSPHRASE` mismatch | Compare to contract deploy network | Must be exactly `Test SDF Network ; September 2015` (testnet) or `Public Global Stellar Network ; September 2015` (mainnet) |
| `PORT` conflict | `ss -tlnp \| grep 3001` | Change `PORT` in `.env` to a free port |

---

## See Also

- [README.md §Troubleshooting](../README.md#troubleshooting) — deployment and CLI errors
- [README.md §Troubleshooting Freighter](../README.md#troubleshooting-freighter) — wallet issues
- [docs/architecture.md](architecture.md) — full backend role and event indexing architecture
- [docs/events.md](events.md) — event schema, RPC query examples, and decoding code
- [docs/security.md](security.md) — secret storage and JWT best practices
- [backend/tests/README.md](../backend/tests/README.md) — how to run backend tests
