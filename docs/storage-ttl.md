# Storage TTL and Subscription Lifetime Documentation

This document provides comprehensive documentation on how SorobanPay manages storage Time-To-Live (TTL) and subscription lifecycles within the Soroban smart contract platform.

## Table of Contents

1. [What is Soroban Storage TTL](#what-is-soroban-storage-ttl)
2. [Why TTL Exists](#why-ttl-exists) 
3. [How SorobanPay Extends TTL](#how-sorobanpay-extends-ttl)
4. [Storage Types in SorobanPay](#storage-types-in-sorobanpay)
5. [Subscription Lifecycle](#subscription-lifecycle)
6. [What Happens When TTL Expires](#what-happens-when-ttl-expires)
7. [TTL vs Subscription Expiration](#ttl-vs-subscription-expiration)
8. [Developer Considerations](#developer-considerations)
9. [Diagrams and Examples](#diagrams-and-examples)
10. [Frequently Asked Questions](#frequently-asked-questions)
11. [Data Inventory, Retention, and Deletion](#data-inventory-retention-and-deletion)

## What is Soroban Storage TTL

**Time-To-Live (TTL)** is Soroban's mechanism for preventing permanent storage accumulation by automatically removing unused storage entries after a specified number of ledgers.

### Key Concepts

- **TTL is measured in ledgers**, not wall-clock time
- Each persistent storage entry has its own TTL counter
- TTL decreases by 1 with each new ledger (~5 seconds on Stellar mainnet)
- When TTL reaches 0, the entry is **automatically removed** by the Soroban host
- TTL can be **extended** during contract execution to keep entries alive

### TTL Constants in SorobanPay

```rust
/// ~30 days at 5-second ledger close time (518_400 ledgers)
pub const MIN_TTL_LEDGERS: u32 = 30 * 24 * 60 * 60 / 5;

/// ~365 days at 5-second ledger close time (6_307_200 ledgers)  
pub const MAX_TTL_LEDGERS: u32 = 365 * 24 * 60 * 60 / 5;
```

**Ledger Calculation:**
- 1 day = 86,400 seconds
- 1 ledger ≈ 5 seconds on mainnet
- 1 day ≈ 17,280 ledgers
- 30 days ≈ 518,400 ledgers
- 365 days ≈ 6,307,200 ledgers

## Why TTL Exists

TTL serves several critical purposes in the Soroban ecosystem:

### 1. **Prevent Storage Bloat**
Without TTL, abandoned subscriptions would remain in storage forever, eventually making the network unmanageable as storage grows without bound.

### 2. **Economic Incentives**
Storage costs increase over time for unused entries, incentivizing developers to clean up inactive data and encouraging active maintenance of contract state.

### 3. **Network Performance**
Limiting persistent storage size helps maintain fast read/write performance and reduces the computational burden on validators.

### 4. **Resource Management**
TTL provides a natural garbage collection mechanism, preventing resource exhaustion on network nodes.

### 5. **Cost Control**
Developers pay for storage extension proportional to time and size, making long-term storage decisions economically conscious.

## How SorobanPay Extends TTL

SorobanPay uses a **conditional TTL extension strategy** to balance cost and reliability:

### Extension Logic

```rust
env.storage()
    .persistent()
    .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
```

**How `extend_ttl` Works:**
1. **Check current TTL**: If remaining TTL > `MIN_TTL_LEDGERS` (30 days), do nothing
2. **Extend if needed**: If remaining TTL ≤ 30 days, extend to `MAX_TTL_LEDGERS` (365 days)  
3. **Cost optimization**: Only pays extension fees when necessary

### When TTL is Extended

| Operation | TTL Extended | Rationale |
|-----------|--------------|-----------|
| `subscribe()` | ✅ Always | New/updated subscriptions need maximum lifetime |
| `execute_payment()` | ✅ Always | Active subscriptions should remain accessible |
| `get_subscription()` | ✅ Always | Reading subscription data indicates active usage |
| `pause()` | ❌ Never | Paused subscriptions shouldn't accumulate storage costs |
| `resume()` | ✅ Always | Resuming indicates active usage, reset to full lifetime |
| `cancel()` | ❌ N/A | Entry is removed entirely |

### TTL Extension Cost

The cost of TTL extension depends on:
- **Entry size** (SorobanPay subscriptions: ~200 bytes)
- **Extension duration** (up to 365 days)
- **Network fees** (varies by network congestion)

**Typical costs** (approximate, varies by network conditions):
- Small subscription entry: ~100-1000 stroops per extension
- Entry is extended for full year when triggered
- Extension only happens when TTL drops below 30 days

## Storage Types in SorobanPay

SorobanPay uses two types of Soroban storage:

### 1. Persistent Storage 

**Used for:**
- Subscription records (`SubscriptionData`)
- Admin configuration
- Merchant subscriber counts

**Characteristics:**
- Has TTL that must be actively managed
- Survives contract upgrades
- Higher storage costs
- Requires explicit `extend_ttl` calls

**Example:**
```rust
// Store subscription with TTL management
let key = DataKey::Subscription(hash);
env.storage().persistent().set(&key, &data);
env.storage()
    .persistent()
    .extend_ttl(&key, MIN_TTL_LEDGERS, MAX_TTL_LEDGERS);
```

### 2. Temporary Storage

**Used for:**
- Merchant subscription indexes (`MerchantIndex`)
- Short-lived operational data

**Characteristics:**
- Automatically cleaned up after ~24 hours
- No TTL management required
- Lower storage costs
- Suitable for derived/cached data

**Example:**
```rust
// Store index without TTL concerns
let idx_key = DataKey::MerchantIndex(merchant.clone());
env.storage().temporary().set(&idx_key, &index);
```

## Subscription Lifecycle

### 1. Creation Phase

```
┌─────────────┐
│ subscribe() │
└──────┬──────┘
       │
       ▼
┌─────────────────┐     ┌──────────────────┐
│ Store           │────▶│ Set TTL to       │
│ SubscriptionData│     │ MAX (365 days)   │
└─────────────────┘     └──────────────────┘
```

**What happens:**
1. Subscription data is stored in persistent storage
2. TTL is set to maximum (365 days) 
3. Entry is guaranteed accessible for ~1 year
4. Merchant index updated in temporary storage

### 2. Active Usage Phase

```
┌─────────────────┐     ┌─────────────────┐
│ execute_payment │────▶│ Check TTL       │
│ or              │     │ remaining       │
│ get_subscription│     └─────┬───────────┘
└─────────────────┘           │
                              ▼
                    ┌─────────────────┐
                    │ TTL < 30 days?  │
                    └─────┬───┬───────┘
                         Yes  No
                          │    │
                          ▼    ▼
                    ┌──────────┐ ┌────────────┐
                    │ Extend   │ │ Do nothing │
                    │ to 365d  │ │ (cost opt) │  
                    └──────────┘ └────────────┘
```

**What happens:**
1. Each payment execution or subscription read triggers TTL check
2. If TTL < 30 days remaining, extend to full 365 days
3. If TTL > 30 days, no action (cost optimization)
4. Active subscriptions are automatically kept alive

### 3. Pause Phase

```
┌─────────────┐
│   pause()   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐     ┌──────────────────┐
│ Set is_paused   │     │ NO TTL extension │
│ = true          │────▶│ (deliberate)     │
└─────────────────┘     └──────────────────┘
```

**What happens:**
1. Subscription marked as paused
2. **TTL is NOT extended** (cost saving measure)
3. Paused subscriptions will eventually expire if not resumed
4. Prevents indefinite storage costs for abandoned paused subscriptions

### 4. Resume Phase

```
┌─────────────┐
│  resume()   │
└──────┬──────┘
       │
       ▼
┌─────────────────┐     ┌──────────────────┐
│ Clear is_paused │────▶│ Extend TTL to    │
│ Reset next_pay  │     │ MAX (365 days)   │
└─────────────────┘     └──────────────────┘
```

**What happens:**
1. Paused state cleared and payment schedule reset
2. TTL extended to maximum (365 days)
3. Subscription becomes fully active again

### 5. Expiry vs Cancellation

```
        Active Subscription
               │
         ┌─────┴─────┐
         │           │
         ▼           ▼
   ┌──────────┐ ┌──────────┐
   │ cancel() │ │TTL → 0   │
   └─────┬────┘ └─────┬────┘
         │            │
         ▼            ▼
   ┌──────────┐ ┌──────────┐
   │ Removed  │ │ Removed  │
   │(explicit)│ │(automatic)│
   └──────────┘ └──────────┘
```

## What Happens When TTL Expires

### Automatic Expiry Process

1. **TTL Countdown**: TTL decreases by 1 with each new ledger
2. **Grace Period**: No grace period - expiry is immediate when TTL = 0
3. **Automatic Removal**: Soroban host removes the entry from storage
4. **No Recovery**: Expired entries cannot be recovered or restored

### Impact on Contract Operations

**After subscription TTL expires:**

```rust
// This will return None - subscription no longer exists
let subscription = env.storage().persistent().get(&key);
assert_eq!(subscription, None);

// execute_payment() will fail
execute_payment(env, subscriber, merchant, token)
    .unwrap_err() == ContractError::NoActiveSubscription;

// cancel() will also fail  
cancel(env, subscriber, merchant, token)
    .unwrap_err() == ContractError::NoActiveSubscription;
```

**Operations that fail after expiry:**
- `execute_payment()` → `ContractError::NoActiveSubscription`
- `cancel()` → `ContractError::NoActiveSubscription` 
- `get_subscription()` → `None`
- `pause()` → `ContractError::NoActiveSubscription`
- `resume()` → `ContractError::NoActiveSubscription`

### Detection and Monitoring

**Off-chain monitoring:**
```typescript
// Check subscription TTL via RPC
const ttlResult = await server.getLedgerEntries(...);
const currentLedger = await server.getLatestLedger();
const ledgersRemaining = ttlResult.liveUntilLedgerSeq - currentLedger.sequence;
const daysRemaining = (ledgersRemaining * 5) / (60 * 60 * 24);

if (daysRemaining < 30) {
    console.warn(`Subscription TTL low: ${daysRemaining} days remaining`);
}
```

## TTL vs Subscription Expiration 

It's important to distinguish between **TTL expiration** and **subscription expiration**:

| Aspect | TTL Expiration | Subscription Expiration |
|--------|----------------|-------------------------|
| **Cause** | Storage entry removed by Soroban host | Business logic (e.g., end date reached) |
| **Timing** | Based on ledger count and TTL management | Based on subscription terms |
| **Recovery** | Impossible - data is gone | Possible - could be renewed |
| **Detection** | `NoActiveSubscription` error | Custom business logic |
| **Prevention** | Extend TTL during active operations | Handle in application layer |

**SorobanPay only handles TTL expiration** - subscription business logic (end dates, term limits, etc.) must be implemented in the application layer.

## Developer Considerations

### Storage Cost Implications

**TTL extension costs are proportional to:**
- Entry size (~200 bytes per subscription)
- Extension duration (up to 365 days)  
- Network congestion (higher fees during peak usage)

**Cost optimization strategies:**
1. **Conditional extension**: Only extend when TTL < 30 days
2. **Batch operations**: Group multiple subscription operations when possible
3. **Pause unused subscriptions**: Avoid TTL extension costs for inactive subscriptions
4. **Monitor TTL externally**: Alert users before subscriptions expire

### Gas/Fee Implications

**TTL operations affect transaction costs:**

| Operation | Fee Impact | Reason |
|-----------|------------|--------|
| `subscribe()` | Higher | Always extends TTL to maximum |
| `execute_payment()` | Variable | Only extends TTL when necessary |
| `pause()` | Lower | No TTL extension |
| `resume()` | Higher | Always extends TTL |

**Budget accordingly:**
- Reserve extra fees for operations that extend TTL
- Factor TTL costs into subscription pricing
- Monitor network fee trends for cost planning

### Application Design Patterns

#### Pattern 1: TTL Monitoring Service

```typescript
class SubscriptionTTLMonitor {
    async checkTTL(subscriptionKey: string) {
        const ttl = await this.getTTLRemaining(subscriptionKey);
        
        if (ttl < 30 * 17280) { // 30 days in ledgers
            await this.alertUser(subscriptionKey);
            await this.suggestPayment(subscriptionKey); 
        }
    }
    
    private async getTTLRemaining(key: string): Promise<number> {
        // Query Soroban RPC for entry TTL
        // Return ledgers remaining
    }
}
```

#### Pattern 2: Proactive TTL Extension

```typescript  
class SubscriptionManager {
    async executePaymentWithTTLCheck(
        subscriber: string,
        merchant: string, 
        token: string
    ) {
        // Check TTL before execution
        const ttl = await this.getTTL(subscriber, merchant, token);
        
        if (ttl < RENEWAL_THRESHOLD) {
            // Warn user about upcoming TTL extension cost
            await this.notifyTTLExtension(subscriber);
        }
        
        // Execute payment (will extend TTL if needed)
        return await this.contractClient.execute_payment(
            subscriber,
            merchant, 
            token
        );
    }
}
```

#### Pattern 3: Grace Period Implementation

```typescript
// Application-level grace period (contract doesn't provide this)
class GracePeriodManager {
    async handleExpiredSubscription(subscriptionId: string) {
        const expiredSub = await this.getExpiredSubscription(subscriptionId);
        
        if (this.withinGracePeriod(expiredSub.expiredAt)) {
            // Allow resubscription with same terms
            return await this.renewSubscription(expiredSub);
        } else {
            // Require full resubscription process  
            return await this.createNewSubscription(expiredSub.terms);
        }
    }
}
```

## Diagrams and Examples

### TTL Timeline Example

```
Ledger:    1000000    1518400    2000000    2518400    3000000
           │          │          │          │          │
           │          │          │          │          │
           ▼          ▼          ▼          ▼          ▼
Subscribe  ├──────────┤ Payment  ├──────────┤ Payment  ├─ → Expiry
TTL:    365 days   336 days   365 days   336 days   307 days
        │          │          │          │          │
        │          │          │          │          │
        ▼          ▼          ▼          ▼          ▼  
    [EXTENDS]   [no change] [EXTENDS]  [no change] [continues]
```

**Timeline explanation:**
- **T0**: Subscribe sets TTL to 365 days
- **T+30d**: Payment due but TTL > 30 days, no extension
- **T+60d**: Payment extends TTL back to 365 days  
- **T+90d**: Payment due but TTL > 30 days, no extension
- **T+120d**: No payment, TTL continues counting down to expiry

### Storage Architecture Diagram

```
┌─────────────────────────────────────────┐
│             Soroban Ledger              │
├─────────────────────────────────────────┤
│           Persistent Storage            │
│  ┌─────────────────┐  TTL: 365 days    │
│  │ SubscriptionData│  ┌─────────────┐   │
│  │ - subscriber    │  │ Auto-expiry │   │
│  │ - merchant      │  │ when TTL=0  │   │
│  │ - token         │  └─────────────┘   │
│  │ - amount        │                    │
│  │ - interval      │  ┌─────────────┐   │ 
│  │ - next_payment  │  │ Extend TTL  │   │
│  │ - is_paused     │  │ on active   │   │
│  └─────────────────┘  │ operations  │   │
│                       └─────────────┘   │
├─────────────────────────────────────────┤
│           Temporary Storage             │
│  ┌─────────────────┐  TTL: ~24 hours   │
│  │  MerchantIndex  │  ┌─────────────┐   │
│  │ - subscription  │  │ Auto-expiry │   │
│  │   key hashes    │  │ (no mgmt    │   │
│  └─────────────────┘  │  needed)    │   │
│                       └─────────────┘   │
└─────────────────────────────────────────┘
```

### TTL State Machine

```
        ┌─────────────┐
        │   Created   │
        │ TTL = 365d  │
        └──────┬──────┘
               │ active operations
               ▼
        ┌─────────────┐     ┌──────────────┐
        │   Active    │────▶│ TTL Extended │
        │ TTL > 30d   │     │ TTL = 365d   │
        └─────┬───────┘     └──────────────┘
              │ time passes
              ▼
        ┌─────────────┐     ┌──────────────┐
        │ At Risk     │────▶│ TTL Extended │ 
        │ TTL < 30d   │     │ TTL = 365d   │
        └─────┬───────┘     └──────────────┘
              │ no activity
              ▼
        ┌─────────────┐
        │   Expired   │
        │ TTL = 0     │
        │ (removed)   │
        └─────────────┘
```

## Frequently Asked Questions

### Q1: How long do subscriptions last by default?
**A:** Each subscription has a TTL of approximately 365 days when created or actively used. TTL is automatically extended during payment execution or subscription queries.

### Q2: What happens if I pause a subscription?
**A:** Paused subscriptions do **not** have their TTL extended, so they will eventually expire (be deleted) if not resumed within the remaining TTL period.

### Q3: Can I recover an expired subscription?
**A:** No. Once TTL expires and the entry is removed by Soroban, the data is permanently lost. The subscriber must create a new subscription.

### Q4: How much does TTL extension cost?
**A:** TTL extension costs depend on entry size (~200 bytes) and network fees. Typical costs are 100-1000 stroops per extension, but this varies with network conditions.

### Q5: How can I monitor TTL for my subscriptions?
**A:** You can query subscription entry TTL via Soroban RPC using `getLedgerEntries()`. Monitor entries approaching expiration and alert users proactively.

### Q6: Why doesn't pause() extend TTL?
**A:** This is an intentional cost-saving design. Paused subscriptions consume storage without generating revenue, so they should eventually expire unless actively resumed.

### Q7: What's the difference between TTL expiration and subscription cancellation?
**A:** Cancellation is an explicit user action that immediately removes the subscription. TTL expiration is automatic cleanup by Soroban after the storage lifetime ends.

### Q8: Can I set a longer TTL than 365 days?
**A:** No. The contract sets MAX_TTL_LEDGERS to 365 days as a balance between user convenience and storage costs. This is a protocol-level design decision.

### Q9: What happens during network upgrades?
**A:** TTL continues counting during network upgrades. Persistent storage survives upgrades, but temporary storage may be cleared.

### Q10: How accurate is the 5-second ledger assumption?
**A:** Stellar mainnet targets ~5 seconds per ledger, but actual times vary. TTL calculations are approximate in wall-clock time but precise in ledgers.

---

## Data Inventory, Retention, and Deletion

This section inventories data represented in the repository. It is not a retention schedule: no configured retention period or automated tenant-wide deletion job was found for PostgreSQL, application logs, or backups. Production operators must identify the deployed schema and external logging/backup policies before promising deletion dates. Do not infer a retention period from a table's `created_at` column.

### Inventory

| Store | Data and tenant scope | Observed lifetime / deletion behavior |
|---|---|---|
| Soroban persistent contract storage | Subscription state keyed by subscriber and merchant; publicly observable chain state | Contract constants set a maximum TTL of 6,307,200 ledgers (about 365 days). Expiration/archival is protocol-controlled; it is not a tenant erasure mechanism and does not erase public transaction history. |
| Soroban temporary storage | Merchant subscription index and short-lived contract data | The contract documentation describes an approximately 24-hour lifetime. Verify the deployed contract version and network behavior before relying on it. |
| PostgreSQL indexed events and indexer state | Event rows include merchant, subscriber, token, amount, and ledger; the indexer cursor supports resumable ingestion. Migrations include `tenant_id` for events/subscriptions, defaulting existing rows to `default`. | No age-based cleanup is configured. Event rows are source material for derived state; deletion can prevent or impair rebuild/reconciliation. |
| PostgreSQL payment, audit, retry, and summaries | Payment/audit transaction hashes, addresses, token, amount, ledger/status/time; retry state/errors; merchant payout summaries. See `backend/prisma/schema.prisma` and `backend/migrations/`. | No retention or tenant-erasure schedule is configured. Audit records are operational evidence, not automatically immutable: apply approved access controls and legal holds before any deletion. |
| PostgreSQL webhook configuration and delivery history | Endpoint URL and (where enabled) signing secret; per-attempt URL, event payload, status, and error. These fields can contain customer or endpoint data. | No retention schedule is configured. The webhook idempotency migration uses `ON DELETE SET NULL` for a deleted endpoint, so its delivery rows remain. Confirm endpoint deletion behavior for the deployed API/schema. |
| PostgreSQL notification preferences | Email address, optional subscriber/merchant address, unsubscribe token, and preferences, represented in the Prisma schema. | No retention schedule is configured. Include email and unsubscribe-token records in a subject/tenant inventory where deployed. |
| Redis cache and authentication challenge | Tenant-namespaced derived cache; SEP-10 challenge data. Defaults in `backend/src/lib/redis.ts` are 60 seconds for subscription lists, 300 seconds for analytics, and 30 seconds for subscription detail; `backend/src/services/authService.ts` sets challenge TTL to 300 seconds. | Cache entries expire at their configured TTL; challenge keys expire after five minutes. These lifetimes do not apply to BullMQ jobs, retry state, Redis persistence, snapshots, or external backups. Never use `FLUSHALL` for one tenant. |
| Application and container logs | Structured backend output and runtime/container logs may include operational identifiers and errors. | Pino writes to stdout; this repository does not configure log-collector retention or deletion. Docker/Kubernetes/cloud log retention is controlled by the deployment. Restrict access and avoid exporting secrets or raw customer payloads. |
| Database and Redis backups | Persistent database/Redis volumes and any operator-managed snapshots or exports can contain the same tenant data as their source stores. The local Compose file defines `pgdata` and `redisdata` volumes, not a backup schedule. | No backup retention or tenant-level purge procedure is configured here. A live-row deletion does not remove copies from backups; track backup expiry and restore access separately. |
| Derived data | Payout summaries, subscription read models, caches, retry/delivery queues, and other projections derived from chain events or database rows. | PostgreSQL projections have no configured TTL. Cache defaults are listed above; queue/job retention is deployment-dependent and not specified as a tenant deletion policy. Purging source events may make derived data impossible to reconstruct. |

The canonical files to review are `backend/prisma/schema.prisma`, `backend/migrations/`, `backend/src/lib/redis.ts`, `backend/src/services/authService.ts`, `backend/src/lib/logger.ts`, `backend/audit-trail/`, and `docker-compose.yml`. Prisma models and SQL migrations have evolved separately; confirm the live database schema rather than assuming every model/table name in these files matches a given deployment.

### Inspect before changing retention

Use the configured database connection without printing it or placing its value in shell history. The following read-only commands report the live table inventory and recent container logs:

```bash
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -c "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema = current_schema() AND table_type = 'BASE TABLE' ORDER BY table_name;"
docker compose ps
docker compose logs --since=24h indexer
```

Expected: `psql` lists the tables actually present; the log command shows only the runtime window still available from the container logging driver. Compare table names with `backend/migrations/` and inspect each tenant-bearing table's columns and migration history before counting or changing rows. If the database is unreachable, a query fails, or logs have already rotated, stop the deletion request, preserve the sanitized error and incident time, restore authorized read access or retrieve logs from the configured central collector, and do not treat missing output as proof of deletion.

Before any approved retention run, take and verify a restricted backup using the deployment's approved destination and access controls. Example for an operator-controlled path:

```bash
umask 077
pg_dump "$DATABASE_URL" --format=custom --no-owner --no-acl --file="$BACKUP_FILE"
pg_restore --list "$BACKUP_FILE" >/dev/null
```

Expected: both commands exit successfully and the backup file is readable by `pg_restore`. This verifies archive readability, not recoverability; restore it to an isolated database and verify representative records before relying on it. If backup creation or verification fails, keep the existing source data and prior valid backups, fix the access/storage issue, and repeat. Never use `docker compose down -v` as a tenant deletion or retention command: it removes the entire local Compose volumes, not one tenant's data.

### Tenant deletion and retention checklist

There is no repository-supported, atomic tenant-erasure command. Treat a deletion request as an operator-controlled workflow, not a hand-written `DELETE` against one table:

1. Authenticate and scope the request to the merchant/tenant identifiers in the deployed schema. Include subscriber-linked preferences and records, webhook endpoints and deliveries, payment idempotency/retry rows, audit records, logs, exports, caches, queues, and backups where present. Confirm whether a legal, financial, or security hold requires retaining or restricting specific records.
2. Inventory affected rows read-only in each verified live table using the same tenant predicate intended for deletion. Review counts and table dependencies with a second operator. Stop if tenant ownership is ambiguous, the schema differs from the reviewed migration, or counts include unrelated merchants; correct the mapping and repeat the read-only inventory.
3. Preserve only the evidence and records required by an approved retention/legal policy. Record the approval, scope, expected exceptions, backup identifiers and expiry, operator, and time. Do not export credentials, webhook secrets, full payloads, or unnecessary personal data into the ticket.
4. Disable the tenant's webhook endpoints and scheduled work using the deployed service's supported controls. Remove tenant-specific cache keys and queue jobs through their owning service/admin interface; never flush a shared Redis instance. Do not delete indexed events before deciding how payments, audit history, reconciliation, and derived summaries will be retained or rebuilt.
5. Execute only a reviewed, tenant-scoped deletion/anonymization procedure that accounts for foreign keys and audit requirements. The repository does not provide such a procedure. If no approved procedure exists, stop and escalate to the data owner rather than inventing SQL or deleting rows manually.
6. Verify the approved result with read-only counts in every in-scope live store, check that shared tenants remain present, confirm access to required retained evidence, and track when backups and centralized logs containing the deleted data expire. Keep a minimal, access-controlled completion record without copying the deleted data into it.

If a deletion batch partially fails, stop further batches, retain the error and affected table/count, and do not claim completion. Use the approved rollback/restore plan against an isolated database first; request data-owner review before restoring or replaying any production data, since restoration can reintroduce records that were meant to be erased.

## Related Documentation

- [Soroban Events API](events.md) - Event indexing for TTL monitoring
- [Contract API Documentation](contract-api.md) - Full contract interface reference
- [Architecture Overview](architecture.md) - System design and integration patterns

---

**Note:** This documentation reflects the current implementation. TTL behavior is controlled by Soroban protocol parameters and may change with network upgrades.