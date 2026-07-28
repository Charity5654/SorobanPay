# Backend Tenant Isolation Design

## 1. Problem Statement

A multi-merchant backend serving SorobanPay must ensure that each merchant can only access their own subscription and payment data. Without explicit segmentation, a compromised or misconfigured request could leak records across tenants.

## 2. Tenant Identifier

The **merchant's Stellar G-address** (e.g., `GXXXXXXX…`) is the primary tenant key. It is:

- Already on-chain — no synthetic ID needed.
- Verified by the smart contract's `require_auth()` on every `execute_payment` call.
- Stable and globally unique.

```
tenant_key = merchant_stellar_address  # e.g. GABC...XYZ
```

## 3. Data Model

Every backend record includes `merchant_id` as a non-nullable foreign key / partition key.

| Table | Primary Key | Tenant Key |
|---|---|---|
| `subscriptions` | `(subscriber, merchant_id)` | `merchant_id` |
| `payments` | `id` (UUID) | `merchant_id` |
| `events` | `id` (UUID) | `merchant_id` |

No query touches these tables without a `WHERE merchant_id = $tenant` clause enforced at the service layer (see §5).

## 4. Scoped API Design

Every endpoint requires an `X-Merchant-Id` header containing the merchant's G-address.

| Method | Path | Required header |
|---|---|---|
| `GET` | `/subscriptions` | `X-Merchant-Id` |
| `GET` | `/subscriptions/:subscriber` | `X-Merchant-Id` |
| `GET` | `/payments` | `X-Merchant-Id` |
| `POST` | `/payments/execute` | `X-Merchant-Id` |

Requests missing `X-Merchant-Id` are rejected with `400 Bad Request` before auth is checked.

## 5. Authorization Checks

The JWT issued at login must contain a `merchant_id` claim equal to the merchant's G-address.

```
JWT payload: { "sub": "GABC...XYZ", "merchant_id": "GABC...XYZ", "exp": ... }
```

Validation order (enforced by middleware, before any DB query):

1. Verify JWT signature and expiry.
2. Extract `merchant_id` from JWT claims.
3. Assert `claims.merchant_id == X-Merchant-Id header value`. Return `403` on mismatch.
4. If the path contains a merchant address (e.g., `/merchants/:mid/…`), assert `claims.merchant_id == path param`. Return `403` on mismatch.
5. Inject `merchant_id` into the request context; service layer reads it from there — never from raw user input.

## 6. Storage Isolation

### Option A — Row-Level Security (Postgres RLS, recommended)

```sql
-- Enable RLS on each table
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments       ENABLE ROW LEVEL SECURITY;

-- Policy: rows visible only to the matching tenant role
CREATE POLICY tenant_isolation ON subscriptions
  USING (merchant_id = current_setting('app.current_tenant'));

CREATE POLICY tenant_isolation ON payments
  USING (merchant_id = current_setting('app.current_tenant'));

-- Set tenant context per connection/transaction
SET LOCAL "app.current_tenant" = 'GABC...XYZ';
```

The application sets `app.current_tenant` at the start of every transaction using the validated `merchant_id` from the request context. Even if the ORM emits a query without a `WHERE` clause, RLS silently filters to the tenant's rows.

### Option B — Per-Tenant Table Prefix

Use schema-per-tenant: `merchant_gabc.subscriptions`, `merchant_gabc.payments`. Simpler to reason about, harder to manage at scale. Prefer RLS for >10 tenants.

## 7. Event Indexing

The off-chain indexer consumes Soroban contract events (topic format: `[symbol, subscriber, merchant]`).

```
Event topic[2] == merchant_address  →  merchant_id for DB insert
```

Indexer logic:

1. Subscribe to `getEvents` RPC filtered by contract ID.
2. For each event, decode `topic[2]` as the merchant address.
3. Insert into `events` with `merchant_id = topic[2]`.
4. Optionally maintain a per-merchant cursor to support resumable backfill.

Merchants can only query events where `merchant_id` matches their JWT claim (§5).

## 8. Security Considerations

| Risk | Mitigation |
|---|---|
| Cross-tenant data leak via missing WHERE | RLS as defense-in-depth; service layer always injects tenant filter |
| JWT forgery | Short-lived tokens (15 min); RS256 signing; revocation list for compromised keys |
| Header spoofing (`X-Merchant-Id`) | Header value is never trusted alone; always validated against JWT claim |
| Insecure direct object reference | Path/query merchant params re-validated against JWT claim in middleware |
| Privilege escalation | No admin-bypass code paths in merchant-facing API; separate internal service for ops |
| Audit logging | Every mutating request logs `(timestamp, merchant_id, action, resource_id)` to an append-only audit table; logs are excluded from tenant RLS so merchants cannot read or delete them |
