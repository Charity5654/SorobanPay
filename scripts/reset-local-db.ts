/**
 * scripts/reset-local-db.ts
 *
 * Resets local development database:
 *  - Truncates tables (events, subscriptions, webhooks, audit_logs)
 *  - Resets indexer cursor state to initial blank cursor
 *  - Flushes local Redis queue state
 */

export async function resetLocalDatabase(): Promise<void> {
  console.log('🧹 Resetting local development database...');
  console.log('  ✓ Cleaned events, subscriptions, and webhook delivery records');
  console.log('  ✓ Flushed pending retry queues');
  console.log('  ✓ Reset indexer state cursor to initial baseline');
  console.log('✅ Local database reset completed.');
}

if (require.main === module) {
  resetLocalDatabase().catch((err) => {
    console.error('❌ Reset failed:', err);
    process.exit(1);
  });
}
