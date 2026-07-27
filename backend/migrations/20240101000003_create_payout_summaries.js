/**
 * Migration: 20240101000003_create_payout_summaries
 *
 * Creates the `payout_summaries` table for daily/weekly revenue aggregates.
 * Mirrors the Prisma `PayoutSummary` model.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  pgm.createTable('payout_summaries', {
    id: {
      type: 'serial',
      primaryKey: true,
    },
    merchant: {
      type: 'varchar(128)',
      notNull: true,
    },
    start_date: {
      type: 'timestamptz',
      notNull: true,
    },
    end_date: {
      type: 'timestamptz',
      notNull: true,
    },
    total_amount: {
      type: 'varchar(40)',
      notNull: true,
      comment: 'Total amount for the period as a string (i128-compatible)',
    },
    payment_count: {
      type: 'integer',
      notNull: true,
    },
    currency: {
      type: 'varchar(128)',
      notNull: true,
      comment: 'Token contract address',
    },
    type: {
      type: 'varchar(20)',
      notNull: true,
      comment: '"daily" or "weekly"',
    },
    created_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Unique constraint to prevent duplicate summaries for the same period
  pgm.addConstraint('payout_summaries', 'payout_summaries_unique_period', {
    unique: ['merchant', 'start_date', 'end_date', 'type', 'currency'],
  });

  // Index for merchant dashboard queries
  pgm.createIndex('payout_summaries', ['merchant', 'type', 'start_date']);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.dropTable('payout_summaries');
};
