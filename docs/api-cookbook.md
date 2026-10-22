# SorobanPay — Backend API Integration Cookbook

A collection of practical, copy-paste-ready recipes for the most common SorobanPay backend tasks. Every recipe includes a `curl` command and a JavaScript (`fetch`) equivalent, plus the response schema.

> **Base URL**: Replace `https://api.sorobanpay.example.com` with your actual backend URL.  
> **Authentication**: Recipes 1–7 require a valid `Authorization: Bearer <jwt>` header obtained from Recipe 1.

---

## Recipe 1 — Authenticate as a Merchant (SEP-10 Challenge-Response)

SorobanPay uses [SEP-10](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md) for merchant authentication: the backend issues a challenge transaction, the merchant signs it with Freighter (or any Stellar wallet), and the backend returns a JWT.

### Step 1 — Request a challenge

**curl**

```bash
curl -X GET "https://api.sorobanpay.example.com/auth/challenge?account=GMERCHANT..." \
  -H "Accept: application/json"
```

**JavaScript**

```javascript
const account = "GMERCHANT..."; // merchant Stellar public key
const res = await fetch(
  `https://api.sorobanpay.example.com/auth/challenge?account=${account}`
);
const { transaction, network_passphrase } = await res.json();
```

**Response schema**

```json
{
  "transaction": "<base64-encoded XDR>",
  "network_passphrase": "Test SDF Network ; September 2015"
}
```

| Field | Type | Description |
|---|---|---|
| `transaction` | `string` | Base64 XDR of the unsigned challenge transaction. Valid for 5 minutes. |
| `network_passphrase` | `string` | Network passphrase — must match when signing. |

### Step 2 — Sign the challenge with Freighter

```javascript
import { signTransaction } from "@stellar/freighter-api";

const signedXdr = await signTransaction(transaction, {
  networkPassphrase: network_passphrase,
});
```

### Step 3 — Exchange signed transaction for a JWT

**curl**

```bash
curl -X POST "https://api.sorobanpay.example.com/auth/token" \
  -H "Content-Type: application/json" \
  -d '{"transaction": "<signed-base64-xdr>"}'
```

**JavaScript**

```javascript
const tokenRes = await fetch("https://api.sorobanpay.example.com/auth/token", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ transaction: signedXdr }),
});
const { token, expires_at } = await tokenRes.json();
// Store `token` securely; attach as Authorization: Bearer <token>
```

**Response schema**

```json
{
  "token": "eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9...",
  "expires_at": "2026-07-26T16:00:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `token` | `string` | JWT bearer token. Include in all subsequent API calls. |
| `expires_at` | `string` | ISO 8601 UTC timestamp when the token expires (default: 24 hours). |

---

## Recipe 2 — List All Active Subscriptions for a Merchant

Returns subscriptions where the authenticated account is the merchant.

**curl**

```bash
curl -X GET "https://api.sorobanpay.example.com/subscriptions?status=active&page=1&limit=50" \
  -H "Authorization: Bearer <token>"
```

**JavaScript**

```javascript
const res = await fetch(
  "https://api.sorobanpay.example.com/subscriptions?status=active&page=1&limit=50",
  {
    headers: { Authorization: `Bearer ${token}` },
  }
);
const { subscriptions, pagination } = await res.json();
```

**Query parameters**

| Parameter | Default | Description |
|---|---|---|
| `status` | `active` | `active`, `cancelled`, or `all` |
| `page` | `1` | Page number (1-indexed) |
| `limit` | `50` | Results per page (max 200) |

**Response schema**

```json
{
  "subscriptions": [
    {
      "subscriber":    "GABC...SUBSCRIBER",
      "merchant":      "GDEF...MERCHANT",
      "token":         "CTOKEN...ADDRESS",
      "amount":        "1000000",
      "interval":      2592000,
      "next_payment":  "2026-08-26T14:00:00Z",
      "ttl_ledgers":   5200000,
      "ttl_days":      301.0,
      "status":        "active",
      "created_at":    "2026-07-26T14:00:00Z"
    }
  ],
  "pagination": {
    "page":        1,
    "limit":       50,
    "total":       142,
    "total_pages": 3
  }
}
```

| Field | Type | Description |
|---|---|---|
| `subscriber` | `string` | Stellar public key of the paying account |
| `merchant` | `string` | Stellar public key of the receiving account |
| `token` | `string` | SEP-41 token contract address |
| `amount` | `string` | Payment amount per interval (as string to avoid JS precision loss) |
| `interval` | `number` | Seconds between payments |
| `next_payment` | `string` | ISO 8601 UTC timestamp of next valid payment window |
| `ttl_ledgers` | `number` | Remaining ledgers until on-chain entry expires |
| `ttl_days` | `number` | Approximate days remaining (ttl_ledgers × 5 / 86400) |
| `status` | `string` | `active` or `cancelled` |
| `created_at` | `string` | ISO 8601 UTC timestamp of initial subscription creation |

---

## Recipe 3 — Query Payment History with Date Filter

Returns the executed payment log for the authenticated merchant, optionally filtered by date range.

**curl**

```bash
curl -X GET \
  "https://api.sorobanpay.example.com/payments?from=2026-01-01&to=2026-07-26&page=1&limit=100" \
  -H "Authorization: Bearer <token>"
```

**JavaScript**

```javascript
const params = new URLSearchParams({
  from: "2026-01-01",
  to:   "2026-07-26",
  page:  "1",
  limit: "100",
});
const res = await fetch(
  `https://api.sorobanpay.example.com/payments?${params}`,
  { headers: { Authorization: `Bearer ${token}` } }
);
const { payments, pagination } = await res.json();
```

**Query parameters**

| Parameter | Format | Description |
|---|---|---|
| `from` | `YYYY-MM-DD` | Start date (UTC, inclusive). Defaults to 30 days ago. |
| `to` | `YYYY-MM-DD` | End date (UTC, inclusive). Defaults to today. |
| `subscriber` | `G...` | Filter to a specific subscriber address (optional) |
| `page` | integer | Page number (default: 1) |
| `limit` | integer | Results per page (max 200, default: 100) |

**Response schema**

```json
{
  "payments": [
    {
      "tx_hash":     "abc123...",
      "subscriber":  "GABC...SUBSCRIBER",
      "merchant":    "GDEF...MERCHANT",
      "token":       "CTOKEN...ADDRESS",
      "amount":      "1000000",
      "paid_at":     "2026-07-15T12:34:56Z",
      "ledger":      5901234
    }
  ],
  "pagination": {
    "page":        1,
    "limit":       100,
    "total":       847,
    "total_pages": 9
  }
}
```

| Field | Type | Description |
|---|---|---|
| `tx_hash` | `string` | Stellar transaction hash of the `execute_payment` invocation |
| `subscriber` | `string` | Payer's Stellar public key |
| `merchant` | `string` | Recipient's Stellar public key |
| `token` | `string` | SEP-41 token contract address |
| `amount` | `string` | Amount paid (as string) |
| `paid_at` | `string` | ISO 8601 UTC timestamp of ledger close |
| `ledger` | `number` | Ledger sequence number of the payment transaction |

---

## Recipe 4 — Set Up a Webhook Endpoint and Verify HMAC Signature

SorobanPay webhooks are signed with HMAC-SHA256 using your webhook secret. Always verify the signature before processing the payload.

### Register a webhook

**curl**

```bash
curl -X POST "https://api.sorobanpay.example.com/webhooks" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "url":    "https://your-backend.example.com/hooks/sorobanpay",
    "events": ["payment.executed", "payment.failed", "subscription.cancelled"]
  }'
```

**JavaScript**

```javascript
const res = await fetch("https://api.sorobanpay.example.com/webhooks", {
  method: "POST",
  headers: {
    Authorization:  `Bearer ${token}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    url:    "https://your-backend.example.com/hooks/sorobanpay",
    events: ["payment.executed", "payment.failed", "subscription.cancelled"],
  }),
});
const { id, secret } = await res.json();
// Store `secret` securely — it is shown only once.
```

**Response schema**

```json
{
  "id":         "wh_01J8KXYZ...",
  "url":        "https://your-backend.example.com/hooks/sorobanpay",
  "events":     ["payment.executed", "payment.failed", "subscription.cancelled"],
  "secret":     "whsec_...",
  "created_at": "2026-07-26T14:00:00Z"
}
```

> **Security**: Store `secret` in an environment variable, not in source code.

### Verify the HMAC signature on incoming requests

SorobanPay adds the header `X-SorobanPay-Signature: t=<timestamp>,v1=<hmac>` to every webhook delivery.

```javascript
// backend/webhooks/verify.js
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify a SorobanPay webhook signature.
 * @param {string} rawBody     - Raw request body string (do NOT parse before verifying)
 * @param {string} signatureHeader - Value of the X-SorobanPay-Signature header
 * @param {string} secret      - Your webhook secret (whsec_...)
 * @param {number} toleranceSec - Max age of the timestamp in seconds (default: 300)
 * @returns {boolean}
 */
export function verifyWebhookSignature(
  rawBody,
  signatureHeader,
  secret,
  toleranceSec = 300
) {
  const parts = Object.fromEntries(
    signatureHeader.split(",").map((p) => p.split("="))
  );
  const timestamp = parseInt(parts.t, 10);
  const receivedHmac = parts.v1;

  if (!timestamp || !receivedHmac) return false;

  // Reject requests older than `toleranceSec` (replay protection)
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > toleranceSec) return false;

  const payload = `${timestamp}.${rawBody}`;
  const expected = createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  // Constant-time comparison
  return timingSafeEqual(
    Buffer.from(expected, "utf8"),
    Buffer.from(receivedHmac, "utf8")
  );
}
```

**Express middleware usage**

```javascript
// Use express.raw() to preserve the raw body for HMAC verification
app.post(
  "/hooks/sorobanpay",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const sig = req.headers["x-sorobanpay-signature"];
    const rawBody = req.body.toString("utf8");
    const secret = process.env.SOROBANPAY_WEBHOOK_SECRET;

    if (!verifyWebhookSignature(rawBody, sig, secret)) {
      return res.status(401).json({ error: "Invalid signature" });
    }

    const event = JSON.parse(rawBody);
    handleWebhookEvent(event); // see Recipe 5
    res.status(200).json({ received: true });
  }
);
```

---

## Recipe 5 — Handle a Payment Failure Webhook (Retry Logic Pattern)

When `execute_payment` fails (e.g., insufficient token allowance), SorobanPay emits a `payment.failed` webhook. Implement exponential backoff to retry collection, and cancel after a configurable number of attempts.

**Webhook payload — `payment.failed`**

```json
{
  "event":      "payment.failed",
  "created_at": "2026-07-26T14:05:00Z",
  "data": {
    "subscriber":  "GABC...SUBSCRIBER",
    "merchant":    "GDEF...MERCHANT",
    "token":       "CTOKEN...ADDRESS",
    "amount":      "1000000",
    "reason":      "insufficient_allowance",
    "attempt":     1,
    "next_retry":  "2026-07-27T14:05:00Z"
  }
}
```

| Field | Type | Description |
|---|---|---|
| `reason` | `string` | `insufficient_allowance`, `insufficient_balance`, `contract_error`, `network_timeout` |
| `attempt` | `number` | Current attempt number (1-indexed) |
| `next_retry` | `string` | ISO 8601 UTC scheduled retry time (null if no more retries) |

**Retry handler**

```javascript
// backend/webhooks/handler.js

const MAX_ATTEMPTS = 4;
// Retry delays (days): attempt 2 → +1d, 3 → +3d, 4 → +7d
const RETRY_DELAY_DAYS = [0, 1, 3, 7];

export async function handleWebhookEvent(event) {
  if (event.event !== "payment.failed") return;

  const { subscriber, merchant, reason, attempt } = event.data;

  console.warn(`Payment failed: ${subscriber} → ${merchant}. Reason: ${reason}. Attempt ${attempt}.`);

  if (attempt >= MAX_ATTEMPTS) {
    // Give up — notify merchant and optionally suspend the subscription
    await notifyMerchantPaymentFailed({ subscriber, merchant, attempt, reason });
    await updateSubscriptionStatus(subscriber, merchant, "payment_failed");
    return;
  }

  // Schedule the next retry attempt
  const delayDays = RETRY_DELAY_DAYS[attempt] ?? 7;
  const nextRetry = new Date(Date.now() + delayDays * 86400 * 1000).toISOString();

  await schedulePaymentRetry({ subscriber, merchant, attempt: attempt + 1, scheduledAt: nextRetry });

  console.log(`Retry ${attempt + 1} scheduled for ${nextRetry}`);
}
```

**Reasons and recommended responses**

| Reason | Recommended action |
|---|---|
| `insufficient_allowance` | Notify subscriber to re-approve token allowance |
| `insufficient_balance` | Notify subscriber to top up their token balance |
| `contract_error` | Log full error; retry after 1 day; page on-call if persists |
| `network_timeout` | Retry sooner (e.g., 1 hour) — likely transient |

---

## Recipe 6 — Export Payments to CSV for Accounting

**curl**

```bash
curl -X GET \
  "https://api.sorobanpay.example.com/payments/export?from=2026-01-01&to=2026-06-30&format=csv" \
  -H "Authorization: Bearer <token>" \
  -o payments-H1-2026.csv
```

**JavaScript — download and save to file**

```javascript
import { writeFileSync } from "fs";

const params = new URLSearchParams({
  from:   "2026-01-01",
  to:     "2026-06-30",
  format: "csv",
});
const res = await fetch(
  `https://api.sorobanpay.example.com/payments/export?${params}`,
  { headers: { Authorization: `Bearer ${token}` } }
);

if (!res.ok) throw new Error(`Export failed: ${res.status}`);

const csv = await res.text();
writeFileSync("payments-H1-2026.csv", csv, "utf8");
console.log("Exported to payments-H1-2026.csv");
```

**Response — CSV format**

```csv
tx_hash,subscriber,merchant,token,amount,paid_at,ledger
abc123...,GABC...SUBSCRIBER,GDEF...MERCHANT,CTOKEN...,1000000,2026-07-15T12:34:56Z,5901234
def456...,GHIJ...SUBSCRIBER,GDEF...MERCHANT,CTOKEN...,500000,2026-07-20T08:10:22Z,5924789
```

**CSV column descriptions**

| Column | Description |
|---|---|
| `tx_hash` | Stellar transaction hash |
| `subscriber` | Payer's Stellar public key |
| `merchant` | Recipient's Stellar public key |
| `token` | SEP-41 token contract address |
| `amount` | Payment amount (raw integer units — divide by token decimals for display) |
| `paid_at` | ISO 8601 UTC timestamp of ledger close |
| `ledger` | Ledger sequence number |

> **Token decimals**: USDC has 7 decimal places. `amount: 10000000` = 1 USDC. Check the token contract's `decimals()` view function for the correct divisor.

**Query parameters**

| Parameter | Default | Description |
|---|---|---|
| `from` | 30 days ago | Start date (`YYYY-MM-DD`, UTC, inclusive) |
| `to` | today | End date (`YYYY-MM-DD`, UTC, inclusive) |
| `format` | `csv` | `csv` or `json` |
| `subscriber` | — | Filter to a single subscriber address (optional) |

---

## Recipe 7 — Calculate MRR from the Analytics Endpoint

MRR (Monthly Recurring Revenue) is computed by the backend from active subscription amounts and their normalized monthly values.

**curl**

```bash
curl -X GET "https://api.sorobanpay.example.com/analytics/mrr" \
  -H "Authorization: Bearer <token>"
```

**JavaScript**

```javascript
const res = await fetch("https://api.sorobanpay.example.com/analytics/mrr", {
  headers: { Authorization: `Bearer ${token}` },
});
const mrr = await res.json();
```

**Response schema**

```json
{
  "mrr": {
    "total_raw":        54321000000,
    "total_formatted":  "5432.10",
    "token":            "CTOKEN...ADDRESS",
    "token_symbol":     "USDC",
    "token_decimals":   7,
    "currency":         "USD",
    "active_subscriptions": 142,
    "as_of":            "2026-07-26T14:00:00Z"
  },
  "breakdown": [
    { "interval_label": "Monthly",  "count": 98,  "mrr_raw": 42000000000 },
    { "interval_label": "Yearly",   "count": 30,  "mrr_raw": 10000000000 },
    { "interval_label": "Weekly",   "count": 14,  "mrr_raw":  2321000000 }
  ]
}
```

| Field | Type | Description |
|---|---|---|
| `mrr.total_raw` | `number` | Total MRR in raw token units |
| `mrr.total_formatted` | `string` | Human-readable value (divided by `10^token_decimals`) |
| `mrr.active_subscriptions` | `number` | Count of active subscriptions at the time of calculation |
| `mrr.as_of` | `string` | Timestamp when MRR was last recalculated |
| `breakdown[].interval_label` | `string` | Normalized interval bucket label |
| `breakdown[].count` | `number` | Number of subscriptions in this bucket |
| `breakdown[].mrr_raw` | `number` | Contribution to MRR from this bucket (raw units) |

**How MRR is calculated**

For each active subscription, the backend normalizes the payment amount to a monthly equivalent:

```
monthly_amount = amount × (2_592_000 / interval)
```

where `2_592_000` is 30 days in seconds and `interval` is the subscription's payment interval in seconds.

**Example:**

```
amount = 10_000_000 (1.00 USDC), interval = 86_400 (daily)
monthly_amount = 10_000_000 × (2_592_000 / 86_400) = 300_000_000 (30.00 USDC/month)
```

---

## Recipe 8 — Monitor Subscription TTL Health

Use this recipe to integrate the TTL health endpoint into your alerting pipeline (PagerDuty, Opsgenie, Slack, etc.).

**curl**

```bash
curl -X GET "https://api.sorobanpay.example.com/health/ttl" \
  -H "Authorization: Bearer <token>"
```

**JavaScript**

```javascript
const res = await fetch("https://api.sorobanpay.example.com/health/ttl", {
  headers: { Authorization: `Bearer ${token}` },
});
const health = await res.json();

if (!health.healthy) {
  console.warn(`⚠️ ${health.at_risk.length} subscriptions at risk:`, health.at_risk);
}
```

**Response schema — healthy (HTTP 200)**

```json
{
  "healthy":       true,
  "at_risk":       [],
  "latest_ledger": 5984210,
  "checked_at":    "2026-07-26T14:00:00Z"
}
```

**Response schema — at-risk (HTTP 503)**

```json
{
  "healthy": false,
  "at_risk": [
    {
      "subscriber":          "GABC...SUBSCRIBER",
      "merchant":            "GDEF...MERCHANT",
      "live_until_ledger":   6506290,
      "remaining_ledgers":   522080,
      "remaining_days":      "30.2"
    }
  ],
  "latest_ledger": 5984210,
  "checked_at":    "2026-07-26T14:00:00Z"
}
```

| Field | Type | Description |
|---|---|---|
| `healthy` | `boolean` | `true` if no entries are below the alert threshold |
| `at_risk` | `array` | Subscriptions with fewer than 622,080 remaining ledgers (~36 days) |
| `at_risk[].remaining_ledgers` | `number` | Ledgers until on-chain TTL expiry |
| `at_risk[].remaining_days` | `string` | Approximate days (remaining_ledgers × 5 / 86400) |
| `latest_ledger` | `number` | Current network ledger at time of check |

**Cron-based health check script**

```bash
#!/usr/bin/env bash
# Run every hour via cron: 0 * * * * /opt/sorobanpay/check-ttl-health.sh

TOKEN=$(curl -s -X POST "$API_URL/auth/token" \
  -H "Content-Type: application/json" \
  -d "{\"transaction\": \"$SIGNED_CHALLENGE\"}" | jq -r .token)

HTTP_STATUS=$(curl -s -o /tmp/ttl-health.json -w "%{http_code}" \
  -H "Authorization: Bearer $TOKEN" \
  "$API_URL/health/ttl")

if [ "$HTTP_STATUS" != "200" ]; then
  echo "TTL ALERT: $(cat /tmp/ttl-health.json)" | \
    mail -s "SorobanPay TTL Alert" ops@example.com
fi
```

For full details on the alert threshold (622,080 ledgers) and the multi-level INFO/WARN/CRITICAL ladder, see the [Storage TTL Management Guide](./operations.md#6-alert-threshold-justification).

---

## Error Responses

All endpoints return a consistent error schema:

```json
{
  "error": {
    "code":    "unauthorized",
    "message": "JWT has expired. Please reauthenticate.",
    "status":  401
  }
}
```

| HTTP status | Code | Meaning |
|---|---|---|
| 400 | `bad_request` | Invalid query parameters or request body |
| 401 | `unauthorized` | Missing, invalid, or expired JWT |
| 403 | `forbidden` | Authenticated but not authorized for this resource |
| 404 | `not_found` | Resource does not exist |
| 422 | `validation_error` | Request body failed validation |
| 429 | `rate_limited` | Too many requests — back off and retry after `Retry-After` header |
| 500 | `internal_error` | Unexpected server error |
| 503 | `service_unavailable` | Dependency (Soroban RPC, database) temporarily unavailable |

---

---

## GraphQL API

SorobanPay exposes a read-only GraphQL endpoint alongside the REST API. It is backed by the same PostgreSQL database and enforces the same per-merchant tenant isolation as the REST routes.

**Endpoint:** `https://api.sorobanpay.example.com/graphql`

**Authentication:** Same JWT bearer token obtained via [Recipe 1](#recipe-1--authenticate-as-a-merchant-sep-10-challenge-response). Pass it in the `Authorization: Bearer <token>` HTTP header — identical to REST.

**Schema introspection:** `GET https://api.sorobanpay.example.com/graphql?introspect=1` (disabled in production; use the schema file at `backend/src/generated/schema.graphql`).

---

### GQL-1 — Fetch active subscriptions

```graphql
query ActiveSubscriptions($first: Int = 50, $after: String) {
  subscriptions(
    filter: { status: ACTIVE }
    first: $first
    after: $after
    orderBy: { field: CREATED_AT, direction: DESC }
  ) {
    edges {
      node {
        subscriber
        merchant
        token
        amount
        interval
        nextPayment
        ttlLedgers
        ttlDays
        status
        createdAt
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
    totalCount
  }
}
```

**Variables**

```json
{ "first": 50, "after": null }
```

**Expected response**

```json
{
  "data": {
    "subscriptions": {
      "edges": [
        {
          "node": {
            "subscriber":   "GABC...SUBSCRIBER",
            "merchant":     "GDEF...MERCHANT",
            "token":        "CTOKEN...ADDRESS",
            "amount":       "1000000",
            "interval":     2592000,
            "nextPayment":  "2026-08-26T14:00:00Z",
            "ttlLedgers":   5200000,
            "ttlDays":      301.0,
            "status":       "ACTIVE",
            "createdAt":    "2026-07-26T14:00:00Z"
          },
          "cursor": "eyJpZCI6MX0="
        }
      ],
      "pageInfo": {
        "hasNextPage": true,
        "endCursor": "eyJpZCI6NTB9"
      },
      "totalCount": 142
    }
  }
}
```

**Pagination:** Use cursor-based pagination. Pass the `endCursor` value as `after` on the next request to fetch the next page.

---

### GQL-2 — Fetch payment history with date filter

```graphql
query PaymentHistory(
  $from: DateTime!
  $to: DateTime!
  $subscriber: String
  $first: Int = 100
  $after: String
) {
  payments(
    filter: {
      paidAtGte: $from
      paidAtLte: $to
      subscriber: $subscriber
    }
    first: $first
    after: $after
    orderBy: { field: PAID_AT, direction: DESC }
  ) {
    edges {
      node {
        txHash
        subscriber
        merchant
        token
        amount
        paidAt
        ledger
      }
      cursor
    }
    pageInfo {
      hasNextPage
      endCursor
    }
    totalCount
  }
}
```

**Variables**

```json
{
  "from": "2026-01-01T00:00:00Z",
  "to":   "2026-07-26T23:59:59Z",
  "subscriber": null,
  "first": 100,
  "after": null
}
```

---

### GQL-3 — Fetch MRR analytics

```graphql
query MrrAnalytics {
  mrr {
    totalRaw
    totalFormatted
    token
    tokenSymbol
    tokenDecimals
    activeSubscriptions
    asOf
    breakdown {
      intervalLabel
      count
      mrrRaw
    }
  }
}
```

**Expected response**

```json
{
  "data": {
    "mrr": {
      "totalRaw":            54321000000,
      "totalFormatted":      "5432.10",
      "token":               "CTOKEN...ADDRESS",
      "tokenSymbol":         "USDC",
      "tokenDecimals":       7,
      "activeSubscriptions": 142,
      "asOf":                "2026-07-26T14:00:00Z",
      "breakdown": [
        { "intervalLabel": "Monthly", "count": 98,  "mrrRaw": 42000000000 },
        { "intervalLabel": "Yearly",  "count": 30,  "mrrRaw": 10000000000 },
        { "intervalLabel": "Weekly",  "count": 14,  "mrrRaw":  2321000000 }
      ]
    }
  }
}
```

---

### Pagination

All list queries use **cursor-based pagination** (Relay connection spec).

| Argument | Type | Default | Description |
|----------|------|---------|-------------|
| `first` | `Int` | 50 | Number of records to return (max 200) |
| `after` | `String` | `null` | Opaque cursor returned by the previous page's `endCursor` |

**Iterate through all pages:**

```javascript
async function fetchAllSubscriptions(token) {
  const endpoint = "https://api.sorobanpay.example.com/graphql";
  const query = `
    query($after: String) {
      subscriptions(filter: { status: ACTIVE }, first: 200, after: $after) {
        edges { node { subscriber merchant amount } cursor }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;

  let after = null;
  let all = [];

  do {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables: { after } }),
    });

    const { data, errors } = await res.json();
    if (errors?.length) throw new Error(errors[0].message);

    const { edges, pageInfo } = data.subscriptions;
    all = all.concat(edges.map((e) => e.node));
    after = pageInfo.hasNextPage ? pageInfo.endCursor : null;
  } while (after);

  return all;
}
```

---

### Complexity limits

The GraphQL server enforces query complexity scoring to prevent abusive or deeply nested queries from exhausting server resources.

| Limit | Value | Scope |
|-------|-------|-------|
| Max query depth | 7 levels | Per query document |
| Max query complexity | 1 000 points | Per query document |
| Max aliases | 15 | Per query document |
| Max `first` / page size | 200 records | Per connection field |
| Request timeout | 10 seconds | Per HTTP request |

**Complexity scoring rules:**

- Each scalar field: +1 point
- Each object field: +1 point
- Each list field with pagination argument (`first: N`): +N points
- Each resolver that hits the database: +10 points
- Fragments are expanded before scoring

**Example — query approaching the complexity limit:**

```graphql
# Complexity ≈ (200 records × 10 fields) + (10 DB hit × 1) = 2010 — REJECTED
query TooComplex {
  subscriptions(first: 200) {       # 200 × (9 scalars + 1 DB) = 2000
    edges {
      node {
        subscriber merchant token amount interval
        nextPayment ttlLedgers ttlDays status createdAt
      }
    }
  }
}
```

**Fix:** Reduce `first`, request fewer fields, or paginate with a smaller page size.

---

### GraphQL error handling

The GraphQL endpoint follows the [GraphQL over HTTP spec](https://graphql.github.io/graphql-over-http/). Errors are always returned in the `errors` array — the HTTP status is always `200` for well-formed requests (even if the query produced errors).

**Error response shape:**

```json
{
  "data": null,
  "errors": [
    {
      "message": "Not authenticated. Provide a valid Authorization: Bearer header.",
      "extensions": {
        "code": "UNAUTHENTICATED",
        "status": 401
      }
    }
  ]
}
```

| Extension `code` | Meaning | Recovery |
|-----------------|---------|----------|
| `UNAUTHENTICATED` | Missing or expired JWT | Re-authenticate via [Recipe 1](#recipe-1--authenticate-as-a-merchant-sep-10-challenge-response) |
| `FORBIDDEN` | Authenticated but querying another tenant's data | Verify the JWT's merchant claim matches the queried address |
| `BAD_USER_INPUT` | Invalid argument (type mismatch, out-of-range value) | Fix the query variables |
| `QUERY_TOO_COMPLEX` | Complexity limit exceeded | Reduce page size or request fewer fields |
| `QUERY_DEPTH_LIMIT` | Depth limit exceeded | Flatten the query |
| `NOT_FOUND` | Record does not exist | Verify the subscriber/merchant addresses |
| `INTERNAL_SERVER_ERROR` | Unexpected server error | Retry; contact support if it persists |

**JavaScript error handling pattern:**

```javascript
async function graphql(query, variables, token) {
  const res = await fetch("https://api.sorobanpay.example.com/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();

  if (json.errors?.length) {
    const [err] = json.errors;
    const code = err.extensions?.code ?? "UNKNOWN";

    if (code === "UNAUTHENTICATED") {
      // Token expired — refresh and retry once
      const newToken = await refreshToken();
      return graphql(query, variables, newToken);
    }

    throw Object.assign(new Error(err.message), { code, extensions: err.extensions });
  }

  return json.data;
}
```

---

### Tenant isolation

Every GraphQL resolver enforces **merchant-scoped tenant isolation**. The authenticated merchant can only query records where they are the declared merchant.

Rules enforced at the resolver level (not filterable away by query variables):

| Field / Type | Isolation rule |
|-------------|----------------|
| `subscriptions` | Returns only subscriptions where `merchant = jwt.sub` |
| `payments` | Returns only payments where `merchant = jwt.sub` |
| `mrr` | Computed over the authenticated merchant's subscriptions only |
| `webhooks` | Returns only webhooks registered by the authenticated merchant |

Attempting to query another tenant's subscriber directly (e.g., providing a different merchant address as a filter variable) will return an empty result set, not an error. The server silently overrides the `merchant` filter with the JWT claim.

**Example — querying a specific subscriber:**

```graphql
# Valid: the merchant filter is automatically applied from the JWT.
# The subscriber filter further narrows within your own subscriptions.
query SubscriberDetail($subscriber: String!) {
  subscriptions(
    filter: { subscriber: $subscriber, status: ACTIVE }
    first: 1
  ) {
    edges {
      node { subscriber merchant amount interval nextPayment status }
    }
  }
}
```

```json
{ "subscriber": "GABC...SUBSCRIBER" }
```

If `GABC...SUBSCRIBER` does not have an active subscription with your merchant account, the `edges` array is empty — not a 403 error. This prevents merchant address enumeration.

---

---

## API Authentication and Tenant Isolation

This section provides a complete reference for authentication flows, tenant header requirements, authorization failure codes, key rotation, and cross-tenant rejection behavior.

---

### Authentication overview

Every non-read-only API endpoint requires a valid JWT obtained through the SEP-10 challenge-response flow (see [Recipe 1](#recipe-1--authenticate-as-a-merchant-sep-10-challenge-response)). The JWT encodes the merchant's Stellar G-address as both the `sub` (subject) and `merchant_id` claims.

```
JWT payload (decoded):
{
  "sub":         "GMERCHANT...",
  "merchant_id": "GMERCHANT...",
  "iat":         1753660800,
  "exp":         1753747200
}
```

Token lifetime: **24 hours** by default. The `expires_at` field in the `/auth/token` response gives the exact expiry timestamp in ISO 8601.

---

### Tenant header — `X-Merchant-Id`

Protected endpoints also require the `X-Merchant-Id` header to be set to the merchant's Stellar G-address. The server validates that this header matches the `merchant_id` claim in the JWT — a mismatch is rejected with `403 Forbidden` before any database query runs.

**Required on every protected request:**

```bash
curl -X GET "https://api.sorobanpay.example.com/subscriptions" \
  -H "Authorization: Bearer <token>" \
  -H "X-Merchant-Id: GMERCHANT..."
```

**JavaScript — attach both headers via a shared helper:**

```javascript
// lib/apiClient.js
const BASE_URL = "https://api.sorobanpay.example.com";

/**
 * Authenticated API request helper.
 * @param {string} path    - API path, e.g. "/subscriptions"
 * @param {object} options - fetch options (method, body, …)
 * @param {string} token   - JWT obtained from /auth/token
 * @param {string} merchantId - Merchant Stellar G-address
 */
export async function apiRequest(path, options = {}, token, merchantId) {
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "Authorization":  `Bearer ${token}`,
      "X-Merchant-Id":  merchantId,
      "Content-Type":   "application/json",
      ...(options.headers ?? {}),
    },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: { message: res.statusText } }));
    throw Object.assign(
      new Error(err.error?.message ?? "API error"),
      { status: res.status, code: err.error?.code }
    );
  }

  return res.json();
}
```

**Expected result — both headers present and valid (HTTP 200):**

```json
{
  "subscriptions": [...],
  "pagination": { "page": 1, "limit": 50, "total": 3, "total_pages": 1 }
}
```

---

### Authorization failure codes

| Scenario | HTTP status | Error code | Message example |
|----------|------------|------------|-----------------|
| `Authorization` header missing | `401` | `unauthorized` | `"No Authorization header provided."` |
| JWT malformed (bad base64 / invalid JSON) | `401` | `unauthorized` | `"Token is malformed."` |
| JWT signature invalid (wrong secret / tampered) | `401` | `unauthorized` | `"Token signature verification failed."` |
| JWT expired | `401` | `unauthorized` | `"JWT has expired. Please reauthenticate."` |
| `X-Merchant-Id` header missing | `400` | `bad_request` | `"X-Merchant-Id header is required."` |
| `X-Merchant-Id` does not match JWT `merchant_id` | `403` | `forbidden` | `"Tenant mismatch: header merchant does not match token claims."` |
| Path merchant param does not match JWT `merchant_id` | `403` | `forbidden` | `"Tenant mismatch: path merchant does not match token claims."` |
| Requesting another merchant's resource by address | `403` | `forbidden` | `"Access denied: resource belongs to a different tenant."` |

**Detecting and handling auth failures in code:**

```javascript
import { apiRequest } from "./lib/apiClient.js";

async function listSubscriptions(token, merchantId) {
  try {
    return await apiRequest("/subscriptions?status=active", {}, token, merchantId);
  } catch (err) {
    if (err.status === 401) {
      // Token expired or invalid — re-run the SEP-10 challenge flow
      console.warn("Token invalid or expired. Re-authenticating...");
      const newToken = await authenticateViaSEP10(merchantId);
      return apiRequest("/subscriptions?status=active", {}, newToken, merchantId);
    }

    if (err.status === 403) {
      // Misconfigured client: merchantId in call does not match JWT
      console.error("Tenant mismatch — check that token and merchantId are for the same account.");
      throw err;
    }

    throw err; // propagate unexpected errors
  }
}
```

**Detailed error body:**

```json
{
  "error": {
    "code":    "forbidden",
    "message": "Tenant mismatch: header merchant does not match token claims.",
    "status":  403
  }
}
```

---

### Cross-tenant rejection examples

The backend enforces **merchant-scoped tenant isolation** at the middleware layer. Every query is filtered to `merchant_id = jwt.merchant_id` before execution. The following examples demonstrate how cross-tenant access is rejected or silently scoped.

#### Scenario 1 — mismatched header and token

Merchant A has a valid JWT for `GMERCHANT_A...` but sets `X-Merchant-Id` to `GMERCHANT_B...`:

```bash
curl -X GET "https://api.sorobanpay.example.com/subscriptions" \
  -H "Authorization: Bearer <token-for-GMERCHANT_A>" \
  -H "X-Merchant-Id: GMERCHANT_B..."
```

**Expected response (HTTP 403):**

```json
{
  "error": {
    "code":    "forbidden",
    "message": "Tenant mismatch: header merchant does not match token claims.",
    "status":  403
  }
}
```

The request is rejected before any DB query runs.

#### Scenario 2 — querying by subscriber address across tenants

Merchant A queries a subscriber who has a subscription with Merchant B only:

```bash
curl -X GET \
  "https://api.sorobanpay.example.com/subscriptions?subscriber=GSUBSCRIBER_OF_B&status=active" \
  -H "Authorization: Bearer <token-for-GMERCHANT_A>" \
  -H "X-Merchant-Id: GMERCHANT_A..."
```

**Expected response (HTTP 200, empty result set):**

```json
{
  "subscriptions": [],
  "pagination": { "page": 1, "limit": 50, "total": 0, "total_pages": 0 }
}
```

The query silently returns empty — `GSUBSCRIBER_OF_B`'s subscription with Merchant B is invisible to Merchant A. This prevents merchant address enumeration via error messages.

#### Scenario 3 — path parameter mismatch

```bash
curl -X GET \
  "https://api.sorobanpay.example.com/merchants/GMERCHANT_B.../payments" \
  -H "Authorization: Bearer <token-for-GMERCHANT_A>" \
  -H "X-Merchant-Id: GMERCHANT_A..."
```

**Expected response (HTTP 403):**

```json
{
  "error": {
    "code":    "forbidden",
    "message": "Access denied: resource belongs to a different tenant.",
    "status":  403
  }
}
```

---

### Token rotation and key management

#### Proactive rotation (before expiry)

Tokens expire after 24 hours. Rotate proactively by re-running the SEP-10 challenge flow before expiry:

```javascript
// Track expiry and refresh 5 minutes before it elapses
const REFRESH_MARGIN_MS = 5 * 60 * 1000; // 5 minutes

let tokenCache = { token: null, expiresAt: 0 };

async function getValidToken(merchantPublicKey) {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt - now > REFRESH_MARGIN_MS) {
    return tokenCache.token;
  }

  // Re-run SEP-10 flow
  const { transaction, network_passphrase } = await fetchChallenge(merchantPublicKey);
  const signedXdr = await signWithFreighter(transaction, network_passphrase);
  const { token, expires_at } = await exchangeForJWT(signedXdr);

  tokenCache = {
    token,
    expiresAt: new Date(expires_at).getTime(),
  };

  return token;
}
```

#### Forced rotation (compromised key)

If a JWT or the underlying Stellar signing key is suspected compromised:

1. **Revoke the JWT immediately** — contact your SorobanPay operator to add the `jti` (token ID) to the server-side revocation list, or redeploy with a new `ADMIN_JWT_SECRET`.
2. **Generate a new Stellar keypair** — use `stellar keys generate` and fund the new account.
3. **Transfer subscriptions** — call `transfer_subscription(subscriber, old_merchant, new_merchant)` for each active subscription to reassign them to the new keypair. Both old and new merchant must sign.
4. **Re-register webhooks** — webhook endpoints are associated with the merchant address; re-create them under the new address via `POST /webhooks`.
5. **Notify subscribers** — subscribers' SEP-41 allowances are granted to the contract address (not the merchant key), so no subscriber action is needed for allowances.

```bash
# Generate new identity
stellar keys generate new-merchant --network mainnet

# Print the new address
stellar keys address new-merchant

# Transfer each subscription (both old and new merchant must sign)
stellar contract invoke \
  --id $CONTRACT_ID --source old-merchant --network mainnet \
  -- transfer_subscription \
  --subscriber GABC...SUBSCRIBER \
  --old-merchant GOLD...MERCHANT \
  --new-merchant GNEW...MERCHANT
```

Expected result: subscription is atomically reassigned — `next_payment`, `amount`, and `interval` are preserved. A `subscription_transferred` event is emitted.

#### JWT rotation in CI/CD pipelines

For automated merchant-side services (e.g., a backend that calls `execute_payment` via the REST API), store the Stellar signing key in your secret manager and re-authenticate on startup and on 401 responses:

```javascript
// Pseudocode — adapt to your secret manager (AWS Secrets Manager, Vault, etc.)
const signingKey = await secretManager.getSecret("MERCHANT_SIGNING_KEY");

async function authenticateAutomated() {
  const { transaction, network_passphrase } = await fetchChallenge(signingKey.publicKey);
  const signed = signWithSecretKey(transaction, signingKey.secretKey); // NOT Freighter
  const { token, expires_at } = await exchangeForJWT(signed);
  return { token, expires_at };
}
```

**Security guidance:**
- Never log or print the JWT value in CI/CD output. Treat it as a secret.
- Store `MERCHANT_SIGNING_KEY` (the Stellar secret key starting with `S`) exclusively in a secret manager. Do not commit it to source control or embed it in environment variable files tracked by git.
- Rotate the JWT by re-running the SEP-10 flow; rotate the Stellar keypair via `transfer_subscription` as described above.

---

### Middleware enforcement summary

The tenant isolation middleware (`backend/src/middleware/tenantAuth.ts`) applies the following checks on every protected request, in order:

| Step | Check | Failure response |
|------|-------|-----------------|
| 1 | `Authorization: Bearer <token>` header present | `401 unauthorized` |
| 2 | JWT signature valid and not expired | `401 unauthorized` |
| 3 | `X-Merchant-Id` header present | `400 bad_request` |
| 4 | `X-Merchant-Id == jwt.merchant_id` | `403 forbidden` |
| 5 | Path params (if any) match `jwt.merchant_id` | `403 forbidden` |
| 6 | Inject `merchant_id` into request context | — |
| 7 | All DB queries use `WHERE merchant_id = context.merchant_id` | Transparent scoping |

Step 7 means that even if a bug in route logic omits a WHERE clause, the service layer always re-injects the tenant filter — providing defense-in-depth against accidental cross-tenant leakage.

---

## See Also

- [Storage TTL Management Guide](./operations.md) — TTL concepts, detection scripts, alert thresholds
- [Network Configuration Guide](./networks.md) — testnet vs. mainnet RPC and passphrase values
- [Backend Tenant Isolation Design](./backend-tenant-isolation.md) — Row-level security, scoped API design, storage isolation
- [Security Model](./security.md) — full authorization audit, circuit breaker runbook, secrets management
- Swagger UI: `https://api.sorobanpay.example.com/docs`
- GraphQL Playground: `https://api.sorobanpay.example.com/graphql` (disabled in production)
- SEP-10 Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
