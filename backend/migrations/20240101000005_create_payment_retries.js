/**
 * Migration: 20240101000005_create_payment_retries
 *
 * Creates the `payment_retries` table for tracking automated payment retry
 * attempts that are triggered by `payment_transfer_failure` contract events.
 *
 * Mirrors the Prisma `PaymentRetry` model.
 *
 * Status lifecycle:
 *   PENDING → PROCESSING → SUCCEEDED
 *                        → FAILED
 *                        → CANCELLED (via DELETE /retries endpoint)
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
    token: {
      type: 'varchar(128)',
      notNull: true,
      default: '',
    },
    amount: {
      type: 'varchar(64)',
      notNull: true,
      default: '0',
    },
    // 1-based attempt counter (1 = first retry, up to MAX_RETRY_ATTEMPTS = 3).
    attempt_number: {
      type: 'integer',
      notNull: true,
    },
    // Wall-clock time at which this retry job is scheduled to execute.
    scheduled_at: {
      type: 'timestamptz',
      notNull: true,
    },
    // Set when the job actually runs (success or failure).
    executed_at: {
      type: 'timestamptz',
      notNull: false,
    },
    // PENDING | PROCESSING | SUCCEEDED | FAILED | CANCELLED
    status: {
      type: 'varchar(32)',
      notNull: true,
      default: 'PENDING',
    },
    // Error message captured on FAILED status.
    error_message: {
      type: 'text',
      notNull: false,
    },
    // BullMQ job ID — stored so the DELETE endpoint can remove the queued job.
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

  // ─── Constraints ────────────────────────────────────────────────────────────

  // One DB row per (subscriber, merchant, attemptNumber) — prevents
  // duplicate scheduling when a failure event is processed twice.
  pgm.addConstraint(
    'payment_retries',
    'payment_retries_subscriber_merchant_attempt_unique',
    { unique: ['subscriber', 'merchant', 'attempt_number'] },
  );

  // ─── Indexes ────────────────────────────────────────────────────────────────

  // Fast lookup by subscription pair (used by GET and DELETE endpoints).
  pgm.createIndex('payment_retries', ['subscriber', 'merchant']);

  // Fast lookup of pending jobs eligible for processing.
  pgm.createIndex('payment_retries', ['status', 'scheduled_at']);

  // ─── updated_at trigger ─────────────────────────────────────────────────────
  // Automatically keep updated_at fresh on every row update.
  pgm.createFunction(
    'set_payment_retries_updated_at',
    [],
    { returns: 'trigger', language: 'plpgsql', replace: true },
    `BEGIN
       NEW.updated_at = now();
       RETURN NEW;
     END;`,
  );

  pgm.createTrigger('payment_retries', 'payment_retries_set_updated_at', {
    when: 'BEFORE',
    operation: 'UPDATE',
    level: 'ROW',
    function: 'set_payment_retries_updated_at',
  });
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.dropTrigger('payment_retries', 'payment_retries_set_updated_at', { ifExists: true });
  pgm.dropFunction('set_payment_retries_updated_at', [], { ifExists: true });
  pgm.dropTable('payment_retries');
};
