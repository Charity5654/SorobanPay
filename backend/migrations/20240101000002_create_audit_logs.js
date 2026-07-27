/**
 * Migration: 20240101000002_create_audit_logs
 *
 * Creates the `audit_logs` table for payment audit trail records.
 * Mirrors the Prisma `AuditLog` model.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  pgm.createTable('audit_logs', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    event_type: {
      type: 'varchar(50)',
      notNull: true,
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
    },
    amount: {
      type: 'varchar(40)',
      notNull: true,
      comment: 'Stored as string to handle i128 big integers',
    },
    transaction_hash: {
      type: 'varchar(256)',
      notNull: true,
      unique: true,
    },
    ledger: {
      type: 'bigint',
      notNull: true,
    },
    status: {
      type: 'varchar(50)',
      notNull: true,
      default: "'executed'",
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Index for revenue reporting queries (merchant + date range)
  pgm.createIndex('audit_logs', ['merchant', 'created_at']);

  // Index for subscriber payment history
  pgm.createIndex('audit_logs', ['subscriber', 'merchant']);

  // Index for status filtering
  pgm.createIndex('audit_logs', ['merchant', 'status', 'created_at']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.dropTable('audit_logs');
};
