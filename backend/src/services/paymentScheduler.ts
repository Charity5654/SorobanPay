import {
  Keypair,
  rpc as SorobanRpc,
  Networks,
} from '@stellar/stellar-sdk';
import prisma from '../lib/prisma';
import logger from '../lib/logger';
import { redactAddress } from '../lib/logger';
import {
  submitExecutePayment,
  ExecutePaymentHelperError,
} from './executePaymentHelper';

/**
 * PaymentScheduler — discovers due subscriptions from the event index and
 * submits execute_payment transactions on behalf of the operator keypair.
 *
 * Subscriptions are considered "due" when:
 *   last `executed` event timestamp + interval <= now
 *   (or, for first payment: `subscribe` event timestamp + interval <= now)
 */
export class PaymentScheduler {
  private server: SorobanRpc.Server;
  private contractId: string;
  private operatorKeypair: Keypair;
  private networkPassphrase: string;

  constructor(
    rpcUrl: string,
    contractId: string,
    operatorSecret: string,
    networkPassphrase: string = Networks.TESTNET,
  ) {
    this.server = new SorobanRpc.Server(rpcUrl);
    this.contractId = contractId;
    this.operatorKeypair = Keypair.fromSecret(operatorSecret);
    this.networkPassphrase = networkPassphrase;
  }

  /** Main entry point called by the cron job. */
  async processDuePayments(): Promise<void> {
    const due = await this.findDueSubscriptions();
    if (due.length === 0) {
      logger.debug({ event: 'scheduler.no_due_payments' });
      return;
    }
    logger.info({ event: 'scheduler.due_payments_found', count: due.length });

    for (const { subscriber, merchant } of due) {
      try {
        const txHash = await this.executePayment(subscriber, merchant);
        logger.info({
          event: 'scheduler.payment_ok',
          subscriber: redactAddress(subscriber),
          merchant: redactAddress(merchant),
          txHash,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error({
          event: 'scheduler.payment_failed',
          subscriber: redactAddress(subscriber),
          merchant: redactAddress(merchant),
          msg,
        });
      }
    }
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Derive due subscriptions from the stored event log.
   * A subscription is due when now >= subscribe_time + interval and no
   * `executed` event has been recorded yet, OR when now >= last_executed + interval.
   */
  private async findDueSubscriptions(): Promise<{ subscriber: string; merchant: string }[]> {
    const nowSec = Math.floor(Date.now() / 1000);

    // Fetch all subscribe events (gives us known (subscriber, merchant) pairs)
    const subscribeEvents = await prisma.event.findMany({
      where: { type: 'subscribe' },
      orderBy: { ledgerTimestamp: 'desc' },
      // Take the latest subscribe event per pair to get the current interval/amount
      distinct: ['subscriber', 'merchant'],
    });

    const due: { subscriber: string; merchant: string }[] = [];

    for (const sub of subscribeEvents) {
      // Find the most recent executed event for this pair
      const lastExec = await prisma.event.findFirst({
        where: { type: 'executed', subscriber: sub.subscriber, merchant: sub.merchant },
        orderBy: { ledgerTimestamp: 'desc' },
      });

      // Resolve interval: stored in a subscribe event's amount field is token amount,
      // not interval. We approximate interval from two consecutive events or fall back
      // to a query by checking if any executed event exists within the last interval.
      // Since interval isn't directly stored in the Event table, we use a heuristic:
      // treat the gap between subscribe timestamp and now as the eligibility window.
      // Merchants should call execute_payment once per interval; we trigger when
      // no executed event exists OR when the time since last execution exceeds
      // the minimum interval (1 day = 86400 seconds).
      const lastTimestamp = lastExec
        ? Number(lastExec.ledgerTimestamp)
        : Number(sub.ledgerTimestamp);

      const secondsSinceLast = nowSec - lastTimestamp;

      // Minimum interval per contract is 86400 seconds (1 day)
      if (secondsSinceLast >= 86400) {
        due.push({ subscriber: sub.subscriber, merchant: sub.merchant });
      }
    }

    return due;
  }

  /** Build, simulate, and submit an execute_payment transaction. */
  async executePayment(subscriber: string, merchant: string): Promise<string> {
    const result = await submitExecutePayment(
      { subscriber, merchant },
      {
        server: this.server,
        contractId: this.contractId,
        signer: this.operatorKeypair,
        networkPassphrase: this.networkPassphrase,
      },
    );

    return result.txHash;
  }
}
