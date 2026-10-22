import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { reconcile, dryRun } from '../services/reconciler';
import { PrismaSubscriptionDB, fetchChainEventsFromDB } from '../services/reconciler';
import { tenantAuthMiddleware, requireTenant, TenantRequest } from '../middleware/tenantAuth';
import { validateQuery } from '../middleware/validation';
import logger, { redactAddress } from '../lib/logger';

const router = Router();

// ─── Dry-run query schema ─────────────────────────────────────────────────────

const dryRunQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  cursor: z.string().optional(),
});

// ─── GET / ────────────────────────────────────────────────────────────────────

/**
 * GET /api/reconcile
 *
 * Runs the reconciler against the current DB state and returns the repair
 * report.  Pass ?dry_run=false to apply repairs; dry_run=true (default) only
 * returns what would change.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const dryRunFlag = _req.query.dry_run !== 'false'; // default: dry run

    const [chainEvents, db] = await Promise.all([
      fetchChainEventsFromDB(),
      PrismaSubscriptionDB.load(),
    ]);

    if (dryRunFlag) {
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

// ─── GET /dry-run ─────────────────────────────────────────────────────────────

/**
 * GET /api/reconcile/dry-run
 *
 * Computes discrepancies and proposed repairs without performing any writes.
 * Results are bounded and support cursor-based pagination.
 *
 * Query params:
 *   limit  — max repairs per page (1–500, default 50)
 *   cursor — opaque continuation token from a previous response
 *
 * Requires tenant context: either X-Tenant-ID header or a JWT with
 * `tenant_id` claim.
 *
 * Response:
 *   { dry_run: true, repairs, errors, total, nextCursor }
 */
router.get(
  '/dry-run',
  tenantAuthMiddleware,
  requireTenant,
  validateQuery(dryRunQuerySchema),
  async (req: TenantRequest, res: Response) => {
    const query = (req as any).validatedQuery as z.infer<typeof dryRunQuerySchema>;

    logger.info({
      event: 'reconcile.dryrun.start',
      tenantId: req.tenantId,
      limit: query.limit,
      hasCursor: !!query.cursor,
    });

    try {
      const [chainEvents, db] = await Promise.all([
        fetchChainEventsFromDB(),
        PrismaSubscriptionDB.load(),
      ]);

      const result = dryRun(chainEvents, db, {
        limit: query.limit,
        cursor: query.cursor,
      });

      logger.info({
        event: 'reconcile.dryrun.complete',
        tenantId: req.tenantId,
        total: result.total,
        pageSize: result.repairs.length,
      });

      return res.json({
        dry_run: true,
        ...result,
      });
    } catch (error) {
      logger.error({
        event: 'reconcile.dryrun.error',
        tenantId: req.tenantId,
        err: error,
      });
      return res.status(500).json({ error: 'Dry-run reconciliation failed' });
    }
  },
);

export default router;
