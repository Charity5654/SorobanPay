# Webhook Integration Guide

How to receive, verify, and deduplicate SorobanPay webhook deliveries.

---

## Overview

SorobanPay's backend delivers webhook notifications to merchant-registered HTTP endpoints whenever payment events occur. Because network failures can cause retries, every delivery carries two headers that let you handle retries safely:

| Header | Stable? | Purpose |
|--------|---------|---------|
| `X-SorobanPay-Event-ID` | ✅ Yes — same on every retry | **Idempotency key.** Use this to deduplicate event processing. |
| `X-SorobanPay-Delivery-ID` | ❌ No — new UUID per attempt | Request tracing and delivery log correlation. |
| `X-SorobanPay-Timestamp` | ❌ No — Unix seconds of this attempt | Replay-attack prevention. |
| `X-SorobanPay-Signature` | Varies per attempt body | HMAC-SHA256 of the raw request body (only if endpoint has a secret). |

---

## Registering an endpoint

```bash
curl -X POST https://your-backend/api/v1/webhooks/endpoints \
  -H 'Content-Type: application/json' \
  -d '{
    "merchant": "GXYZ...MERCHANT",
    "url": "https://your-server.com/webhooks/sorobanpay",
    "secret": "your-signing-secret"
  }'
```

The `secret` is optional but strongly recommended. Generate one with:

```bash
openssl rand -hex 32
```

> **Security**: Store the secret in an environment variable such as
> `SOROBANPAY_WEBHOOK_SECRET`. Never commit it to source control or print it
> in logs. The secret is shown only at registration time; if lost, delete the
> endpoint and register a new one.

---

## Payload structure

```json
{
  "event": "payment.executed",
  "subscriber": "GABC...SUBSCRIBER",
  "merchant": "GXYZ...MERCHANT",
  "amount": "10000000",
  "txHash": "abc123...",
  "eventIndex": 0,
  "timestamp": 1753660800,
  "eventId": "e3b0c44298fc1c149afb..."
}
```

| Field | Description |
|-------|-------------|
| `event` | Event type: `payment.executed`, `payment.failed`, or `subscription.cancelled` |
| `subscriber` | Subscriber Stellar address |
| `merchant` | Merchant Stellar address |
| `amount` | Payment amount in token base units (stroops) |
| `txHash` | Transaction hash on the Stellar network |
| `eventIndex` | Zero-based index of this event within the transaction |
| `timestamp` | Unix timestamp of the triggering ledger event |
| `eventId` | Stable idempotency key — sha256(`txHash:eventIndex`) |

---

## Canonical signing format

The signature is computed over the **raw request body bytes** — not the parsed
JSON. The canonical form is:

```
HMAC-SHA256(secret, raw_body_bytes)
```

Encoded and sent as:

```
X-SorobanPay-Signature: sha256=<hex_digest>
```

> **Important:** always verify the signature against the raw body *before*
> calling `JSON.parse()`. Parsing and re-serializing JSON may change whitespace
> or key ordering, which invalidates the digest.

### TypeScript / Node.js — canonical verification

```typescript
import { createHmac, timingSafeEqual } from "crypto";

/**
 * Verify a SorobanPay webhook signature.
 *
 * @param rawBody         Raw Buffer or string from the HTTP request.
 *                        Do NOT parse/re-serialize before calling this.
 * @param signatureHeader Full value of the X-SorobanPay-Signature header,
 *                        e.g. "sha256=abc123..."
 * @param secret          Webhook secret from SOROBANPAY_WEBHOOK_SECRET.
 * @returns               true if valid, false otherwise.
 */
export function verifySignature(
  rawBody: string | Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const expected =
    "sha256=" +
    createHmac("sha256", secret)
      .update(rawBody)
      .digest("hex");

  // timingSafeEqual prevents timing-oracle attacks.
  try {
    return timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected),
    );
  } catch {
    // Buffers of different lengths — automatic false
    return false;
  }
}
```

### Python — canonical verification

```python
import hmac
import hashlib

def verify_signature(raw_body: bytes, signature_header: str, secret: str) -> bool:
    """
    Verify a SorobanPay webhook signature.

    Args:
        raw_body:          Raw bytes from request.get_data() — not request.json.
        signature_header:  Value of X-SorobanPay-Signature header.
        secret:            Webhook secret from SOROBANPAY_WEBHOOK_SECRET env var.

    Returns:
        True if signature matches, False otherwise.
    """
    expected = "sha256=" + hmac.new(
        secret.encode("utf-8"),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    # hmac.compare_digest is constant-time
    return hmac.compare_digest(expected, signature_header)
```

---

## Timestamp validation

The `X-SorobanPay-Timestamp` header carries the Unix epoch seconds of **this
delivery attempt**. Validate it to reject replayed requests:

```typescript
const REPLAY_TOLERANCE_SECONDS = 300; // 5 minutes

function isTimestampFresh(timestampHeader: string): boolean {
  const ts = parseInt(timestampHeader, 10);
  if (isNaN(ts)) return false;
  return Math.abs(Date.now() / 1000 - ts) <= REPLAY_TOLERANCE_SECONDS;
}
```

```python
import time

REPLAY_TOLERANCE_SECONDS = 300

def is_timestamp_fresh(timestamp_header: str) -> bool:
    try:
        ts = int(timestamp_header)
    except (ValueError, TypeError):
        return False
    return abs(time.time() - ts) <= REPLAY_TOLERANCE_SECONDS
```

> The timestamp is **per-delivery-attempt**, not per-event — it changes on
> each retry. Do not use it as an idempotency key; use
> `X-SorobanPay-Event-ID` for that.

---

## Idempotency key usage

The `X-SorobanPay-Event-ID` header (and the `eventId` body field) is derived as:

```
sha256("<txHash>:<eventIndex>")
```

This value is **constant across all retry attempts** for the same on-chain
event. Use it as your idempotency key when storing event effects (e.g.
granting access, updating a database record, sending a confirmation email).

### Node.js / Express — complete handler with idempotency

```typescript
import express from "express";
import { verifySignature } from "./webhookSignature";

const app = express();

// IMPORTANT: use express.raw() to preserve the unmodified body buffer.
// express.json() must NOT be applied to this route.
app.use(
  "/webhooks/sorobanpay",
  express.raw({ type: "application/json" }),
);

app.post("/webhooks/sorobanpay", async (req, res) => {
  const rawBody: Buffer = req.body;
  const secret = process.env.SOROBANPAY_WEBHOOK_SECRET!;

  // 1. Verify HMAC signature
  const sig = req.headers["x-sorobanpay-signature"] as string;
  if (!sig || !verifySignature(rawBody, sig, secret)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // 2. Reject stale or replayed requests (> 5 minutes old)
  const ts = req.headers["x-sorobanpay-timestamp"] as string;
  if (!isTimestampFresh(ts)) {
    return res.status(400).json({ error: "Timestamp too old or missing" });
  }

  // 3. Deduplicate using the stable Event ID
  const eventId = req.headers["x-sorobanpay-event-id"] as string;
  if (!eventId) {
    return res.status(400).json({ error: "Missing X-SorobanPay-Event-ID" });
  }

  const alreadyProcessed = await db.processedEvents.findUnique({
    where: { eventId },
  });
  if (alreadyProcessed) {
    // Return 200 so the backend stops retrying — this is expected on retries
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // 4. Parse and process the event
  let payload: WebhookPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  await handleEvent(payload);

  // 5. Mark as processed — write before responding to avoid race conditions
  await db.processedEvents.create({
    data: { eventId, processedAt: new Date() },
  });

  // 6. Acknowledge quickly — must respond within 10 seconds
  res.status(200).json({ ok: true });
});
```

### Python / Flask — complete handler with idempotency

```python
import os
import time
from datetime import datetime
from flask import Flask, request, jsonify

app = Flask(__name__)

@app.route("/webhooks/sorobanpay", methods=["POST"])
def handle_webhook():
    raw_body = request.get_data()   # raw bytes — before any parsing
    secret = os.environ["SOROBANPAY_WEBHOOK_SECRET"]

    # 1. Verify signature
    sig = request.headers.get("X-SorobanPay-Signature", "")
    if not verify_signature(raw_body, sig, secret):
        return jsonify(error="Invalid signature"), 401

    # 2. Reject stale requests
    ts_header = request.headers.get("X-SorobanPay-Timestamp", "")
    if not is_timestamp_fresh(ts_header):
        return jsonify(error="Timestamp too old or missing"), 400

    # 3. Deduplicate
    event_id = request.headers.get("X-SorobanPay-Event-ID", "")
    if not event_id:
        return jsonify(error="Missing X-SorobanPay-Event-ID"), 400

    if ProcessedEvent.query.get(event_id):
        return jsonify(ok=True, duplicate=True), 200

    # 4. Parse and process
    data = request.get_json(force=True)
    handle_event(data)

    # 5. Mark processed
    db.session.add(ProcessedEvent(event_id=event_id, processed_at=datetime.utcnow()))
    db.session.commit()

    return jsonify(ok=True), 200
```

---

## Retry schedule and dead letters

### Retry schedule

Failed deliveries (non-2xx HTTP response or connection error within 10 seconds)
are retried with exponential backoff:

| Attempt | Delay before attempt | Cumulative elapsed |
|---------|---------------------|-------------------|
| 1 (initial) | Immediate | 0 s |
| 2 | 1 second | 1 s |
| 3 | 5 seconds | 6 s |
| 4 | 15 seconds | 21 s |
| 5 | 1 minute | ~1.4 min |

After **5 failed attempts** the delivery is marked permanently failed
(dead letter). The event is **not** discarded — it remains in the delivery log
and can be replayed manually (see [Replaying dead-letter events](#replaying-dead-letter-events)).

### What triggers a retry

| Condition | Retried? |
|-----------|----------|
| HTTP 5xx response | ✅ Yes |
| Connection refused / DNS failure | ✅ Yes |
| Connection timeout (> 10 s) | ✅ Yes |
| HTTP 4xx response (except 429) | ❌ No — treat as permanent failure |
| HTTP 429 Too Many Requests | ✅ Yes — respects `Retry-After` header if present |
| HTTP 2xx response | ❌ No — delivery successful |

> **Tip:** Return `200 OK` immediately and process asynchronously for slow
> handlers. Any non-2xx response retriggers the retry schedule, so a slow
> handler that times out before responding will eat all 5 retry attempts.

### Viewing dead-letter events

```bash
# List failed deliveries for an endpoint
curl -X GET \
  "https://api.sorobanpay.example.com/webhooks/<endpoint-id>/deliveries?status=failed&limit=50" \
  -H "Authorization: Bearer <token>" \
  -H "X-Merchant-Id: GMERCHANT..."
```

**Expected response (HTTP 200):**

```json
{
  "data": [
    {
      "id": 99,
      "eventId": "e3b0c44298fc1c149afb...",
      "deliveryId": "550e8400-e29b-41d4-a716-446655440000",
      "url": "https://your-server.com/webhooks/sorobanpay",
      "event": "payment.executed",
      "statusCode": 503,
      "attempt": 5,
      "success": false,
      "error": "Service Unavailable",
      "createdAt": "2026-09-29T12:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "limit": 50, "offset": 0 }
}
```

---

## Replaying dead-letter events

Dead-letter events can be manually replayed once your endpoint is healthy again.

### Replay a single event by `eventId`

```bash
curl -X POST \
  "https://api.sorobanpay.example.com/webhooks/<endpoint-id>/replay" \
  -H "Authorization: Bearer <token>" \
  -H "X-Merchant-Id: GMERCHANT..." \
  -H "Content-Type: application/json" \
  -d '{"eventId": "e3b0c44298fc1c149afb..."}'
```

**Expected response (HTTP 202 Accepted):**

```json
{
  "queued": true,
  "eventId": "e3b0c44298fc1c149afb...",
  "deliveryId": "new-uuid-per-replay-attempt"
}
```

The replayed delivery uses a new `X-SorobanPay-Delivery-ID` but the **same**
`X-SorobanPay-Event-ID`. Your idempotency check will deduplicate it if the
original was already processed.

### Replay all failed deliveries for an endpoint

```bash
curl -X POST \
  "https://api.sorobanpay.example.com/webhooks/<endpoint-id>/replay-all" \
  -H "Authorization: Bearer <token>" \
  -H "X-Merchant-Id: GMERCHANT..."
```

**Expected response (HTTP 202 Accepted):**

```json
{
  "queued": 3,
  "eventIds": [
    "e3b0c44298fc1c149afb...",
    "a1b2c3d4e5f6a1b2c3d4...",
    "deadbeef1234abcdef56..."
  ]
}
```

**JavaScript helper:**

```javascript
async function replayDeadLetters(endpointId, token, merchantId) {
  const res = await fetch(
    `https://api.sorobanpay.example.com/webhooks/${endpointId}/replay-all`,
    {
      method: "POST",
      headers: {
        Authorization:  `Bearer ${token}`,
        "X-Merchant-Id": merchantId,
      },
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Replay failed: ${err.error?.message ?? res.statusText}`);
  }

  const { queued, eventIds } = await res.json();
  console.log(`Queued ${queued} event(s) for replay:`, eventIds);
}
```

> **Idempotency on replay:** If your handler already processed an event and
> stored the `eventId`, the duplicate check returns
> `200 { ok: true, duplicate: true }` — the backend treats this as success and
> stops retrying, preventing double-processing.

---

## Delivery log

### All deliveries for a merchant (last 100)

```bash
GET /api/v1/webhooks/deliveries/:merchant
```

### All attempts for a specific endpoint (paginated)

```bash
GET /api/v1/webhooks/:endpointId/deliveries?limit=50&offset=0
```

**Response:**

```json
{
  "data": [
    {
      "id": 42,
      "eventId": "e3b0c44298fc1c149afb...",
      "deliveryId": "550e8400-e29b-41d4-a716-446655440000",
      "url": "https://your-server.com/webhooks/sorobanpay",
      "event": "payment.executed",
      "statusCode": 200,
      "attempt": 1,
      "success": true,
      "error": null,
      "createdAt": "2026-07-27T12:00:00.000Z"
    }
  ],
  "meta": { "total": 1, "limit": 50, "offset": 0 }
}
```

Multiple records with the same `eventId` but different `deliveryId` indicate
retry attempts for the same event.

---

## Security considerations

- **HTTPS required** — Webhook URLs must use HTTPS in production
  (`NODE_ENV=production`). HTTP is allowed in development only.
- **Verify signatures** — Always verify `X-SorobanPay-Signature` before
  processing events.
- **Use timingSafeEqual** — Never use `===` or `==` to compare signatures
  (timing attack risk).
- **Validate timestamp** — Reject requests where
  `|now − X-SorobanPay-Timestamp| > 300 seconds`.
- **Idempotency** — Use `X-SorobanPay-Event-ID` to deduplicate retried
  deliveries. Store processed IDs with a unique database constraint.
- **Respond quickly** — Your endpoint must respond within **10 seconds**. For
  slow processing, respond 200 immediately and process asynchronously.
- **Secret storage** — Store `SOROBANPAY_WEBHOOK_SECRET` in an environment
  variable or secret manager. Never log, print, or commit it.

---

## Testing locally

Use a tunnel service like [ngrok](https://ngrok.com) or
[localtunnel](https://localtunnel.me) to expose your local server:

```bash
# Start tunnel
ngrok http 3000

# Register your tunnel URL
curl -X POST http://localhost:3001/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt>" \
  -d '{
    "merchant": "GABC...",
    "url": "https://abc123.ngrok.io/webhooks",
    "events": ["payment.executed", "payment.failed"]
  }'
```

### Constructing a test delivery manually

```typescript
import { createHmac, randomUUID } from "crypto";

const secret = process.env.SOROBANPAY_WEBHOOK_SECRET!;
const eventId = "test-event-id-001";
const payload = JSON.stringify({
  event:      "payment.executed",
  subscriber: "GABC...SUBSCRIBER",
  merchant:   "GXYZ...MERCHANT",
  amount:     "10000000",
  txHash:     "test-tx-hash-001",
  eventIndex: 0,
  timestamp:  Math.floor(Date.now() / 1000),
  eventId,
});

const signature =
  "sha256=" +
  createHmac("sha256", secret).update(payload, "utf8").digest("hex");

const res = await fetch("http://localhost:3000/webhooks/sorobanpay", {
  method: "POST",
  headers: {
    "Content-Type":             "application/json",
    "X-SorobanPay-Signature":   signature,
    "X-SorobanPay-Event-ID":    eventId,
    "X-SorobanPay-Delivery-ID": randomUUID(),
    "X-SorobanPay-Timestamp":   String(Math.floor(Date.now() / 1000)),
  },
  body: payload,
});

console.log("Status:", res.status, await res.json());
// Expected: 200 { ok: true }
// On replay: 200 { ok: true, duplicate: true }
```

---

## Request headers reference

| Header | Stable across retries? | Description |
|--------|------------------------|-------------|
| `X-SorobanPay-Signature` | No (body may differ between retries) | `sha256=<hex>` HMAC-SHA256 of the raw request body |
| `X-SorobanPay-Event-ID` | ✅ Yes | Stable event ID — use as idempotency key |
| `X-SorobanPay-Delivery-ID` | No — new UUID per attempt | Use for delivery log lookup |
| `X-SorobanPay-Timestamp` | No — current time of this attempt | Use for replay-attack prevention |

---

## Failure recovery checklist

If your endpoint was down and you missed deliveries:

1. **Confirm your endpoint is healthy** — ensure it returns 2xx within 10 s.
2. **Check the delivery log** —
   `GET /api/v1/webhooks/<id>/deliveries?status=failed`.
3. **Replay dead-letter events** —
   `POST /api/v1/webhooks/<id>/replay-all`.
4. **Verify idempotency** — your handler should return
   `{ ok: true, duplicate: true }` for any events it already processed.
5. **Reconcile with on-chain state** — for payment events, cross-reference
   `txHash` against [Stellar Expert](https://stellar.expert) to confirm
   on-chain status independently of the webhook delivery.

---

## See Also

- [API Cookbook](./api-cookbook.md) — Recipe 4: HMAC verification, Recipe 5: payment failure retry logic
- [Webhooks system reference](./webhooks.md) — BullMQ queue, Redis fallback, endpoint management
- [Security Model](./security.md) — full secrets management guidance
