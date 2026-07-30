import { YieldCalculationEngine, type VaultPosition } from '../src/services/yieldCalculationEngine';

describe('YieldCalculationEngine', () => {
  const engine = new YieldCalculationEngine();

  it('calculates compounded daily yield from APY for active positions', () => {
    const position: VaultPosition = {
      id: 'pos-1',
      principal: 1000,
      status: 'active',
      yieldSources: [{ name: 'staking', apy: 0.12 }],
      lastCalculatedAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    const result = engine.calculatePositionYield(position, new Date('2024-01-02T00:00:00.000Z'));

    expect(result.status).toBe('updated');
    expect(result.accruedYield).toBeCloseTo(0.328767, 6);
    expect(result.updatedPrincipal).toBeCloseTo(1000.328767, 6);
    expect(result.effectiveApy).toBeCloseTo(0.12, 6);
  });

  it('blends multiple yield sources with weights', () => {
    const position: VaultPosition = {
      id: 'pos-2',
      principal: 500,
      status: 'active',
      yieldSources: [
        { name: 'staking', apy: 0.10, weight: 1 },
        { name: 'fees', apy: 0.04, weight: 1 },
        { name: 'incentives', apy: 0.02, weight: 2 },
      ],
      lastCalculatedAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    const result = engine.calculatePositionYield(position, new Date('2024-01-01T12:00:00.000Z'));

    expect(result.status).toBe('updated');
    expect(result.effectiveApy).toBeCloseTo(0.045, 6);
    expect(result.accruedYield).toBeGreaterThan(0);
  });

  it('skips inactive or closed positions without accruing yield', () => {
    const position: VaultPosition = {
      id: 'pos-3',
      principal: 250,
      status: 'deactivated',
      yieldSources: [{ name: 'staking', apy: 0.08 }],
      lastCalculatedAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    const result = engine.calculatePositionYield(position, new Date('2024-01-02T00:00:00.000Z'));

    expect(result.status).toBe('skipped');
    expect(result.accruedYield).toBe(0);
    expect(result.updatedPrincipal).toBe(250);
  });

  it('supports backfill for historical hourly snapshots', () => {
    const position: VaultPosition = {
      id: 'pos-4',
      principal: 100,
      status: 'active',
      yieldSources: [{ name: 'staking', apy: 0.1 }],
      lastCalculatedAt: new Date('2024-01-01T00:00:00.000Z'),
    };

    const snapshots = engine.backfillHistoricalYield(position, new Date('2024-01-01T00:00:00.000Z'), new Date('2024-01-01T03:00:00.000Z'), 1);

    expect(snapshots).toHaveLength(4);
    expect(snapshots[0].hour).toBe(0);
    expect(snapshots[3].principal).toBeGreaterThan(100);
    expect(snapshots[3].principal).toBeGreaterThan(snapshots[2].principal);
  });

  it('alerts when a batch item fails to calculate', async () => {
    const alerts: Array<{ positionId: string; error: string }> = [];
    const monitoringEngine = new YieldCalculationEngine({
      onFailure: ({ positionId, error }) => alerts.push({ positionId, error }),
    });

    const results = await monitoringEngine.processBatch([
      {
        id: 'good',
        principal: 100,
        status: 'active',
        yieldSources: [{ name: 'staking', apy: 0.05 }],
        lastCalculatedAt: new Date('2024-01-01T00:00:00.000Z'),
      },
      {
        id: 'bad',
        principal: Number.NaN,
        status: 'active',
        yieldSources: [{ name: 'staking', apy: 0.05 }],
        lastCalculatedAt: new Date('2024-01-01T00:00:00.000Z'),
      } as VaultPosition,
    ], new Date('2024-01-02T00:00:00.000Z'));

    expect(results).toHaveLength(2);
    expect(alerts).toHaveLength(1);
    expect(alerts[0].positionId).toBe('bad');
  });
});
