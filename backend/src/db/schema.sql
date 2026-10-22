-- SorobanPay backend schema
-- Run this once against a fresh PostgreSQL database.

-- ---------------------------------------------------------------------------
-- Indexer state — persists the Soroban event cursor across restarts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS indexer_state (
    id            INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1), -- singleton row
    cursor        TEXT    NOT NULL DEFAULT '',                  -- last processed cursor
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed singleton row if not present
INSERT INTO indexer_state (id, cursor) VALUES (1, '')
    ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Subscriptions — one row per (subscriber, merchant) pair
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS subscriptions (
    id            BIGSERIAL    PRIMARY KEY,
    subscriber    TEXT         NOT NULL,
    merchant      TEXT         NOT NULL,
    token         TEXT         NOT NULL,
    amount        NUMERIC(38)  NOT NULL,
    interval_sec  BIGINT       NOT NULL,
    next_payment  TIMESTAMPTZ  NOT NULL,
    status        TEXT         NOT NULL DEFAULT 'active'
                                CHECK (status IN ('active', 'overdue', 'expired', 'cancelled')),
    overdue_since TIMESTAMPTZ,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_subscription UNIQUE (subscriber, merchant)
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_merchant ON subscriptions (merchant);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status   ON subscriptions (status);

-- ---------------------------------------------------------------------------
-- Payments — append-only event log
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS payments (
    id              BIGSERIAL    PRIMARY KEY,
    tx_hash         TEXT         NOT NULL,
    event_type      TEXT         NOT NULL
                                 CHECK (event_type IN ('executed', 'failure', 'cancel')),
    subscriber      TEXT         NOT NULL,
    merchant        TEXT         NOT NULL,
    amount          NUMERIC(38)  NOT NULL,
    payment_nonce   TEXT,
    ledger_seq      BIGINT,
    occurred_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_payment_tx UNIQUE (tx_hash, event_type, subscriber, merchant)
);

CREATE INDEX IF NOT EXISTS idx_payments_merchant    ON payments (merchant);
CREATE INDEX IF NOT EXISTS idx_payments_event_type  ON payments (event_type);
CREATE INDEX IF NOT EXISTS idx_payments_occurred_at ON payments (occurred_at);

-- ---------------------------------------------------------------------------
-- Webhook configurations — merchants register their endpoint here
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_configs (
    id          BIGSERIAL   PRIMARY KEY,
    merchant    TEXT        NOT NULL UNIQUE,
    url         TEXT        NOT NULL,
    secret      TEXT        NOT NULL,
    enabled     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Webhook deliveries — delivery log and dead-letter queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id              BIGSERIAL    PRIMARY KEY,
    merchant        TEXT         NOT NULL,
    event_type      TEXT         NOT NULL,
    payload         JSONB        NOT NULL,
    url             TEXT         NOT NULL,
    attempt         INTEGER      NOT NULL DEFAULT 1,
    status          TEXT         NOT NULL DEFAULT 'pending'
                                 CHECK (status IN ('pending', 'delivered', 'failed', 'dead')),
    response_status INTEGER,
    response_body   TEXT,
    error_message   TEXT,
    next_retry_at   TIMESTAMPTZ,
    delivered_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status      ON webhook_deliveries (status);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_merchant    ON webhook_deliveries (merchant);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry  ON webhook_deliveries (next_retry_at)
    WHERE status = 'pending';
