/**
 * BE-69 — Version manifest route.
 *
 * GET /  →  version manifest listing all API versions and their status.
 * GET /api  →  same manifest, mounted at /api root.
 */

import { Router, Request, Response } from 'express';
import { API_VERSIONS, DEFAULT_VERSION } from '../middleware/versioning';

const router = Router();

const VERSION_MANIFEST = {
  service: 'sorobanpay-backend',
  currentVersion: DEFAULT_VERSION,
  versions: Object.values(API_VERSIONS).map((v) => ({
    version: v.version,
    status: v.status,
    sunset: v.sunset,
    url: `/api/${v.version}`,
  })),
  documentation: 'https://github.com/Chrisland58/SorobanPay/blob/main/docs/api-cookbook.md',
};

router.get('/', (_req: Request, res: Response) => {
  res.json(VERSION_MANIFEST);
});

export default router;
