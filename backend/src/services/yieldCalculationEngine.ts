export type YieldSource = {
  name: string;
  apy: number;
  weight?: number;
};

export type VaultStatus = 'active' | 'deactivated' | 'closed';

export type VaultPosition = {
  id: string;
  principal: number;
  status: VaultStatus;
  yieldSources: YieldSource[];
  lastCalculatedAt: Date;
};

export type YieldCalculationResult = {
  positionId: string;
  status: 'updated' | 'skipped';
  effectiveApy: number;
  accruedYield: number;
  updatedPrincipal: number;
  computedAt: Date;
  sourceBreakdown: Array<{ name: string; apy: number; weight: number }>;
};

export type HistoricalYieldSnapshot = {
  hour: number;
  principal: number;
  accruedYield: number;
  effectiveApy: number;
};

export type YieldFailureContext = {
  positionId: string;
  error: string;
  computedAt: Date;
};

export type YieldMonitoringConfig = {
  onFailure?: (context: YieldFailureContext) => void;
};

export class YieldCalculationEngine {
  private readonly updateIntervalHours = 1;

  constructor(private readonly monitoring?: YieldMonitoringConfig) {}

  calculatePositionYield(position: VaultPosition, now: Date = new Date()): YieldCalculationResult {
    this.validatePosition(position);

    if (position.status !== 'active') {
      return {
        positionId: position.id,
        status: 'skipped',
        effectiveApy: this.calculateEffectiveApy(position.yieldSources),
        accruedYield: 0,
        updatedPrincipal: position.principal,
        computedAt: now,
        sourceBreakdown: this.buildSourceBreakdown(position.yieldSources),
      };
    }

    const effectiveApy = this.calculateEffectiveApy(position.yieldSources);
    const hoursElapsed = this.getHoursElapsed(position.lastCalculatedAt, now);
    const dailyRate = effectiveApy / 365;
    const compoundedYield = position.principal * (Math.pow(1 + dailyRate, hoursElapsed / 24) - 1);

    return {
      positionId: position.id,
      status: hoursElapsed >= this.updateIntervalHours ? 'updated' : 'skipped',
      effectiveApy,
      accruedYield: compoundedYield,
      updatedPrincipal: position.principal + compoundedYield,
      computedAt: now,
      sourceBreakdown: this.buildSourceBreakdown(position.yieldSources),
    };
  }

  backfillHistoricalYield(
    position: VaultPosition,
    start: Date,
    end: Date,
    intervalHours: number = 1,
  ): HistoricalYieldSnapshot[] {
    const snapshots: HistoricalYieldSnapshot[] = [];
    const hours = Math.floor((end.getTime() - start.getTime()) / (1000 * 60 * 60));
    let runningPrincipal = position.principal;

    for (let hour = 0; hour <= hours; hour += intervalHours) {
      const snapshotTime = new Date(start.getTime() + hour * 60 * 60 * 1000);
      const statefulPosition: VaultPosition = {
        ...position,
        principal: runningPrincipal,
        lastCalculatedAt: hour === 0 ? start : new Date(start.getTime() + (hour - intervalHours) * 60 * 60 * 1000),
      };
      const result = this.calculatePositionYield(statefulPosition, snapshotTime);
      runningPrincipal = result.updatedPrincipal;

      snapshots.push({
        hour,
        principal: result.updatedPrincipal,
        accruedYield: result.accruedYield,
        effectiveApy: result.effectiveApy,
      });
    }

    return snapshots;
  }

  async processBatch(positions: VaultPosition[], now: Date = new Date()): Promise<YieldCalculationResult[]> {
    const results: YieldCalculationResult[] = [];

    for (const position of positions) {
      try {
        results.push(this.calculatePositionYield(position, now));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.monitoring?.onFailure?.({
          positionId: position.id,
          error: message,
          computedAt: now,
        });
        results.push({
          positionId: position.id,
          status: 'skipped',
          effectiveApy: this.calculateEffectiveApy(position.yieldSources),
          accruedYield: 0,
          updatedPrincipal: position.principal,
          computedAt: now,
          sourceBreakdown: this.buildSourceBreakdown(position.yieldSources),
        });
      }
    }

    return results;
  }

  private validatePosition(position: VaultPosition): void {
    if (!position?.id) {
      throw new Error('Position is missing an id');
    }
    if (typeof position.principal !== 'number' || Number.isNaN(position.principal)) {
      throw new Error(`Position ${position.id} has an invalid principal`);
    }
    if (!Array.isArray(position.yieldSources)) {
      throw new Error(`Position ${position.id} has invalid yieldSources`);
    }
    if (!(position.lastCalculatedAt instanceof Date) || Number.isNaN(position.lastCalculatedAt.getTime())) {
      throw new Error(`Position ${position.id} has an invalid lastCalculatedAt value`);
    }
    if (!['active', 'deactivated', 'closed'].includes(position.status)) {
      throw new Error(`Position ${position.id} has an unsupported status`);
    }
  }

  private calculateEffectiveApy(sources: YieldSource[]): number {
    if (sources.length === 0) {
      return 0;
    }

    const totalWeight = sources.reduce((sum, source) => sum + (source.weight ?? 1), 0);
    const weightedApy = sources.reduce((sum, source) => sum + (source.apy * (source.weight ?? 1)), 0);

    return totalWeight > 0 ? weightedApy / totalWeight : 0;
  }

  private buildSourceBreakdown(sources: YieldSource[]) {
    return sources.map((source) => ({
      name: source.name,
      apy: source.apy,
      weight: source.weight ?? 1,
    }));
  }

  private getHoursElapsed(from: Date, to: Date): number {
    const diffMs = Math.max(0, to.getTime() - from.getTime());
    return Math.floor(diffMs / (1000 * 60 * 60));
  }
}
