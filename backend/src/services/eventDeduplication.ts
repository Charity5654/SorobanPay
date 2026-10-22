export interface PaymentEventRecord {
  txHash: string;
  ledger: number;
  data: any;
}

export class EventDeduplicator {
  private processedPayments = new Set<string>();
  private processedGenericHashes = new Set<string>();
  private cursor = { lastLedger: 0, pagingToken: '' };

  public reset() {
    this.processedPayments.clear();
    this.processedGenericHashes.clear();
    this.cursor = { lastLedger: 0, pagingToken: '' };
  }

  public async processPaymentEventAtomic(
    event: PaymentEventRecord,
    ledger: number,
    pagingToken: string
  ): Promise<{ inserted: boolean }> {
    const naturalKey = `${event.txHash}:${event.ledger}`;
    if (this.processedPayments.has(naturalKey)) {
      return { inserted: false };
    }
    this.processedPayments.add(naturalKey);
    this.cursor = { lastLedger: ledger, pagingToken };
    return { inserted: true };
  }

  public async processGenericEventAtomic(
    eventHash: string,
    ledger: number,
    pagingToken: string
  ): Promise<{ processed: boolean }> {
    if (this.processedGenericHashes.has(eventHash)) {
      return { processed: false };
    }
    this.processedGenericHashes.add(eventHash);
    this.cursor = { lastLedger: ledger, pagingToken };
    return { processed: true };
  }

  public getCursor() {
    return this.cursor;
  }
}
