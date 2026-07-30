'use client';

/**
 * useMerchantSubscriptions.ts
 *
 * Hook for the merchant portal (/merchant).
 *
 * Two-phase data loading:
 *   Phase 1 — Index discovery:
 *     Polls Soroban RPC getEvents() for all `subscribe` events where the
 *     second topic equals the connected merchant's public key. This gives us
 *     the set of known (subscriber, merchant) pairs.
 *
 *   Phase 2 — State hydration:
 *     For each discovered subscriber, calls the contract's `get_subscription`
 *     read-only entry point to fetch current subscription state including
 *     `next_payment`, `amount`, `token`, and `interval`.
 *
 * Due / not-due classification:
 *   A subscription is "due" when `Date.now() / 1000 >= next_payment`.
 *   This mirrors the on-chain check in `execute_payment`. Small clock skew
 *   between client and ledger is acceptable — a false "due" will be caught
 *   by the contract returning error 5 (PaymentNotDue).
 *
 * Refresh semantics:
 *   The hook re-fetches when `publicKey` changes or when `refresh()` is called.
 *   Results are not cached because merchant state must be fresh before collection.
 *
 * Usage:
 *   const { subscriptions, isLoading, error, refresh } =
 *     useMerchantSubscriptions({ publicKey });
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { xdr, scValToNative, SorobanRpc, Contract, Address, nativeToScVal } from '@stellar/stellar-sdk';
import { RPC_URL, CONTRACT_ID } from '@/constants/network';
import { stroopsToTokens, formatInterval } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Subscription state fetched from both event index and on-chain state */
export interface MerchantSubscription {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address (always equals the connected publicKey) */
  merchant: string;
  /** Token contract address */
  token: string;
  /** Human-readable payment amount (e.g. "10.0000000") */
  amount: string;
  /** Raw amount in stroops as BigInt */
  amountRaw: bigint;
  /** Payment interval in seconds */
  interval: number;
  /** Human-readable interval (e.g. "30 days") */
  intervalLabel: string;
  /**
   * Unix timestamp (seconds) of when the next payment is collectable.
   * 0 means the contract entry was not found (subscription may have expired).
   */
  nextPaymentTimestamp: number;
  /** ISO-8601 string of nextPaymentTimestamp for display */
  nextPaymentDate: string;
  /** True when `now >= nextPaymentTimestamp` — safe to call execute_payment */
  isDue: boolean;
  /**
   * True when the subscription entry was not found on-chain.
   * This may happen if the TTL expired or the subscriber cancelled.
   */
  isExpired: boolean;
}

export interface UseMerchantSubscriptionsOptions {
  /** Connected merchant's public key. Pass null/undefined when disconnected. */
  publicKey: string | null | undefined;
  /** Override RPC URL (for testing) */
  rpcUrl?: string;
  /** Override contract ID (for testing) */
  contractId?: string;
}

export interface UseMerchantSubscriptionsResult {
  /** All known subscriptions for this merchant (active + expired) */
  subscriptions: MerchantSubscription[];
  /** True while phase 1 or phase 2 fetch is in progress */
  isLoading: boolean;
  /** Error message if any fetch phase failed, null otherwise */
  error: string | null;
  /** Re-fetch from scratch (no cache) */
  refresh: () => void;
}

// ── Raw on-chain subscription shape ──────────────────────────────────────────

interface RawSubscriptionData {
  token: string;
  amount: bigint;
  interval: number;
  nextPayment: number;
}

// ── Event decoding ────────────────────────────────────────────────────────────

/**
 * Decode a `subscribe` event from the RPC response.
 *
 * Event schema (from README §Events emitted):
 *   Topics: (symbol("subscribe"), subscriber, merchant, token)
 *   Data:   amount: i128
 *
 * Returns null if the event cannot be decoded.
 */
function decodeSubscribeEvent(
  rawEvent: SorobanRpc.Api.RawEventResponse,
): { subscriber: string; merchant: string; token: string } | null {
  try {
    const { topic } = rawEvent;
    if (!topic || topic.length < 4) return null;

    const [typeVal, subscriberVal, merchantVal, tokenVal] = topic.map((t) =>
      scValToNative(xdr.ScVal.fromXDR(t, 'base64')),
    );

    if (typeVal !== 'subscribe') return null;

    return {
      subscriber: String(subscriberVal),
      merchant: String(merchantVal),
      token: String(tokenVal),
    };
  } catch {
    return null;
  }
}

// ── On-chain state query ──────────────────────────────────────────────────────

/**
 * Call the contract's `get_subscription` read-only function to fetch
 * current subscription state for a given (subscriber, merchant) pair.
 *
 * Returns null when the subscription entry is not found (expired or cancelled).
 */
async function fetchSubscriptionState(
  subscriber: string,
  merchant: string,
  contractId: string,
  server: SorobanRpc.Server,
  networkPassphrase: string,
): Promise<RawSubscriptionData | null> {
  try {
    const contract = new Contract(contractId);

    // Build a read-only simulation call (no signing required)
    const { TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');

    // Use a dummy source account to build the simulation transaction.
    // The account sequence is not validated for read-only simulations.
    const sourceAccount = await server.getAccount(merchant).catch(() => null);
    if (!sourceAccount) return null;

    const tx = new TransactionBuilder(sourceAccount, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          'get_subscription',
          new Address(subscriber).toScVal(),
          new Address(merchant).toScVal(),
        ),
      )
      .setTimeout(30)
      .build();

    const simResult = await server.simulateTransaction(tx);

    if (!SorobanRpc.Api.isSimulationSuccess(simResult)) return null;

    const retVal = simResult.result?.retval;
    if (!retVal) return null;

    // get_subscription returns an Option<SubscriptionData> struct encoded as
    // a map ScVal. Decode it into a plain object.
    const native = scValToNative(retVal);
    if (!native || typeof native !== 'object') return null;

    // The Soroban SDK decodes Rust structs into JS objects with field names
    const data = native as Record<string, unknown>;

    const token = String(data.token ?? '');
    const amount = typeof data.amount === 'bigint' ? data.amount : BigInt(String(data.amount ?? '0'));
    const interval = Number(data.interval ?? 0);
    const nextPayment = Number(data.next_payment ?? 0);

    if (!token || interval === 0) return null;

    return { token, amount, interval, nextPayment };
  } catch {
    // Subscription not found or contract call failed — treat as expired
    return null;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE = 100; // Fetch up to 100 subscribe events per page

/**
 * Classify a subscription as due or not based on the current client time.
 * Adds a 5-second buffer against minor clock skew between client and ledger.
 */
function classifyDue(nextPaymentTimestamp: number): boolean {
  if (nextPaymentTimestamp === 0) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  return nowSeconds >= nextPaymentTimestamp;
}

export function useMerchantSubscriptions({
  publicKey,
  rpcUrl = RPC_URL,
  contractId = CONTRACT_ID,
}: UseMerchantSubscriptionsOptions): UseMerchantSubscriptionsResult {
  const [subscriptions, setSubscriptions] = useState<MerchantSubscription[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track the current fetch so stale fetches can be cancelled
  const fetchIdRef = useRef(0);
  // Track which publicKey we've already fetched for (avoids duplicate fetches)
  const fetchedForRef = useRef<string | null>(null);

  const fetchAll = useCallback(
    async (merchantKey: string, fetchId: number): Promise<void> => {
      if (!contractId) {
        setSubscriptions([]);
        setError('Contract ID is not configured.');
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const { NETWORK_PASSPHRASE } = await import('@/constants/network');
        const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });

        // ── Phase 1: Discover subscribers from `subscribe` events ─────────
        const discoveredSubscribers = new Map<string, string>(); // subscriber → token

        let cursor: string | undefined;
        let hasMore = true;

        while (hasMore) {
          if (fetchIdRef.current !== fetchId) return; // aborted

          const requestOpts: SorobanRpc.Server.GetEventsRequest = {
            filters: [
              {
                type: 'contract',
                contractIds: [contractId],
                topics: [
                  // topic[0] = "subscribe", topic[1] = *, topic[2] = merchant
                  ['subscribe', '*', merchantKey, '*'],
                ],
              },
            ],
            limit: PAGE_SIZE,
          };

          if (cursor) {
            (requestOpts as Record<string, unknown>).cursor = cursor;
          } else {
            requestOpts.startLedger = 1;
          }

          const response = await server.getEvents(requestOpts);

          for (const raw of response.events ?? []) {
            const decoded = decodeSubscribeEvent(raw as SorobanRpc.Api.RawEventResponse);
            if (decoded && decoded.merchant === merchantKey) {
              // Later events overwrite earlier ones — dedup by subscriber
              discoveredSubscribers.set(decoded.subscriber, decoded.token);
            }
          }

          const nextCursor = response.cursor;
          const fetched = response.events?.length ?? 0;
          hasMore = !!nextCursor && fetched >= PAGE_SIZE;
          cursor = nextCursor ?? undefined;
        }

        if (fetchIdRef.current !== fetchId) return; // aborted

        // ── Phase 2: Hydrate on-chain state for each subscriber ───────────
        const results: MerchantSubscription[] = [];

        for (const [subscriber, eventToken] of discoveredSubscribers) {
          if (fetchIdRef.current !== fetchId) return; // aborted

          const state = await fetchSubscriptionState(
            subscriber,
            merchantKey,
            contractId,
            server,
            NETWORK_PASSPHRASE,
          );

          if (state) {
            const isDue = classifyDue(state.nextPayment);
            const nextPaymentDate =
              state.nextPayment > 0
                ? new Date(state.nextPayment * 1000).toISOString()
                : new Date(0).toISOString();

            results.push({
              subscriber,
              merchant: merchantKey,
              token: state.token || eventToken,
              amount: stroopsToTokens(state.amount),
              amountRaw: state.amount,
              interval: state.interval,
              intervalLabel: formatInterval(state.interval),
              nextPaymentTimestamp: state.nextPayment,
              nextPaymentDate,
              isDue,
              isExpired: false,
            });
          } else {
            // Subscription not found on-chain — show as expired
            results.push({
              subscriber,
              merchant: merchantKey,
              token: eventToken,
              amount: '—',
              amountRaw: 0n,
              interval: 0,
              intervalLabel: '—',
              nextPaymentTimestamp: 0,
              nextPaymentDate: '—',
              isDue: false,
              isExpired: true,
            });
          }
        }

        if (fetchIdRef.current !== fetchId) return; // aborted

        // Sort: due first, then not-due, then expired
        results.sort((a, b) => {
          if (a.isExpired !== b.isExpired) return a.isExpired ? 1 : -1;
          if (a.isDue !== b.isDue) return a.isDue ? -1 : 1;
          return a.nextPaymentTimestamp - b.nextPaymentTimestamp;
        });

        setSubscriptions(results);
      } catch (err) {
        if (fetchIdRef.current !== fetchId) return; // aborted
        const msg =
          err instanceof Error ? err.message : 'Failed to load merchant subscriptions';
        setError(msg);
        setSubscriptions([]);
      } finally {
        if (fetchIdRef.current === fetchId) {
          setIsLoading(false);
        }
      }
    },
    [contractId, rpcUrl],
  );

  // Fetch when publicKey changes
  useEffect(() => {
    if (!publicKey) {
      setSubscriptions([]);
      setError(null);
      setIsLoading(false);
      fetchedForRef.current = null;
      fetchIdRef.current++;
      return;
    }

    if (fetchedForRef.current === publicKey) return;
    fetchedForRef.current = publicKey;
    const id = ++fetchIdRef.current;
    void fetchAll(publicKey, id);
  }, [publicKey, fetchAll]);

  const refresh = useCallback(() => {
    if (!publicKey) return;
    fetchedForRef.current = null;
    const id = ++fetchIdRef.current;
    void fetchAll(publicKey, id);
  }, [publicKey, fetchAll]);

  return { subscriptions, isLoading, error, refresh };
}
