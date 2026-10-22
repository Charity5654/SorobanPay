import { Router, Request, Response } from 'express';

/** Bounded check timeout in milliseconds (#1076). */
export const CHECK_TIMEOUT_MS = 5000;

/**
 * Runs `fn` with a bounded timeout. Returns null if the timeout fires first.
 * Prevents hung dependency probes from blocking health endpoints indefinitely.
 */
export async function checkWithTimeout<T>(
  fn: () => Promise<T>,
  timeoutMs: number = CHECK_TIMEOUT_MS,
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    fn()
      .then((result) => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(null);
      });
  });
}

export const extendedHealthRouter = Router();

export class HealthState {
  public static isReady = false;
  public static postgres: 'healthy' | 'unhealthy' = 'healthy';
  public static redis: 'healthy' | 'unhealthy' = 'healthy';
  public static stellarRpc: 'healthy' | 'unhealthy' = 'healthy';
  public static queue: 'healthy' | 'unhealthy' = 'healthy';
  public static indexerLagSeconds = 12;
  public static startTime = Date.now();

  public static reset() {
    this.isReady = false;
    this.postgres = 'healthy';
    this.redis = 'healthy';
    this.stellarRpc = 'healthy';
    this.queue = 'healthy';
    this.indexerLagSeconds = 12;
  }
}

// GET /health — aggregate liveness + dependency status
extendedHealthRouter.get('/health', async (_req: Request, res: Response) => {
  const isHealthy =
    HealthState.postgres === 'healthy' &&
    HealthState.redis === 'healthy' &&
    HealthState.stellarRpc === 'healthy';

  const status = isHealthy ? 'healthy' : 'degraded';
  const uptime = Math.floor((Date.now() - HealthState.startTime) / 1000);

  return res.status(isHealthy ? 200 : 503).json({
    status,
    uptime,
    dependencies: {
      postgres: HealthState.postgres,
      redis: HealthState.redis,
      stellar_rpc: HealthState.stellarRpc,
      queue: HealthState.queue,
      indexer_lag_seconds: HealthState.indexerLagSeconds,
    },
  });
});

// GET /health/ready — readiness probe: migrations done + critical deps healthy
extendedHealthRouter.get('/health/ready', (_req: Request, res: Response) => {
  if (!HealthState.isReady) {
    return res.status(503).json({
      status: 'not_ready',
      detail: 'Migration or first RPC poll pending',
    });
  }

  const criticalDepsHealthy =
    HealthState.postgres === 'healthy' && HealthState.stellarRpc === 'healthy';

  if (!criticalDepsHealthy) {
    return res.status(503).json({
      status: 'not_ready',
      reason: 'dependencies_unhealthy',
      dependencies: {
        postgres: HealthState.postgres,
        stellar_rpc: HealthState.stellarRpc,
      },
    });
  }

  return res.status(200).json({ status: 'ready' });
});

// GET /health/live — liveness probe: process is alive (never gated on deps)
extendedHealthRouter.get('/health/live', (_req: Request, res: Response) => {
  return res.status(200).json({ status: 'alive' });
});
