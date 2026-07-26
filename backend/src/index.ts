import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';

// BE-60: structured logger
import logger from './lib/logger';

// BE-60: correlation ID middleware
import { correlationIdMiddleware } from './middleware/correlationId';

// BE-59: rate limiters
import { apiLimiter, exportLimiter } from './middleware/rateLimiter';

// Config
import { validateConfig } from './lib/config';

// Services
import { EventIndexer } from './services/eventIndexer';
import { PayoutSummaryGenerator } from './services/payoutSummaryGenerator';
import { PaymentScheduler } from './services/paymentScheduler';
import { reconcile, PrismaSubscriptionDB, fetchChainEventsFromDB } from './services/reconciler';

// Routes
import { buildHealthRouter } from './routes/health';
import subscriptionsRouter from './routes/subscriptions';
import summariesRouter from './routes/summaries';
import reconcileRouter from './routes/reconcile';
import auditLogsRouter from './routes/auditLogs';
import webhooksRouter from './routes/webhooks';
import reportsRouter from './routes/reports';  // BE-58

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

let config;
try {
  config = validateConfig();
} catch (err) {
  logger.error({ event: 'startup.config_invalid', err }, 'Invalid configuration — aborting startup.');
  process.exit(1);
}

const { port: PORT, rpcUrl, contractId } = config;

// ---------------------------------------------------------------------------
// App setup
// ---------------------------------------------------------------------------

const app = express();

// Trust proxy if configured (needed for accurate IP in rate limiting)
if (process.env.RATE_LIMIT_TRUST_PROXY === 'true') {
  app.set('trust proxy', 1);
}

// BE-60: correlation ID + request logging (must come before routes)
app.use(correlationIdMiddleware);

// Body parsing with 10 KB limit (BE-59 requirement)
app.use(cors());
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));

// Global rate limiter (public endpoints: 60 req/min)
app.use(apiLimiter);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.use('/health', buildHealthRouter(rpcUrl, contractId));
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/summaries', summariesRouter);
app.use('/api/reconcile', reconcileRouter);
app.use('/api/audit-logs', auditLogsRouter);
app.use('/api/webhooks', webhooksRouter);
app.use('/v1/reports/payments', exportLimiter, reportsRouter);  // BE-58

// ---------------------------------------------------------------------------
// Services
// ---------------------------------------------------------------------------

const networkPassphrase = config.networkPassphrase;

const eventIndexer = new EventIndexer(rpcUrl, contractId);
const summaryGenerator = new PayoutSummaryGenerator();

const operatorSecret = process.env.OPERATOR_SECRET;
const paymentScheduler = operatorSecret
  ? new PaymentScheduler(rpcUrl, contractId, operatorSecret, networkPassphrase)
  : null;

// ---------------------------------------------------------------------------
// Scheduled jobs
// ---------------------------------------------------------------------------

// Fetch events every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  logger.debug({ event: 'cron.events.start' });
  await eventIndexer.fetchAndStoreEvents();
});

// Execute due payments every minute
cron.schedule('* * * * *', async () => {
  if (!paymentScheduler) return;
  await paymentScheduler.processDuePayments();
});

// Generate daily summaries at 1 AM every day
cron.schedule('0 1 * * *', async () => {
  logger.info({ event: 'cron.daily_summaries.start' });
  await summaryGenerator.generateDailySummaries();
});

// Generate weekly summaries at 2 AM every Sunday
cron.schedule('0 2 * * 0', async () => {
  logger.info({ event: 'cron.weekly_summaries.start' });
  await summaryGenerator.generateWeeklySummaries();
});

// Run reconciliation every hour
cron.schedule('0 * * * *', async () => {
  logger.info({ event: 'cron.reconciliation.start' });
  try {
    const [chainEvents, db] = await Promise.all([
      fetchChainEventsFromDB(),
      PrismaSubscriptionDB.load(),
    ]);
    const { repairs, errors } = reconcile(chainEvents, db);
    logger.info({
      event: 'cron.reconciliation.complete',
      repairs: repairs.length,
      errors: errors.length,
    });
    if (errors.length > 0) {
      logger.warn({ event: 'cron.reconciliation.errors', errors });
    }
  } catch (err) {
    logger.error({ event: 'cron.reconciliation.error', err });
  }
});

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

app.listen(PORT, () => {
  logger.info({ event: 'server.start', port: PORT }, `Server listening on port ${PORT}`);
  if (!operatorSecret) {
    logger.warn({ event: 'scheduler.disabled' }, 'OPERATOR_SECRET not set — payment scheduler disabled.');
  }
  // Initial event fetch
  eventIndexer.fetchAndStoreEvents();
});

export { app };
