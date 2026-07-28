/**
 * Migration: 20240101000001_create_events
 *
 * Creates the `events` table that stores indexed Soroban contract events
 * (subscribe, executed). Mirrors the Prisma `Event` model.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  pgm.createTable('events', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    type: {
      type: 'varchar(50)',
      notNull: true,
      comment: '"subscribe" or "executed"',
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
    ledger_timestamp: {
      type: 'bigint',
      notNull: true,
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Index for querying events by merchant
  pgm.createIndex('events', ['merchant', 'type']);

  // Index for querying events by subscriber + merchant pair
  pgm.createIndex('events', ['subscriber', 'merchant', 'type']);

  // Index for deduplication lookups
  pgm.createIndex('events', ['type', 'subscriber', 'merchant', 'token', 'amount', 'ledger_timestamp']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.dropTable('events');
};
