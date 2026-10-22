exports.up = function(knex) {
  return knex.schema
    .createTable('tenants', function(table) {
      table.string('id', 64).primary();
      table.string('name', 255).notNullable();
      table.string('contract_id', 64).notNullable().unique();
      table.timestamp('created_at').defaultTo(knex.fn.now());
    })
    .then(function() {
      return knex.raw(`
        ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
        ALTER TABLE events ADD COLUMN IF NOT EXISTS tenant_id VARCHAR(64) NOT NULL DEFAULT 'default';
      `);
    });
};

exports.down = function(knex) {
  return knex.schema.dropTableIfExists('tenants');
};
