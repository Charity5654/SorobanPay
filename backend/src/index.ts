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
import { apiLimiter } from './middleware/rateLimiter';
import { versionMiddleware } from './middleware/versioning';
import summariesRouter from './routes/summaries';
import reconcileRouter from './routes/reconcile';
import subscriptionsRouter from './routes/subscriptions';
import webhooksRouter from './routes/webhooks';
import notificationsRouter from './routes/notifications';
import versionRouter from './routes/version';
import { buildHealthRouter } from './routes/health';
import { reconcile } from './services/reconciler';
import { PrismaSubscriptionDB, fetchChainEventsFromDB } from './services/reconciler';

// ─── Config ─────────────────────────────────────────────────────────────────
const config = validateConfig();
const { port: PORT, rpcUrl, contractId } = config;

// ─── App ─────────────────────────────────────────────────────────────────────
const app = express();

app.use(cors());
app.use(express.json());
app.use(apiLimiter);
app.use(versionMiddleware);   // BE-69: attach version info + deprecation headers

// ─── Version manifest ────────────────────────────────────────────────────────
// GET /  →  version manifest
app.use('/', versionRouter);

// ─── Health (unversioned) ────────────────────────────────────────────────────
app.use('/health', buildHealthRouter(rpcUrl, contractId));

// ─── Versioned routes — /api/v1/ ─────────────────────────────────────────────
app.use('/api/v1/subscriptions', subscriptionsRouter);
app.use('/api/v1/webhooks',      webhooksRouter);
app.use('/api/v1/summaries',     summariesRouter);
app.use('/api/v1/reconcile',     reconcileRouter);
app.use('/api/v1/notifications', notificationsRouter);  // BE-68

// ─── Backward-compatible aliases — /api/ (no version prefix) ─────────────────
// These keep existing integrations working and forward to v1 handlers.
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/webhooks',      webhooksRouter);
app.use('/api/summaries',     summariesRouter);
app.use('/api/reconcile',     reconcileRouter);
app.use('/api/notifications', notificationsRouter);

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

// ─── Cron jobs ───────────────────────────────────────────────────────────────
// Fetch events every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('[cron] Fetching new events...');
  await eventIndexer.fetchAndStoreEvents();
});

// Execute due payments every minute
cron.schedule('* * * * *', async () => {
  if (!paymentScheduler) return;
  await paymentScheduler.processDuePayments();
});

// Generate daily summaries at 1 AM every day
cron.schedule('0 1 * * *', async () => {
  console.log('[cron] Generating daily summaries...');
  await summaryGenerator.generateDailySummaries();
});

// Generate weekly summaries at 2 AM every Sunday
cron.schedule('0 2 * * 0', async () => {
  console.log('[cron] Generating weekly summaries...');
  await summaryGenerator.generateWeeklySummaries();
});

// Run reconciliation every hour
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

// ─── Start ───────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[server] SorobanPay backend running on port ${PORT}`);
  if (!operatorSecret) {
    console.warn('[scheduler] OPERATOR_SECRET not set — payment scheduler disabled.');
  }
  // Initial event fetch on startup
  eventIndexer.fetchAndStoreEvents();
});

export default app;
