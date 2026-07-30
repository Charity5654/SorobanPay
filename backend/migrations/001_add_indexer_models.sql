-- BE-51: Event Indexer PostgreSQL migration
-- Adds IndexerState (cursor-based resumability) and Payment (normalised payment records).

-- IndexerState: singleton row tracking the RPC pagination cursor.
CREATE TABLE IF NOT EXISTS "IndexerState" (
    "id"                   SERIAL PRIMARY KEY,
    "lastCursor"           TEXT,
    "lastProcessedLedger"  INTEGER NOT NULL DEFAULT 0,
    "updatedAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Insert the initial singleton row (id = 1) so reads never return NULL.
INSERT INTO "IndexerState" ("id", "lastCursor", "lastProcessedLedger", "updatedAt")
VALUES (1, NULL, 0, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;

-- Payment: normalised record of executed payments with tx hash deduplication.
CREATE TABLE IF NOT EXISTS "Payment" (
    "id"         SERIAL PRIMARY KEY,
    "subscriber" TEXT         NOT NULL,
    "merchant"   TEXT         NOT NULL,
    "token"      TEXT         NOT NULL,
    "amount"     TEXT         NOT NULL,
    "txHash"     TEXT         NOT NULL UNIQUE,
    "ledger"     BIGINT       NOT NULL,
    "timestamp"  TIMESTAMP(3) NOT NULL,
    "status"     TEXT         NOT NULL DEFAULT 'executed',
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "Payment_merchant_timestamp_idx"
    ON "Payment" ("merchant", "timestamp");

CREATE INDEX IF NOT EXISTS "Payment_subscriber_merchant_idx"
    ON "Payment" ("subscriber", "merchant");
