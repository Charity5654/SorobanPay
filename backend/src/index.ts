/**
 * SorobanPay backend — main entry point.
 *
 * Import order matters: tracing MUST be first so OpenTelemetry can patch
 * all subsequently loaded modules (Express, http, Prisma).
 */
import { initTracing } from './lib/tracing';
initTracing();

import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { validateConfig } from './lib/config';
import { EventIndexer } from './services/eventIndexer';
import { PayoutSummaryGenerator } from './services/payoutSummaryGenerator';
import { PaymentScheduler } from './services/paymentScheduler';
import { createRetryScheduler } from './services/retryScheduler';
import { retryQueue } from './services/retryQueue';
import { startWebhookWorker, shutdownWebhookWorker } from './services/webhookQueue'; // BE-53
import { apiLimiter } from './middleware/rateLimiter';
import { versionMiddleware } from './middleware/versioning';
import summariesRouter from './routes/summaries';
import reconcileRouter from './routes/reconcile';
import subscriptionsRouter from './routes/subscriptions';
import webhooksRouter from './routes/webhooks';
import notificationsRouter from './routes/notifications';
import kycRouter from './routes/kyc';
import versionRouter from './routes/version';
import analyticsRouter from './routes/analytics';   // FE-50 / BE-52
import reportsRouter from './routes/reports';        // BE-58: revenue reporting export
import adminRouter from './routes/admin';
import authRouter from './routes/auth';                        // BE-55: merchant auth
import { buildHealthRouter } from './routes/health';
import { requireMerchant } from './middleware/merchantAuth';  // BE-55: JWT guard
import { reconcile } from './services/reconciler';
import { PrismaSubscriptionDB, fetchChainEventsFromDB } from './services/reconciler';
import { getPrometheusMetrics } from './services/metricsService';
import retriesRouter from './routes/retries';
import { startRetryWorker, shutdownRetryWorker } from './services/retryQueue';

// ─── Migration startup guard (#1078) ─────────────────────────────────────────

export interface MigrationStatus {
  hasPending: boolean;
  pendingCount: number;
  error?: string;
}

/**
 * Checks for pending database migrations by comparing migration files on disk
 * against applied records in the _prisma_migrations table.
 * Never throws — errors are captured in the `error` field.
 */
export async function checkPendingMigrations(): Promise<MigrationStatus> {
  try {
    const fs = await import('fs');
    const path = await import('path');
    const migrationsDir = path.resolve(__dirname, '../../migrations');

    if (!fs.existsSync(migrationsDir)) {
      return { hasPending: false, pendingCount: 0 };
    }

    const migrationFiles: string[] = fs
      .readdirSync(migrationsDir)
      .filter((f: string) => f.endsWith('.js') || f.endsWith('.sql'))
      .sort();

    if (migrationFiles.length === 0) {
      return { hasPending: false, pendingCount: 0 };
    }

    let appliedNames: string[] = [];
    try {
      const prismaModule = await import('./lib/prisma');
      const prismaClient = prismaModule.default;
      const rows = await prismaClient.$queryRaw<{ migration_name: string }[]>`
        SELECT migration_name FROM "_prisma_migrations"
        WHERE finished_at IS NOT NULL
      `;
      appliedNames = rows.map((r) => r.migration_name);
    } catch {
      // Table absent on first deploy — treat all files as pending
      return { hasPending: true, pendingCount: migrationFiles.length };
    }

    const pendingCount = migrationFiles.filter(
      (f: string) =>
        !appliedNames.some(
          (name) =>
            f.startsWith(name) || name.startsWith(f.replace(/\.(js|sql)$/, '')),
        ),
    ).length;

    return { hasPending: pendingCount > 0, pendingCount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { hasPending: false, pendingCount: 0, error: message };
  }
}

/**
 * Migration startup guard:
 *  - MIGRATE_ON_START=true  → run `prisma migrate deploy` before server starts
 *  - otherwise              → warn about pending migrations, never auto-apply
 */
async function runMigrationGuard(): Promise<void> {
  const status = await checkPendingMigrations();

  if (status.error) {
    console.warn(`[migrations] Migration check error: ${status.error}`);
    return;
  }

  if (!status.hasPending) {
    console.log('[migrations] Database schema is up to date.');
    return;
  }

  if (process.env.MIGRATE_ON_START === 'true') {
    console.log(
      `[migrations] MIGRATE_ON_START=true — applying ${status.pendingCount} pending migration(s)...`,
    );
    const { execSync } = await import('child_process');
    try {
      execSync('npx prisma migrate deploy', { stdio: 'inherit', cwd: process.cwd() });
      console.log('[migrations] Migrations applied successfully.');
    } catch {
      // Do not expose connection details in the log
      throw new Error('[migrations] Startup migration failed. Check DB connectivity.');
    }
  } else {
    console.warn(
      `[migrations] WARNING: ${status.pendingCount} pending migration(s) detected. ` +
        'Set MIGRATE_ON_START=true to apply automatically, or run ' +
        '`npx prisma migrate deploy` manually before starting the server.',
    );
  }
}

// ─── Config ─────────────────────────────────────────────────────────────────
const config = validateConfig();
const { port: PORT, rpcUrl, contractId } = config;

// ─── App ─────────────────────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json());

// Dynamic tenant middleware
try {
  const { tenantAuthMiddleware } = require('./middleware/tenantAuth');
  if (tenantAuthMiddleware) app.use(tenantAuthMiddleware);
} catch (e) {}

app.use(apiLimiter);
app.use(versionMiddleware);   // BE-69: attach version info + deprecation headers

// Dynamic extended health check routes (GET /health, /health/ready, /health/live)
try {
  const { extendedHealthRouter } = require('./routes/extendedHealth');
  if (extendedHealthRouter) {
    app.use('/', extendedHealthRouter);
  }
} catch (e) {}

// Dynamic GraphQL endpoint (/graphql)
try {
  const { handleGraphQLRequest } = require('./graphql/server');
  if (handleGraphQLRequest) {
    app.use('/graphql', handleGraphQLRequest);
  }
} catch (e) {}

// Dynamic Tenant Admin Router
try {
  const { tenantAdminRouter } = require('./routes/adminTenants');
  if (tenantAdminRouter) {
    app.use('/v1/admin', tenantAdminRouter);
  }
} catch (e) {}

// ─── Version manifest ────────────────────────────────────────────────────────
// GET /  →  version manifest
app.use('/', versionRouter);

// ─── Health (unversioned) ────────────────────────────────────────────────────
app.use('/health', buildHealthRouter(rpcUrl, contractId));

// ─── Versioned routes — /api/v1/ ─────────────────────────────────────────────
app.use('/api/v1/auth',          authRouter);                             // BE-55: unauthenticated
app.use('/api/v1/subscriptions', requireMerchant, subscriptionsRouter);  // BE-55: protected
app.use('/api/v1/subscriptions/:subscriber/:merchant/retries', retriesRouter);
app.use('/api/v1/webhooks',      webhooksRouter);
app.use('/api/v1/summaries',     summariesRouter);
app.use('/api/v1/reconcile',     reconcileRouter);
app.use('/api/v1/notifications', notificationsRouter);  // BE-68
app.use('/api/v1/admin',         adminRouter);          // BE-75: admin dashboard
app.use('/api/v1/analytics',     requireMerchant, analyticsRouter);  // FE-50: revenue analytics
app.use('/api/v1/reports',       requireMerchant, reportsRouter);    // BE-58 / #798: payment reports export

// ─── Prometheus metrics (unauthenticated — restrict to internal network) ─────
app.get('/metrics', (_req, res) => {
  res.set('Content-Type', 'text/plain; version=0.0.4');
  res.send(getPrometheusMetrics());
});

// ─── Backward-compatible aliases — /api/ (no version prefix) ─────────────────
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/subscriptions/:subscriber/:merchant/retries', retriesRouter);
app.use('/api/webhooks',      webhooksRouter);
app.use('/api/summaries',     summariesRouter);
app.use('/api/reconcile',     reconcileRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/analytics',     analyticsRouter);        // FE-50: backward-compat alias
app.use('/api/reports',       reportsRouter);          // BE-58 / #798: backward-compat alias

// GET /api  →  same version manifest
app.use('/api', versionRouter);

// ─── Services ────────────────────────────────────────────────────────────────
const networkPassphrase = process.env.NETWORK_PASSPHRASE ?? 'Test SDF Network ; September 2015';
const eventIndexer      = new EventIndexer(rpcUrl, contractId);
const summaryGenerator  = new PayoutSummaryGenerator();

const operatorSecret = process.env.OPERATOR_SECRET;
const paymentScheduler = operatorSecret
  ? new PaymentScheduler(rpcUrl, contractId, operatorSecret, networkPassphrase)
  : null;

// ─── Retry infrastructure ─────────────────────────────────────────────────────
const retryScheduler = createRetryScheduler(rpcUrl, contractId, operatorSecret, networkPassphrase);
if (retryScheduler) {
  // Inject into eventIndexer so payment_transfer_failure events trigger retries
  eventIndexer.setRetryScheduler(retryScheduler);
} else {
  console.warn('[retry] OPERATOR_SECRET not set — automated payment retries disabled.');
}

// ─── Cron jobs ───────────────────────────────────────────────────────────────
cron.schedule('*/5 * * * *', async () => {
  console.log('[cron] Fetching new events...');
  await eventIndexer.fetchAndStoreEvents();
});

cron.schedule('* * * * *', async () => {
  if (!paymentScheduler) return;
  await paymentScheduler.processDuePayments();
});

// Process due retry jobs every minute
cron.schedule('* * * * *', async () => {
  await retryQueue.processDueJobs();
});

// Generate daily summaries at 1 AM every day
cron.schedule('0 1 * * *', async () => {
  console.log('[cron] Generating daily summaries...');
  await summaryGenerator.generateDailySummaries();
});

cron.schedule('0 2 * * 0', async () => {
  console.log('[cron] Generating weekly summaries...');
  await summaryGenerator.generateWeeklySummaries();
});

cron.schedule('0 * * * *', async () => {
  console.log('[cron] Running reconciliation...');
  try {
    const [chainEvents, db] = await Promise.all([
      fetchChainEventsFromDB(),
      PrismaSubscriptionDB.load(),
    ]);
    const { repairs, errors } = reconcile(chainEvents, db);
    console.log(`[cron] Reconciliation complete: ${repairs.length} repairs, ${errors.length} errors`);
    if (errors.length > 0) console.warn('[cron] Reconciliation errors:', errors);
  } catch (err) {
    console.error('[cron] Reconciliation error:', err);
  }
});

// #733: Process scheduled push notifications every minute
cron.schedule('* * * * *', async () => {
  await processScheduledNotifications().catch(err =>
    console.error('[cron] Scheduled push notifications error:', err)
  );
});

// ─── Start ───────────────────────────────────────────────────────────────────
// Run migration guard before accepting traffic (#1078)
runMigrationGuard()
  .catch((err: Error) => {
    console.error('[migrations] Fatal startup error:', err.message);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`[server] SorobanPay backend running on port ${PORT}`);
      if (!operatorSecret) {
        console.warn('[scheduler] OPERATOR_SECRET not set — payment scheduler disabled.');
      }
      try {
        startRetryWorker();
      } catch (err) {
        console.warn('[retryWorker] Could not start retry worker (Redis unavailable?):', err);
      }
      eventIndexer.fetchAndStoreEvents();
    });
  });

// ─── Graceful shutdown ────────────────────────────────────────────────────────
process.on('SIGTERM', async () => {
  console.log('[server] SIGTERM received — shutting down gracefully...');
  eventIndexer.stopPolling();   // BE-51: stop cursor-based polling
  await shutdownRetryWorker();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[server] SIGINT received — shutting down gracefully...');
  eventIndexer.stopPolling();
  await shutdownRetryWorker();
  process.exit(0);
});

export default app;
