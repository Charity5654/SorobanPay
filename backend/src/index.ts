import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import cron from 'node-cron';
import { validateConfig } from './lib/config';
import { EventIndexer } from './services/eventIndexer';
import { PayoutSummaryGenerator } from './services/payoutSummaryGenerator';
import { PaymentScheduler } from './services/paymentScheduler';
import { YieldCalculationEngine } from './services/yieldCalculationEngine';
import summariesRouter from './routes/summaries';
import subscriptionsRouter from './routes/subscriptions';
import auditLogsRouter from './routes/auditLogs';
import { apiLimiter } from './middleware/rateLimiter';

const app = express();
const config = validateConfig(process.env);
const { port: PORT, rpcUrl, contractId } = config;

// Middleware
app.use(cors());
app.use(express.json());
app.use(apiLimiter);

// Routes
app.use('/api/summaries', summariesRouter);
app.use('/api/subscriptions', subscriptionsRouter);
app.use('/api/audit-logs', auditLogsRouter);

// Initialize services
const networkPassphrase = process.env.NETWORK_PASSPHRASE || 'Test SDF Network ; September 2015';

const eventIndexer = new EventIndexer(rpcUrl, contractId);
const summaryGenerator = new PayoutSummaryGenerator();
const yieldEngine = new YieldCalculationEngine({
  onFailure: (context) => {
    console.error(`[yield-engine] Calculation failed for ${context.positionId}: ${context.error}`);
  },
});

// Payment scheduler — only active when operator secret is configured
const operatorSecret = process.env.OPERATOR_SECRET;
const paymentScheduler = operatorSecret
  ? new PaymentScheduler(rpcUrl, contractId, operatorSecret, networkPassphrase)
  : null;

// Schedule jobs
// Fetch events every 5 minutes
cron.schedule('*/5 * * * *', async () => {
  console.log('Fetching new events...');
  await eventIndexer.fetchAndStoreEvents();
});

// Execute due payments every minute
cron.schedule('* * * * *', async () => {
  if (!paymentScheduler) return;
  await paymentScheduler.processDuePayments();
});

// Generate daily summaries at 1 AM every day
cron.schedule('0 1 * * *', async () => {
  console.log('Generating daily summaries...');
  await summaryGenerator.generateDailySummaries();
});

// Generate weekly summaries at 2 AM every Sunday
cron.schedule('0 2 * * 0', async () => {
  console.log('Generating weekly summaries...');
  await summaryGenerator.generateWeeklySummaries();
});

// Recalculate active vault positions every hour
cron.schedule('0 * * * *', async () => {
  console.log('Updating vault yield positions...');
  const samplePositions: Array<{
    id: string;
    principal: number;
    status: 'active' | 'deactivated' | 'closed';
    yieldSources: Array<{ name: string; apy: number; weight?: number }>;
    lastCalculatedAt: Date;
  }> = [];

  await yieldEngine.processBatch(samplePositions);
});

// Start server
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  if (!operatorSecret) {
    console.warn('[scheduler] OPERATOR_SECRET not set — payment scheduler disabled.');
  }
  // Initial fetch of events
  eventIndexer.fetchAndStoreEvents();
});
