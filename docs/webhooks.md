# SorobanPay Webhook System

> **BE-53** — Push notifications for payment events.

Merchants can register HTTPS endpoints to receive real-time HTTP callbacks
when payments are executed or fail. This enables automated billing workflows
such as granting service access, sending email receipts, or triggering retry logic.

---

## Overview

```
On-chain event
     │
     ▼
EventIndexer (polls getEvents every 10 s)
     │
     ▼
webhookNotifier.notifyWebhooks()
     │ ┌─ Redis available ──────────────────────────────────┐
     ├─▶│  BullMQ queue → Worker → POST merchant URL        │
     │  └────────────────────────────────────────────────────┘
     │ ┌─ Redis unavailable (fallback) ──────────────────────┐
     └─▶│  Direct synchronous fetch → POST merchant URL     │
        └─────────────────────────────────────────────────────┘
```

---

## Registering a Webhook

### Request

```http
POST /api/v1/webhooks
Content-Type: application/json
Authorization: Bearer <JWT>

{
  "merchant": "GABC…MERCHANT",
  "url": "https://your-server.example.com/webhooks/sorobanpay",
  "events": ["payment.executed", "payment.failed"],
  "secret": "optional-custom-secret"
}
```

If `secret` is omitted, a cryptographically random 32-byte hex secret is
generated and stored server-side. The secret is **never returned** in any
response — store it securely at registration time if you provide your own.

### Response

```json
{
  "id": 42,
  "merchant": "GABC…MERCHANT",
  "url": "https://your-server.example.com/webhooks/sorobanpay",
  "active": true,
  "events": "payment.executed,payment.failed",
  "createdAt": "2024-01-15T10:30:00.000Z"
}
```

---

## Managing Endpoints

### List all endpoints for a merchant

```http
GET /api/v1/webhooks?merchant=GABC…MERCHANT
Authorization: Bearer <JWT>
```

### Update an endpoint

```http
PATCH /api/v1/webhooks/42
Content-Type: application/json
Authorization: Bearer <JWT>

{
  "events": ["payment.executed"],
  "active": false
}
```

### Delete an endpoint

```http
DELETE /api/v1/webhooks/42
Authorization: Bearer <JWT>
```

---

## Event Types

| Event type              | Trigger                                                |
|-------------------------|--------------------------------------------------------|
| `payment.executed`      | `execute_payment` succeeds — tokens transferred        |
| `payment.failed`        | `payment_transfer_failure` — insufficient balance      |
| `subscription.cancelled`| `cancel` — subscriber terminated the subscription     |

---

## Webhook Payload

Each delivery POSTs a JSON body to your endpoint:

```json
{
  "event": "payment.executed",
  "subscriber": "GSUB…",
  "merchant": "GMERCHANT…",
  "amount": "10000000",
  "txHash": "abc123…",
  "timestamp": 1705316200,
  "eventId": "a3f1b2c4…"
}
```

| Field        | Description                                                     |
|--------------|-----------------------------------------------------------------|
| `event`      | One of the event types above                                    |
| `subscriber` | Stellar address of the subscriber                               |
| `merchant`   | Stellar address of the merchant                                 |
| `amount`     | Payment amount in stroops (as string)                           |
| `txHash`     | Transaction hash on the Stellar network                         |
| `timestamp`  | Unix timestamp (seconds) of the event                           |
| `eventId`    | Stable SHA-256 identifier — constant across all retry attempts  |

---

## HMAC Signature Verification

Every delivery includes an `X-SorobanPay-Signature` header when a signing
secret is configured. Verify it server-side to ensure authenticity:

### TypeScript / Node.js

```typescript
import { createHmac, timingSafeEqual } from 'crypto';

function verifySignature(
  rawBody: string | Buffer,
  secret: string,
  signatureHeader: string,
): boolean {
  const expected = 'sha256=' +
    createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

  // Use timingSafeEqual to prevent timing attacks
  try {
    return timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected),
    );
  } catch {
    return false;
  }
}

// Express middleware example:
app.post('/webhooks/sorobanpay', express.raw({ type: 'application/json' }), (req, res) => {
  const sig = req.headers['x-sorobanpay-signature'] as string;
  if (!verifySignature(req.body, process.env.WEBHOOK_SECRET!, sig)) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  const payload = JSON.parse(req.body.toString());
  console.log('Received event:', payload.event, 'eventId:', payload.eventId);

  // Use payload.eventId as your idempotency key
  res.sendStatus(200);
});
```

### Python

```python
import hmac
import hashlib

def verify_signature(raw_body: bytes, secret: str, signature_header: str) -> bool:
    expected = 'sha256=' + hmac.new(
        secret.encode(),
        raw_body,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature_header)
```

---

## Request Headers

| Header                     | Description                                         |
|----------------------------|-----------------------------------------------------|
| `X-SorobanPay-Signature`   | `sha256=<hex>` HMAC-SHA256 of the raw request body |
| `X-SorobanPay-Event-ID`    | Stable event ID (use as idempotency key)           |
| `X-SorobanPay-Delivery-ID` | Unique UUID per delivery attempt                    |
| `X-SorobanPay-Timestamp`   | Unix timestamp (seconds) of the delivery attempt   |

---

## Retry Policy

Failed deliveries (non-2xx response or connection error) are automatically
retried **3 times** with exponential backoff:

| Attempt | Delay after failure |
|---------|---------------------|
| 1st     | 1 minute            |
| 2nd     | 5 minutes           |
| 3rd     | 30 minutes          |

After 3 failed attempts the delivery is marked permanently failed. Use the
`X-SorobanPay-Event-ID` header (stable across retries) as an idempotency key
to safely handle duplicate deliveries.

---

## Delivery Log

```http
GET /api/v1/webhooks/{id}/deliveries?limit=50&offset=0
Authorization: Bearer <JWT>
```

Returns paginated delivery attempts for a specific endpoint:

```json
{
  "data": [
    {
      "id": 1,
      "eventId": "a3f1b2c4…",
      "deliveryId": "uuid-per-attempt",
      "url": "https://your-server.example.com/webhooks/sorobanpay",
      "event": "payment.executed",
      "statusCode": 200,
      "attempt": 1,
      "success": true,
      "error": null,
      "createdAt": "2024-01-15T10:30:05.000Z"
    }
  ],
  "meta": { "total": 1, "limit": 50, "offset": 0 }
}
```

You can also query by merchant across all endpoints:

```http
GET /api/v1/webhooks/deliveries/{merchantAddress}
```

---

## Security Considerations

- **HTTPS required** — Webhook URLs must use HTTPS in production (`NODE_ENV=production`).
  HTTP URLs are allowed only in development for local testing.
- **Verify signatures** — Always verify the `X-SorobanPay-Signature` header before
  processing events.
- **Use timingSafeEqual** — Never use `===` to compare signatures (timing attack risk).
- **Idempotency** — Use `X-SorobanPay-Event-ID` to deduplicate retried deliveries.
- **Respond quickly** — Your endpoint must respond within **10 seconds**. For slow
  processing, respond 200 immediately and process asynchronously.

---

## Testing Locally

Use a tunnel service like [ngrok](https://ngrok.com) or [localtunnel](https://localtunnel.me)
to expose your local server:

```bash
# Start tunnel
ngrok http 3000

# Register your tunnel URL
curl -X POST http://localhost:3001/api/v1/webhooks \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <your-jwt>" \
  -d '{
    "merchant": "GABC…",
    "url": "https://abc123.ngrok.io/webhooks",
    "events": ["payment.executed", "payment.failed"]
  }'
```

For automated tests, use a mock HTTP server (e.g. `msw`, `nock`, or a simple Express app)
that records incoming requests and verifies signatures.
