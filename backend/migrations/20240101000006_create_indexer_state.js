/**
 * Migration: 20240101000006_create_indexer_state
 *
 * BE-75: Creates the `indexer_state` key-value table used by the
 *        admin /indexer endpoint and the event indexer polling loop
 *        to persist cursor and last-poll-at timestamps.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.up = async (pgm) => {
  pgm.createTable('indexer_state', {
    key: {
      type: 'varchar(128)',
      primaryKey: true,
      notNull: true,
    },
    value: {
      type: 'text',
      notNull: true,
      default: '',
    },
    updated_at: {
      type: 'timestamptz',
      notNull: true,
      default: pgm.func('now()'),
    },
  });

  // Seed with default keys so the admin endpoint can always SELECT them
  pgm.sql(`
    INSERT INTO indexer_state (key, value) VALUES
      ('last_event_cursor', ''),
      ('last_poll_at',      '')
    ON CONFLICT (key) DO NOTHING
  `);
};

/**
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
exports.down = async (pgm) => {
  pgm.dropTable('indexer_state');
};
