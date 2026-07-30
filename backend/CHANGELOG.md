# Backend Changelog

All notable changes to the SorobanPay backend service are documented here.
This file follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/) format.

---

## [Unreleased]

### Added
- **BE-66** OpenTelemetry distributed tracing (`src/lib/tracing.ts`)
  - Auto-instrumentation for Express and HTTP clients via `@opentelemetry/auto-instrumentations-node`
  - OTLP HTTP exporter for Jaeger / any OTLP-compatible collector
  - Custom spans: `rpc.poll_cycle`, `event.decode`, `db.write_event`, `webhook.deliver`
  - Zero overhead when `OTEL_SDK_DISABLED=true`
  - Configurable sampling via `OTEL_SAMPLING_RATE` (0.0–1.0)
- **BE-67** Subscription lifecycle state machine (`src/lib/subscriptionStateMachine.ts`)
  - States: `ACTIVE`, `PAUSED`, `OVERDUE`, `CANCELLED`, `EXPIRED`
  - Transitions driven by on-chain events: `subscribe`, `executed`, `payment_transfer_failure`, `cancel`, `ttl_expired`
  - Invalid transitions logged as warnings; on-chain is always authoritative
  - `Subscription` table stores per-(subscriber, merchant) state
  - `status` field included in `/api/v1/subscriptions/merchant/:address` responses
- **BE-68** Payment failure email notifications (`src/services/emailService.ts`)
  - Nodemailer SMTP integration (SendGrid, AWS SES, Postmark compatible)
  - Templates for: payment failure, payment success, subscription cancellation
  - `EMAIL_DRY_RUN=true` logs emails to console without sending (default)
  - Opt-out / unsubscribe via `GET /api/v1/notifications/unsubscribe?token=`
  - `NotificationPreference` table for per-email opt-in/out
  - CAN-SPAM / GDPR compliant unsubscribe link in every email
- **BE-69** API versioning and deprecation strategy (`src/middleware/versioning.ts`)
  - URL path versioning: `/api/v1/`, `/api/v2/`
  - Accept header negotiation: `Accept: application/vnd.sorobanpay.v1+json`
  - `Deprecation`, `Sunset`, and `Link` headers per RFC 8594 on deprecated endpoints
  - Version manifest at `GET /` and `GET /api`
  - Backward-compatible `/api/` aliases pointing to v1 handlers
  - `apiVersion` field in health check responses

---

## [1.0.0] — Initial release

### API Versioning Policy

- **Within a major version** (e.g., v1): no breaking changes. Additive changes only (new fields, new optional params).
- **Breaking changes** require a new major version (v2, v3, …).
- **Deprecation timeline**: deprecated versions receive a `Sunset` date at least 6 months in the future. The `Deprecation: true` and `Sunset: <date>` headers are added to all responses from deprecated endpoints starting on the deprecation date.
- Clients are encouraged to use the version manifest (`GET /`) to discover sunset dates and migrate proactively.

### Added

- **Event indexing** (`EventIndexer`) — polls Soroban RPC `getEvents()` every 5 minutes
  - Supports `subscribe` and `executed` contract events
  - Deduplication by (type, subscriber, merchant, token, ledger)
- **Webhook delivery** (`WebhookNotifier`) — fan-out to merchant-registered HTTPS endpoints
  - Exponential back-off retry (5 attempts: 1s, 5s, 15s, 60s, 300s)
  - Full delivery log in `WebhookDelivery` table
- **Payment scheduler** (`PaymentScheduler`) — executes due on-chain payments every minute
  - Requires `OPERATOR_SECRET` env var; disabled if not set
- **Payout summaries** (`PayoutSummaryGenerator`) — daily and weekly revenue summaries
- **Reconciler** — compares chain events against DB state and repairs discrepancies
- **REST API v1**
  - `GET  /api/v1/subscriptions/merchant/:address` — active subscriptions with status
  - `GET  /api/v1/subscriptions/merchant/:address/payments` — payment history
  - `POST /api/v1/webhooks/endpoints` — register webhook endpoint
  - `DELETE /api/v1/webhooks/endpoints` — deactivate webhook endpoint
  - `GET  /api/v1/webhooks/deliveries/:merchant` — delivery log
  - `GET  /api/v1/summaries/merchant/:address` — payout summaries
  - `GET  /api/v1/reconcile` — reconciliation report
  - `POST /api/v1/notifications/preferences` — email opt-in
  - `GET  /api/v1/notifications/preferences/:email` — fetch preferences
  - `GET  /api/v1/notifications/unsubscribe?token=` — opt-out
  - `GET  /health` — RPC + contract health check with API version
  - `GET  /` — API version manifest

### Infrastructure

- PostgreSQL via Prisma ORM
- Express 5 with CORS and rate limiting
- `node-cron` for scheduled tasks
- `dotenv` for configuration
- `validateConfig()` fails fast on missing/invalid env vars

---

[Unreleased]: https://github.com/Chrisland58/SorobanPay/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Chrisland58/SorobanPay/releases/tag/v1.0.0
