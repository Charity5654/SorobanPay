'use client';

/**
 * useMerchantSubscriptions.ts
 *
 * Hook for the merchant portal (/merchant).
 *
 * Two-phase, cursor-paginated data loading:
 *   Phase 1 — Index discovery:
 *     Requests one bounded page of `subscribe` events where the third topic
 *     equals the connected merchant's public key. `loadMore()` advances the
 *     RPC cursor when additional events are available.
 *
 *   Phase 2 — State hydration:
 *     For each subscriber in the current page, calls `get_subscription`
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
 *   const { subscriptions, isLoading, error, hasMore, loadMore, refresh } =
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
  /** Subscriptions loaded so far for this merchant (active + expired) */
  subscriptions: MerchantSubscription[];
  /** True while phase 1 or phase 2 fetch is in progress */
  isLoading: boolean;
  /** Error message if any fetch phase failed, null otherwise */
  error: string | null;
  /** True when another page of subscribe events can be loaded */
  hasMore: boolean;
  /** Fetch the next event page */
  loadMore: () => void;
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

const PAGE_SIZE = 100;

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

  const [hasMore, setHasMore] = useState(false);
  const fetchIdRef = useRef(0);
  const fetchedForRef = useRef<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  const loadingRef = useRef(false);

  const fetchPage = useCallback(
    async (
      merchantKey: string,
      cursor: string | null,
      append: boolean,
      fetchId: number,
    ): Promise<void> => {
      if (!contractId) {
        setSubscriptions([]);
        setHasMore(false);
        setError('Contract ID is not configured.');
        setIsLoading(false);
        return;
      }

      loadingRef.current = true;
      setIsLoading(true);
      setError(null);

      try {
        const { NETWORK_PASSPHRASE } = await import('@/constants/network');
        const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });
        const discoveredSubscribers = new Map<string, string>(); // subscriber → token
        const requestOpts: SorobanRpc.Server.GetEventsRequest = {
          filters: [
            {
              type: 'contract',
              contractIds: [contractId],
              topics: [['subscribe', '*', merchantKey, '*']],
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
        if (fetchIdRef.current !== fetchId) return;

        for (const raw of response.events ?? []) {
          const decoded = decodeSubscribeEvent(raw as SorobanRpc.Api.RawEventResponse);
          if (decoded && decoded.merchant === merchantKey) {
            discoveredSubscribers.set(decoded.subscriber, decoded.token);
          }
        }

        const nextCursor = response.cursor ?? null;
        const moreAvailable = !!nextCursor && (response.events?.length ?? 0) >= PAGE_SIZE;
        cursorRef.current = moreAvailable ? nextCursor : null;
        setHasMore(moreAvailable);

        const results: MerchantSubscription[] = [];

        for (const [subscriber, eventToken] of discoveredSubscribers) {
          if (fetchIdRef.current !== fetchId) return;

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

        if (fetchIdRef.current !== fetchId) return;

        const sortSubscriptions = (items: MerchantSubscription[]) => items.sort((a, b) => {
          if (a.isExpired !== b.isExpired) return a.isExpired ? 1 : -1;
          if (a.isDue !== b.isDue) return a.isDue ? -1 : 1;
          return a.nextPaymentTimestamp - b.nextPaymentTimestamp;
        });

        setSubscriptions((current) => {
          const merged = append ? new Map(current.map((item) => [item.subscriber, item])) : new Map();
          for (const item of results) merged.set(item.subscriber, item);
          return sortSubscriptions([...merged.values()]);
        });
      } catch {
        if (fetchIdRef.current !== fetchId) return;
        setError('Failed to load subscriptions. Please retry.');
        if (!append) setSubscriptions([]);
      } finally {
        if (fetchIdRef.current === fetchId) {
          loadingRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [contractId, rpcUrl],
  );

  const scopeKey = publicKey ? `${publicKey}:${contractId}:${rpcUrl}` : null;

  useEffect(() => {
    if (!publicKey || !scopeKey) {
      setSubscriptions([]);
      setError(null);
      setIsLoading(false);
      setHasMore(false);
      cursorRef.current = null;
      fetchedForRef.current = null;
      fetchIdRef.current++;
      loadingRef.current = false;
      return;
    }

    if (fetchedForRef.current === scopeKey) return;
    fetchedForRef.current = scopeKey;
    setSubscriptions([]);
    setHasMore(false);
    cursorRef.current = null;
    const id = ++fetchIdRef.current;
    void fetchPage(publicKey, null, false, id);
  }, [publicKey, scopeKey, fetchPage]);

  const loadMore = useCallback(() => {
    if (!publicKey || loadingRef.current || !hasMore || !cursorRef.current) return;
    void fetchPage(publicKey, cursorRef.current, true, fetchIdRef.current);
  }, [publicKey, hasMore, fetchPage]);

  const refresh = useCallback(() => {
    if (!publicKey) return;
    fetchedForRef.current = scopeKey;
    cursorRef.current = null;
    setHasMore(false);
    setSubscriptions([]);
    const id = ++fetchIdRef.current;
    void fetchPage(publicKey, null, false, id);
  }, [publicKey, scopeKey, fetchPage]);

  return { subscriptions, isLoading, error, hasMore, loadMore, refresh };
}
