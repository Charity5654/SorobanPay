/**
 * Retry routes — manage payment retry records for a (subscriber, merchant) pair.
 *
 * Mounted at /api/v1/subscriptions/:subscriber/:merchant/retries
 *
 * GET  — list all retry records (all statuses, newest first)
 * DELETE — cancel all PENDING retry jobs for the pair
 */

import { Router, Request, Response } from 'express';
import prisma from '../lib/prisma';
import { cancelRetries } from '../services/retryQueue';

const router = Router({ mergeParams: true });

/**
 * GET /api/v1/subscriptions/:subscriber/:merchant/retries
 *
 * Returns all PaymentRetry records for the given subscription pair,
 * ordered by attemptNumber ascending.
 *
 * Response body:
 * {
 *   subscriber: string,
 *   merchant:   string,
 *   retries: Array<{
 *     id:             number,
 *     attemptNumber:  number,
 *     scheduledAt:    string (ISO 8601),
 *     executedAt:     string | null,
 *     status:         "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "CANCELLED",
 *     errorMessage:   string | null,
 *     createdAt:      string (ISO 8601),
 *     updatedAt:      string (ISO 8601),
 *   }>
 * }
 *
 * 404 when no retry records exist for the pair.
 */
router.get('/', async (req: Request, res: Response) => {
  const { subscriber, merchant } = req.params as { subscriber: string; merchant: string };

  try {
    const retries = await prisma.paymentRetry.findMany({
      where: { subscriber, merchant },
      orderBy: { attemptNumber: 'asc' },
      select: {
        id: true,
        attemptNumber: true,
        scheduledAt: true,
        executedAt: true,
        status: true,
        errorMessage: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (retries.length === 0) {
      return res.status(404).json({
        error: 'No retry records found for this subscription.',
        subscriber,
        merchant,
      });
    }

    return res.json({ subscriber, merchant, retries });
  } catch (err) {
    console.error('[retries] GET error:', err);
    return res.status(500).json({ error: 'Failed to fetch retry records.' });
  }
});

/**
 * DELETE /api/v1/subscriptions/:subscriber/:merchant/retries
 *
 * Cancels all PENDING retry jobs for the given subscription pair.
 * Jobs that are already PROCESSING, SUCCEEDED, or FAILED are not affected.
 *
 * Response body:
 * {
 *   subscriber: string,
 *   merchant:   string,
 *   cancelled:  number    // number of jobs cancelled
 * }
 *
 * 404 when there are no PENDING retries to cancel.
 */
router.delete('/', async (req: Request, res: Response) => {
  const { subscriber, merchant } = req.params as { subscriber: string; merchant: string };

  try {
    const cancelled = await cancelRetries(subscriber, merchant);

    if (cancelled === 0) {
      return res.status(404).json({
        error: 'No pending retry jobs found for this subscription.',
        subscriber,
        merchant,
      });
    }

    return res.json({ subscriber, merchant, cancelled });
  } catch (err) {
    console.error('[retries] DELETE error:', err);
    return res.status(500).json({ error: 'Failed to cancel retry jobs.' });
  }
});

export default router;
