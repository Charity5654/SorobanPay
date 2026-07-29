import { Router, Request, Response } from 'express';

export const extendedHealthRouter = Router();

export class HealthState {
  public static isReady = false;
  public static postgres: 'healthy' | 'unhealthy' = 'healthy';
  public static redis: 'healthy' | 'unhealthy' = 'healthy';
  public static stellarRpc: 'healthy' | 'unhealthy' = 'healthy';
  public static indexerLagSeconds = 12;
  public static startTime = Date.now();

  public static reset() {
    this.isReady = false;
    this.postgres = 'healthy';
    this.redis = 'healthy';
    this.stellarRpc = 'healthy';
    this.indexerLagSeconds = 12;
  }
}

extendedHealthRouter.get('/health', async (req: Request, res: Response) => {
  const isHealthy =
    HealthState.postgres === 'healthy' &&
    HealthState.redis === 'healthy' &&
    HealthState.stellarRpc === 'healthy';

  const status = isHealthy ? 'healthy' : 'degraded';
  const uptime = Math.floor((Date.now() - HealthState.startTime) / 1000);

  const responseBody = {
    status,
    uptime,
    dependencies: {
      postgres: HealthState.postgres,
      redis: HealthState.redis,
      stellar_rpc: HealthState.stellarRpc,
      indexer_lag_seconds: HealthState.indexerLagSeconds
    }
  };

  return res.status(isHealthy ? 200 : 503).json(responseBody);
});

extendedHealthRouter.get('/health/ready', (req: Request, res: Response) => {
  if (HealthState.isReady) {
    return res.status(200).json({ status: 'ready' });
  }
  return res.status(503).json({ status: 'not_ready', detail: 'Migration or first RPC poll pending' });
});

extendedHealthRouter.get('/health/live', (req: Request, res: Response) => {
  return res.status(200).json({ status: 'alive' });
});
