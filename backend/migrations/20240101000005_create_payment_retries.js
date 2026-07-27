/**
 * Migration: 20240101000005_create_payment_retries
 *
 * Creates `payment_retries` and `retry_configs` tables.
 * Mirrors the Prisma `PaymentRetry` and `RetryConfig` models.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  // ─── payment_retries ───────────────────────────────────────────────────────
  pgm.createTable('payment_retries', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    subscriber: {
      type: 'varchar(128)',
      notNull: true,
    },
    merchant: {
      type: 'varchar(128)',
      notNull: true,
    },
    amount: {
      type: 'varchar(64)',
      notNull: true,
    },
    token: {
      type: 'varchar(128)',
      notNull: true,
      default: '',
    },
    attempt_number: {
      type: 'integer',
      notNull: true,
    },
    status: {
      type: 'varchar(20)',
      notNull: true,
      default: 'pending',
    },
    scheduled_at: {
      type: 'timestamptz',
      notNull: true,
    },
    executed_at: {
      type: 'timestamptz',
      notNull: false,
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
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Indexes matching Prisma @@index declarations
  pgm.createIndex('payment_retries', ['subscriber', 'merchant', 'status']);
  pgm.createIndex('payment_retries', ['scheduled_at', 'status']);

  // ─── retry_configs ─────────────────────────────────────────────────────────
  pgm.createTable('retry_configs', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    merchant: {
      type: 'varchar(128)',
      notNull: true,
    },
    intervals_days: {
      type: 'varchar(64)',
      notNull: true,
      default: '1,3,7',
    },
    webhook_url: {
      type: 'varchar(2048)',
      notNull: false,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  pgm.addConstraint('retry_configs', 'retry_configs_merchant_unique', {
    unique: ['merchant'],
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.dropTable('payment_retries');
  pgm.dropTable('retry_configs');
};
