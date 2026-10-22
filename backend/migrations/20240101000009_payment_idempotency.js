/**
 * Migration: Add PaymentIdempotency table for tracking payment mutation idempotency keys.
 *
 * Issue #1060: Persist idempotency keys and return original results for safe retries
 * while rejecting conflicting payload reuse.
 *
 * The PaymentIdempotency table tracks:
 *  - idempotencyKey: Unique request identifier provided by caller
 *  - subscriber/merchant: Payment participants (for tenant isolation)
 *  - amount/token: Payment details (for conflict detection)
 *  - txHash: Result of successful payment (for idempotent retry response)
 *  - status: "pending" | "succeeded" | "failed" (for retry safety)
 *  - error: Error message if status="failed"
 *  - createdAt/updatedAt: Timestamps for audit trail
 *
 * Constraints:
 *  - (idempotencyKey) is globally unique
 *  - (subscriber, merchant, token) + same idempotencyKey can be retried safely
 *  - Different (amount) for same (subscriber, merchant) + same idempotencyKey → ConflictError
 */

exports.up = async (knex) => {
  const hasTable = await knex.schema.hasTable('payment_idempotency');

  if (!hasTable) {
    await knex.schema.createTable('payment_idempotency', (table) => {
      table.increments('id').primary();

      // Unique idempotency key from caller (e.g. UUID, or merchant-provided)
      table.string('idempotency_key', 255).notNullable().unique().index();

      // Payment participants and details (for conflict detection and tenant safety)
      table.string('subscriber', 255).notNullable().index();
      table.string('merchant', 255).notNullable().index();
      table.string('token', 255).notNullable();
      table.string('amount', 255).notNullable();

      // Result of the payment (if succeeded)
      table.string('tx_hash', 255).nullable().unique();

      // Idempotency state: "pending" | "succeeded" | "failed"
      table.string('status', 50).notNullable().defaultTo('pending');

      // Error message if status="failed" (for observability)
      table.text('error').nullable();

      // Audit trail
      table.timestamps(true, true);

      // Composite index for lookup by (subscriber, merchant) for efficiency
      table.index(['subscriber', 'merchant']);

      // Composite index for conflict detection: same (sub, merchant, token, amount)
      table.index(['subscriber', 'merchant', 'token', 'amount']);
    });
  }

  return undefined;
};

exports.down = async (knex) => {
  const hasTable = await knex.schema.hasTable('payment_idempotency');
  if (hasTable) {
    await knex.schema.dropTable('payment_idempotency');
  }

  return undefined;
};
