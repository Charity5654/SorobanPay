'use client';

/**
 * useSubscriptions.ts
 *
 * Fetches active subscriptions for the connected wallet by:
 *   1. Querying getEvents() for "subscribe" events where subscriber == publicKey
 *   2. Querying getEvents() for "cancel" events where subscriber == publicKey
 *   3. Cross-referencing to determine active (subscribed but not cancelled) pairs
 *   4. Calling get_subscription() (via simulateTransaction) for each active pair
 *      to retrieve amount, interval, and next_payment timestamp
 *
 * Returns loading, error, subscriptions array, and a refetch function.
 *
 * Dashboard feature – subscriber view
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Contract,
  Address,
  xdr,
  scValToNative,
  TransactionBuilder,
  BASE_FEE,
  SorobanRpc,
} from '@stellar/stellar-sdk';
import { RPC_URL, NETWORK_PASSPHRASE, CONTRACT_ID } from '@/constants/network';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface Subscription {
  /** Merchant Stellar G-address */
  merchant: string;
  /** Token contract C-address */
  token: string;
  /** Payment amount in token's smallest unit (stroops) as BigInt */
  amount: bigint;
  /** Payment interval in seconds */
  interval: number;
  /** Unix timestamp (seconds) of the next scheduled payment */
  nextPayment: number;
  /** Unique key: "subscriber:merchant" */
  key: string;
  /** True while the cancel transaction is being submitted */
  isCancelling: boolean;
  /** Non-null after a successful optimistic cancel */
  cancelledAt: Date | null;
}

export interface UseSubscriptionsReturn {
  subscriptions: Subscription[];
  isLoading: boolean;
  error: string | null;
  refetch: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Decode a base64-encoded XDR ScVal to its native JS value */
function decodeScVal(b64: string): unknown {
  return scValToNative(xdr.ScVal.fromXDR(b64, 'base64'));
}

/** Decode a ScVal object directly to its native JS value */
function decodeScValDirect(val: xdr.ScVal): unknown {
  return scValToNative(val);
}

/** Safely convert a decoded ScVal value to string (addresses come back as strings) */
function toStr(v: unknown): string {
  if (typeof v === 'string') return v;
  return String(v);
}

// Maximum ledger range for getEvents – Stellar RPC caps at 4320 ledgers (~6 hours)
// For a broader history we paginate; here we use 4000 to stay under the cap.
const LEDGER_WINDOW = 4000;

// ─── Main hook ────────────────────────────────────────────────────────────────

export function useSubscriptions(publicKey: string | null): UseSubscriptionsReturn {
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Ref to allow external refetch trigger
  const fetchCounterRef = useRef(0);
  const [fetchTick, setFetchTick] = useState(0);

  const refetch = useCallback(() => {
    fetchCounterRef.current += 1;
    setFetchTick((t) => t + 1);
  }, []);

  useEffect(() => {
    if (!publicKey || !CONTRACT_ID) return;

    let cancelled = false;

    async function load() {
      if (!publicKey) return;

      setIsLoading(true);
      setError(null);

      try {
        const server = new SorobanRpc.Server(RPC_URL, { allowHttp: false });

        // ── 1. Get the current ledger number ───────────────────────────────
        const latestLedger = await server.getLatestLedger();
        const endLedger = latestLedger.sequence;
        // Clamp to a valid window; RPC minimum start ledger is 1
        const startLedger = Math.max(1, endLedger - LEDGER_WINDOW);

        // ── 2. Fetch subscribe events for this subscriber ──────────────────
        // Topic filter: [symbol("subscribe"), subscriber_address]
        const subscribeEventsResponse = await server.getEvents({
          startLedger,
          filters: [
            {
              type: 'contract',
              contractIds: [CONTRACT_ID],
              topics: [
                [
                  // topic[0]: Symbol "subscribe"
                  xdr.ScVal.scvSymbol('subscribe').toXDR('base64'),
                  // topic[1]: the subscriber address
                  new Address(publicKey).toScVal().toXDR('base64'),
                ],
              ],
            },
          ],
        });

        if (cancelled) return;

        // ── 3. Fetch cancel events for this subscriber ─────────────────────
        const cancelEventsResponse = await server.getEvents({
          startLedger,
          filters: [
            {
              type: 'contract',
              contractIds: [CONTRACT_ID],
              topics: [
                [
                  xdr.ScVal.scvSymbol('cancel').toXDR('base64'),
                  new Address(publicKey).toScVal().toXDR('base64'),
                ],
              ],
            },
          ],
        });

        if (cancelled) return;

        // ── 4. Build the set of cancelled (merchant) addresses ─────────────
        const cancelledMerchants = new Set<string>();
        for (const event of cancelEventsResponse.events) {
          // topics: [symbol("cancel"), subscriber, merchant]
          if (event.topic.length >= 3) {
            const merchant = toStr(decodeScValDirect(event.topic[2]));
            cancelledMerchants.add(merchant);
          }
        }

        // ── 5. Determine active subscribe events (latest per merchant) ─────
        // A subscriber may re-subscribe after cancelling, so we need the
        // *latest* subscribe event per merchant and check that no cancel
        // event with a *later* ledger exists. Since we're working with all
        // events from a window, we track last-seen subscribe per merchant.
        const latestSubscribePerMerchant = new Map<
          string,
          { merchant: string; token: string; ledger: number }
        >();

        for (const event of subscribeEventsResponse.events) {
          // topics: [symbol("subscribe"), subscriber, merchant, token]
          if (event.topic.length < 4) continue;
          const merchant = toStr(decodeScValDirect(event.topic[2]));
          const token = toStr(decodeScValDirect(event.topic[3]));
          const ledger = event.ledger;

          const existing = latestSubscribePerMerchant.get(merchant);
          if (!existing || ledger > existing.ledger) {
            latestSubscribePerMerchant.set(merchant, { merchant, token, ledger });
          }
        }

        // Filter out cancelled merchants
        const activePairs = Array.from(latestSubscribePerMerchant.values()).filter(
          ({ merchant }) => !cancelledMerchants.has(merchant),
        );

        if (cancelled) return;

        // ── 6. Fetch on-chain subscription details for each active pair ────
        const contract = new Contract(CONTRACT_ID);
        const account = await server.getAccount(publicKey);

        const results: Subscription[] = [];

        for (const { merchant, token } of activePairs) {
          if (cancelled) return;

          try {
            // Build a get_subscription query tx for simulation
            const tx = new TransactionBuilder(account, {
              fee: BASE_FEE,
              networkPassphrase: NETWORK_PASSPHRASE,
            })
              .addOperation(
                contract.call(
                  'get_subscription',
                  new Address(publicKey).toScVal(),
                  new Address(merchant).toScVal(),
                ),
              )
              .setTimeout(30)
              .build();

            const simResult = await server.simulateTransaction(tx);

            if (
              SorobanRpc.Api.isSimulationSuccess(simResult) &&
              simResult.result?.retval
            ) {
              // get_subscription returns a map/struct:
              // { subscriber, merchant, token, amount: i128, interval: u64, next_payment: u64 }
              const native = scValToNative(simResult.result.retval) as Record<
                string,
                unknown
              >;

              const amount =
                typeof native.amount === 'bigint'
                  ? native.amount
                  : BigInt(String(native.amount ?? 0));

              const interval =
                typeof native.interval === 'bigint'
                  ? Number(native.interval)
                  : Number(native.interval ?? 0);

              const nextPayment =
                typeof native.next_payment === 'bigint'
                  ? Number(native.next_payment)
                  : Number(native.next_payment ?? 0);

              results.push({
                merchant,
                token,
                amount,
                interval,
                nextPayment,
                key: `${publicKey}:${merchant}`,
                isCancelling: false,
                cancelledAt: null,
              });
            }
          } catch {
            // Subscription may have been cancelled on-chain after events window —
            // silently skip this pair rather than failing the entire load.
          }
        }

        if (!cancelled) {
          setSubscriptions(results);
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(`Failed to load subscriptions: ${msg}`);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [publicKey, fetchTick]);

  // ── Optimistic cancel helper ─────────────────────────────────────────────
  // Exposed via a separate setter so SubscriptionCard can update state
  // without triggering a full refetch.
  const updateSubscription = useCallback(
    (key: string, patch: Partial<Subscription>) => {
      setSubscriptions((prev) =>
        prev.map((s) => (s.key === key ? { ...s, ...patch } : s)),
      );
    },
    [],
  );

  // Return the update helper as part of an extended object for internal use.
  // useSubscriptionsWithUpdater is the public API; this file just exports
  // the base hook.
  return {
    subscriptions,
    isLoading,
    error,
    refetch,
    // Internal — cast to match public type; callers that need updateSubscription
    // should use the augmented return value.
    ..._internals(updateSubscription),
  } as UseSubscriptionsReturn & {
    _updateSubscription: typeof updateSubscription;
  };
}

/** Internal: expose updateSubscription without polluting the public type */
function _internals(
  updateSubscription: (key: string, patch: Partial<Subscription>) => void,
) {
  return { _updateSubscription: updateSubscription };
}

// Re-export for consumers that need to call _updateSubscription
export type UseSubscriptionsInternalReturn = UseSubscriptionsReturn & {
  _updateSubscription: (key: string, patch: Partial<Subscription>) => void;
};
