/**
 * Migration: 20240101000005_create_payment_retries
 *
 * Creates the `payment_retries` table that tracks automated retry attempts
 * for failed subscription payments (payment_transfer_failure events).
 *
 * Columns:
 *   subscriber   — Stellar address of the subscriber
 *   merchant     — Stellar address of the merchant
 *   amount       — Payment amount (stored as text for big-int safety)
 *   token        — SEP-41 token contract address
 *   attempt_number — 1-indexed retry count (1 = first retry after initial failure)
 *   status       — 'pending' | 'succeeded' | 'failed' | 'cancelled'
 *   scheduled_at — UTC timestamp when this retry is due to fire
 *   attempted_at — UTC timestamp when the retry was actually executed (null if not yet run)
 *   error        — Last error message if the attempt failed
 *   job_id       — BullMQ job ID, used to cancel the queued job if needed
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
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
      default: '0',
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
      // 'pending' | 'succeeded' | 'failed' | 'cancelled'
    },
    scheduled_at: {
      type: 'timestamptz',
      notNull: true,
    },
    attempted_at: {
      type: 'timestamptz',
      notNull: false,
    },
    error: {
      type: 'text',
      notNull: false,
    },
    job_id: {
      type: 'varchar(256)',
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

  // Look up all retries for a given subscription pair (most common query)
  pgm.createIndex('payment_retries', ['subscriber', 'merchant']);

  // Look up pending retries by status (for monitoring / cleanup)
  pgm.createIndex('payment_retries', ['status', 'scheduled_at']);

  // Correlate with BullMQ jobs for cancellation
  pgm.createIndex('payment_retries', ['job_id']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.dropTable('payment_retries');
};
