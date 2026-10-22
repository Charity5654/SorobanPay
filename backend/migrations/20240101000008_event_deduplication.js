exports.up = function(knex) {
  return knex.schema
    .createTable('processed_events', function(table) {
      table.string('event_hash', 128).primary();
      table.string('tenant_id', 64).notNullable().defaultTo('default');
      table.timestamp('processed_at').defaultTo(knex.fn.now());
    })
    .then(function() {
      return knex.raw(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_events_tx_hash_ledger ON events (tx_hash, ledger);
      `);
    });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('processed_events');
};
