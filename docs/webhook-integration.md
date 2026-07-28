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
| `X-SorobanPay-Signature` | Varies per attempt body | HMAC-SHA256 of the request body (only if endpoint has a secret). |

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

## Idempotency key usage

The `X-SorobanPay-Event-ID` header (and the `eventId` body field) is derived as:

```
sha256("<txHash>:<eventIndex>")
```

This value is **constant across all retry attempts** for the same on-chain event. Use it as your idempotency key when storing event effects (e.g. granting access, updating a database record, sending a confirmation email).

### Node.js / Express example

```typescript
import express from "express";
import { createHmac } from "crypto";

const app = express();
app.use(express.json({ verify: (req, _res, buf) => { (req as any).rawBody = buf; } }));

app.post("/webhooks/sorobanpay", async (req, res) => {
  // 1. Verify the signature
  const secret = process.env.WEBHOOK_SECRET!;
  const sig = req.headers["x-sorobanpay-signature"] as string;
  if (!verifySignature(secret, (req as any).rawBody, sig)) {
    return res.status(401).json({ error: "Invalid signature" });
  }

  // 2. Check timestamp to prevent replays (reject if > 5 minutes old)
  const ts = parseInt(req.headers["x-sorobanpay-timestamp"] as string, 10);
  if (Math.abs(Date.now() / 1000 - ts) > 300) {
    return res.status(400).json({ error: "Timestamp too old" });
  }

  // 3. Deduplicate using the stable Event ID
  const eventId = req.headers["x-sorobanpay-event-id"] as string;
  const already = await db.processedEvents.findUnique({ where: { eventId } });
  if (already) {
    // Already processed — return 200 so the backend stops retrying
    return res.status(200).json({ ok: true, duplicate: true });
  }

  // 4. Process the event
  const payload = req.body;
  await handleEvent(payload);

  // 5. Mark as processed
  await db.processedEvents.create({ data: { eventId, processedAt: new Date() } });

  res.status(200).json({ ok: true });
});

function verifySignature(secret: string, body: Buffer, signature: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  // Use timingSafeEqual to prevent timing attacks
  const { timingSafeEqual } = require("crypto");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
```

### Python / Flask example

```python
import hmac, hashlib, time
from flask import Flask, request, jsonify

app = Flask(__name__)
WEBHOOK_SECRET = os.environ["WEBHOOK_SECRET"]

@app.route("/webhooks/sorobanpay", methods=["POST"])
def handle_webhook():
    # 1. Verify signature
    body = request.get_data()
    sig  = request.headers.get("X-SorobanPay-Signature", "")
    expected = "sha256=" + hmac.new(WEBHOOK_SECRET.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, sig):
        return jsonify(error="Invalid signature"), 401

    # 2. Check timestamp
    ts = int(request.headers.get("X-SorobanPay-Timestamp", 0))
    if abs(time.time() - ts) > 300:
        return jsonify(error="Timestamp too old"), 400

    # 3. Deduplicate
    event_id = request.headers.get("X-SorobanPay-Event-ID")
    if db.session.get(ProcessedEvent, event_id):
        return jsonify(ok=True, duplicate=True), 200

    # 4. Process
    data = request.get_json()
    handle_event(data)

    # 5. Mark processed
    db.session.add(ProcessedEvent(event_id=event_id))
    db.session.commit()

    return jsonify(ok=True), 200
```

---

## Viewing delivery history

### All deliveries for a merchant (last 100)

```bash
GET /api/v1/webhooks/deliveries/:merchant
```

### All attempts for a specific endpoint

```bash
GET /api/v1/webhooks/:endpointId/deliveries?limit=50&offset=0
```

Response:
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

Note: multiple records with the same `eventId` but different `deliveryId` indicate retry attempts for the same event.

---

## Retry schedule

| Attempt | Delay before attempt |
|---------|---------------------|
| 1 (first) | Immediate |
| 2 | 1 second |
| 3 | 5 seconds |
| 4 | 15 seconds |
| 5 | 1 minute |

After 5 failed attempts the delivery is abandoned. Check the delivery log for error details.

---

## Signature verification reference

The signature is computed as:

```
HMAC-SHA256(secret, request_body)
```

And sent as:

```
X-SorobanPay-Signature: sha256=<hex_digest>
```

Use a constant-time comparison (e.g. `crypto.timingSafeEqual` in Node.js, `hmac.compare_digest` in Python) when verifying to prevent timing-oracle attacks.
