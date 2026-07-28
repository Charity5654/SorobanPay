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

## See Also

- [Storage TTL Management Guide](./operations.md) — TTL concepts, detection scripts, alert thresholds
- [Network Configuration Guide](./networks.md) — testnet vs. mainnet RPC and passphrase values
- Swagger UI: `https://api.sorobanpay.example.com/docs`
- SEP-10 Spec: https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0010.md
