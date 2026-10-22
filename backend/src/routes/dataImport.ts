/**
 * #734 — Data import API routes.
 *
 * Routes:
 *   POST   /api/v1/import                    — Start a new import job (multipart or JSON body)
 *   GET    /api/v1/import/:jobId             — Poll job status
 *   GET    /api/v1/import/:jobId/preview     — Get import preview
 *   POST   /api/v1/import/:jobId/rollback    — Rollback a completed import
 *   GET    /api/v1/import/history/:userId    — Get import history for a user
 */

import { Router, Request, Response } from 'express';
import {
  createImportJob,
  getImportJob,
  getImportHistory,
  rollbackImportJob,
  DuplicateStrategy,
  FieldSchema,
} from '../services/dataImportService';

const router = Router();

// ---------------------------------------------------------------------------
// Start import job
// ---------------------------------------------------------------------------

/**
 * POST /
 * Body (JSON): { userId, filename, content, strategy?, schema?, keyField? }
 *
 * - content: the raw file content as a string (CSV/JSON/XML)
 * - strategy: "skip" | "overwrite" | "merge" (default: "skip")
 * - schema: optional array of FieldSchema for validation
 * - keyField: field name used for duplicate detection (default: "id")
 */
router.post('/', async (req: Request, res: Response) => {
  const { userId, filename, content, strategy, schema, keyField } = req.body ?? {};

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }
  if (!filename || typeof filename !== 'string') {
    return res.status(400).json({ error: 'filename is required' });
  }
  if (!content || typeof content !== 'string') {
    return res.status(400).json({ error: 'content is required (raw file text)' });
  }

  const validStrategies: DuplicateStrategy[] = ['skip', 'overwrite', 'merge'];
  const resolvedStrategy: DuplicateStrategy =
    validStrategies.includes(strategy) ? strategy : 'skip';

  try {
    const jobId = await createImportJob(
      userId,
      filename,
      content,
      resolvedStrategy,
      schema as FieldSchema[] | undefined,
      keyField ?? 'id',
    );

    return res.status(202).json({
      jobId,
      message: 'Import job created. Poll /api/v1/import/:jobId for status.',
    });
  } catch (err) {
    console.error('[import route] create error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Poll job status
// ---------------------------------------------------------------------------

/**
 * GET /:jobId
 */
router.get('/:jobId', async (req: Request, res: Response) => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid jobId' });

  try {
    const job = await getImportJob(jobId);
    if (!job) return res.status(404).json({ error: 'Import job not found' });

    let errors: unknown[] = [];
    try { errors = job.errors ? JSON.parse(job.errors) : []; } catch { /* */ }

    let duplicates: unknown[] = [];
    try { duplicates = job.duplicates ? JSON.parse(job.duplicates) : []; } catch { /* */ }

    return res.json({
      jobId:        job.id,
      userId:       job.userId,
      filename:     job.filename,
      format:       job.format,
      status:       job.status,
      strategy:     job.strategy,
      totalRows:    job.totalRows,
      processedRows: job.processedRows,
      errorCount:   job.errorCount,
      errors,
      duplicateCount: duplicates.length,
      createdAt:    job.createdAt,
      updatedAt:    job.updatedAt,
    });
  } catch (err) {
    console.error('[import route] status error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

/**
 * GET /:jobId/preview
 */
router.get('/:jobId/preview', async (req: Request, res: Response) => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid jobId' });

  try {
    const job = await getImportJob(jobId);
    if (!job) return res.status(404).json({ error: 'Import job not found' });

    if (!job.preview) {
      return res.status(425).json({
        error: 'Preview not ready yet',
        status: job.status,
        message: 'Wait for status to reach "previewing" or later',
      });
    }

    let preview: unknown = null;
    try { preview = JSON.parse(job.preview); } catch { /* */ }

    let errors: unknown[] = [];
    try { errors = job.errors ? JSON.parse(job.errors) : []; } catch { /* */ }

    let duplicates: unknown[] = [];
    try { duplicates = job.duplicates ? JSON.parse(job.duplicates) : []; } catch { /* */ }

    return res.json({
      jobId: job.id,
      status: job.status,
      preview,
      validationErrors: errors,
      duplicates,
      totalRows: job.totalRows,
    });
  } catch (err) {
    console.error('[import route] preview error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

/**
 * POST /:jobId/rollback
 * Body: { userId }
 */
router.post('/:jobId/rollback', async (req: Request, res: Response) => {
  const jobId = parseInt(String(req.params.jobId), 10);
  if (isNaN(jobId)) return res.status(400).json({ error: 'Invalid jobId' });

  const { userId } = req.body ?? {};
  if (!userId) return res.status(400).json({ error: 'userId is required' });

  try {
    const result = await rollbackImportJob(jobId, userId);

    if (!result.success) {
      return res.status(400).json({ error: result.message });
    }

    return res.json({ success: true, message: result.message });
  } catch (err) {
    console.error('[import route] rollback error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// Import history
// ---------------------------------------------------------------------------

/**
 * GET /history/:userId?limit=20
 */
router.get('/history/:userId', async (req: Request, res: Response) => {
  const userId = String(req.params.userId);
  const limit = Math.min(parseInt(String(req.query.limit ?? '20'), 10), 100);

  try {
    const history = await getImportHistory(userId, limit);
    return res.json({ userId, count: history.length, imports: history });
  } catch (err) {
    console.error('[import route] history error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
