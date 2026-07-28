/**
 * Migration: 20240101000004_create_webhook_tables
 *
 * Creates `webhook_endpoints` and `webhook_deliveries` tables.
 * Mirrors the Prisma `WebhookEndpoint` and `WebhookDelivery` models.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  // ─── webhook_endpoints ─────────────────────────────────────────────────────
  pgm.createTable('webhook_endpoints', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    merchant: {
      type: 'varchar(128)',
      notNull: true,
    },
    url: {
      type: 'varchar(2048)',
      notNull: true,
    },
    active: {
      type: 'boolean',
      notNull: true,
      default: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Unique constraint: one endpoint URL per merchant
  pgm.addConstraint('webhook_endpoints', 'webhook_endpoints_merchant_url_unique', {
    unique: ['merchant', 'url'],
  });

  // Index for looking up active endpoints by merchant
  pgm.createIndex('webhook_endpoints', ['merchant', 'active']);

  // ─── webhook_deliveries ────────────────────────────────────────────────────
  pgm.createTable('webhook_deliveries', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    url: {
      type: 'varchar(2048)',
      notNull: true,
    },
    merchant: {
      type: 'varchar(128)',
      notNull: true,
    },
    event: {
      type: 'varchar(100)',
      notNull: true,
    },
    payload: {
      type: 'text',
      notNull: true,
    },
    status_code: {
      type: 'integer',
      notNull: true,
    },
    attempt: {
      type: 'integer',
      notNull: true,
    },
    success: {
      type: 'boolean',
      notNull: true,
    },
    error: {
      type: 'text',
      notNull: false,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Index for audit queries
  pgm.createIndex('webhook_deliveries', ['merchant', 'created_at']);
  pgm.createIndex('webhook_deliveries', ['merchant', 'success', 'created_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.dropTable('webhook_deliveries');
  pgm.dropTable('webhook_endpoints');
};
