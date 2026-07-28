/**
 * Migration: 20240101000005_webhook_idempotency
 *
 * BE-74: Add idempotency fields to webhook_deliveries and
 *        signing secret to webhook_endpoints.
 *
 * Changes:
 *   webhook_endpoints  — add `secret` column (nullable text)
 *   webhook_deliveries — add `event_id`    (stable per on-chain event, idempotency key)
 *                      — add `delivery_id` (uuid, unique per attempt)
 *                      — add `endpoint_id` FK to webhook_endpoints
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  // ─── webhook_endpoints: add optional HMAC signing secret ──────────────────
  pgm.addColumn('webhook_endpoints', {
    secret: {
      type: 'text',
      notNull: false,
      comment: 'HMAC-SHA256 signing secret; null = unsigned deliveries',
    },
  });

  // ─── webhook_deliveries: idempotency columns ───────────────────────────────

  // Stable event identifier — sha256(txHash:eventIndex), constant across retries.
  // Merchants use this as their idempotency key.
  pgm.addColumn('webhook_deliveries', {
    event_id: {
      type: 'varchar(64)',
      notNull: false,         // nullable during migration; backfilled below
      comment: 'Stable event identifier (sha256 of txHash:eventIndex). Idempotency key for merchants.',
    },
  });

  // Backfill existing rows with a deterministic placeholder so NOT NULL
  // can be enforced after migration.
  pgm.sql(`
    UPDATE webhook_deliveries
    SET event_id = concat('legacy-', id::text)
    WHERE event_id IS NULL
  `);

  pgm.alterColumn('webhook_deliveries', 'event_id', { notNull: true });

  // Unique-per-attempt delivery UUID.
  pgm.addColumn('webhook_deliveries', {
    delivery_id: {
      type: 'uuid',
      notNull: false,
      comment: 'UUID unique per delivery attempt. Changes on every retry.',
    },
  });

  // Backfill existing rows
  pgm.sql(`
    UPDATE webhook_deliveries
    SET delivery_id = gen_random_uuid()
    WHERE delivery_id IS NULL
  `);

  pgm.alterColumn('webhook_deliveries', 'delivery_id', { notNull: true });

  // Foreign key to webhook_endpoints (nullable — older rows may lack it)
  pgm.addColumn('webhook_deliveries', {
    endpoint_id: {
      type: 'integer',
      notNull: false,
      references: '"webhook_endpoints"',
      onDelete: 'SET NULL',
    },
  });

  // Indexes
  pgm.createIndex('webhook_deliveries', ['event_id']);
  pgm.addConstraint('webhook_deliveries', 'webhook_deliveries_delivery_id_unique', {
    unique: ['delivery_id'],
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.dropIndex('webhook_deliveries', ['event_id']);
  pgm.dropConstraint('webhook_deliveries', 'webhook_deliveries_delivery_id_unique');
  pgm.dropColumn('webhook_deliveries', 'endpoint_id');
  pgm.dropColumn('webhook_deliveries', 'delivery_id');
  pgm.dropColumn('webhook_deliveries', 'event_id');
  pgm.dropColumn('webhook_endpoints', 'secret');
};
