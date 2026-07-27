import { Router, Request, Response } from 'express';
import { reconcile } from '../services/reconciler';
import { PrismaSubscriptionDB, fetchChainEventsFromDB } from '../services/reconciler';
import logger from '../lib/logger';

const router = Router();

/**
 * GET /api/reconcile
 *
 * Runs the reconciler against the current DB state and returns the repair
 * report.  Pass ?dry_run=false to apply repairs; dry_run=true (default) only
 * returns what would change.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const dryRun = _req.query.dry_run !== 'false'; // default: dry run

    const [chainEvents, db] = await Promise.all([
      fetchChainEventsFromDB(),
      PrismaSubscriptionDB.load(),
    ]);

    if (dryRun) {
      // Use a throw-away copy so we don't mutate DB state
      const dryDb = await PrismaSubscriptionDB.load();
      const result = reconcile(chainEvents, dryDb);
      return res.json({ dry_run: true, ...result });
    }

    const result = reconcile(chainEvents, db);
    return res.json({ dry_run: false, ...result });
  } catch (error) {
    logger.error({ event: 'reconcile.error', err: error });
    return res.status(500).json({ error: 'Reconciliation failed' });
  }
});

export default router;
