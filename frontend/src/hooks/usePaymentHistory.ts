'use client';

/**
 * usePaymentHistory.ts
 *
 * Hook for fetching, decoding, and caching executed payment events from
 * the SorobanPay contract via the Soroban RPC `getEvents()` endpoint.
 *
 * Features:
 *  - Polls getEvents() filtered to `executed` events for the connected wallet
 *  - Decodes each event's topics and data using @stellar/stellar-sdk XDR helpers
 *  - Caches results in localStorage with a 60-second TTL per public key
 *  - Supports cursor-based pagination (startLedger / cursor) for > 20 events
 *  - Exposes loading, error, and empty states
 *
 * Usage:
 *   const { events, isLoading, error, hasMore, loadMore, refresh } =
 *     usePaymentHistory({ publicKey });
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { xdr, scValToNative, SorobanRpc } from '@stellar/stellar-sdk';
import { RPC_URL, CONTRACT_ID } from '@/constants/network';
import { stroopsToTokens, truncateAddress } from '@/lib/utils';

// ── Types ─────────────────────────────────────────────────────────────────────

/** A decoded `executed` payment event from the Soroban contract */
export interface PaymentEvent {
  /** Ledger sequence number the event was emitted in */
  ledger: number;
  /** ISO-8601 timestamp (from ledger close time) */
  timestamp: string;
  /** Subscriber Stellar address */
  subscriber: string;
  /** Merchant Stellar address */
  merchant: string;
  /** Token contract address */
  token: string;
  /** Human-readable amount (e.g. "10.0000000") */
  amount: string;
  /** Raw amount in stroops as string (for sorting/comparison) */
  amountStroops: string;
  /** Transaction hash for linking to Stellar Expert */
  txHash: string;
  /** Unique event ID from the RPC (used as React key) */
  id: string;
}

export interface UsePaymentHistoryOptions {
  /** Connected wallet public key. Pass null/undefined when disconnected. */
  publicKey: string | null | undefined;
  /** Number of events per page (default: 20) */
  pageSize?: number;
  /** Override RPC URL (for testing) */
  rpcUrl?: string;
  /** Override contract ID (for testing) */
  contractId?: string;
}

export interface UsePaymentHistoryResult {
  /** Decoded events for the current page accumulation */
  events: PaymentEvent[];
  /** True while the initial fetch or a loadMore fetch is in progress */
  isLoading: boolean;
  /** Error message if the last fetch failed, null otherwise */
  error: string | null;
  /** True if there are more events to load */
  hasMore: boolean;
  /** Load the next page of events */
  loadMore: () => void;
  /** Re-fetch from scratch, bypassing the cache */
  refresh: () => void;
}

// ── localStorage cache helpers ────────────────────────────────────────────────

const CACHE_TTL_MS = 60_000; // 60 seconds
const CACHE_KEY_PREFIX = 'sorobanpay_payment_history_';

interface CacheEntry {
  events: PaymentEvent[];
  cursor: string | null;
  hasMore: boolean;
  timestamp: number;
}

function cacheKey(publicKey: string): string {
  return `${CACHE_KEY_PREFIX}${publicKey}`;
}

function readCache(publicKey: string): CacheEntry | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(cacheKey(publicKey));
    if (!raw) return null;
    const entry = JSON.parse(raw) as CacheEntry;
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
      localStorage.removeItem(cacheKey(publicKey));
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function writeCache(publicKey: string, entry: CacheEntry): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(cacheKey(publicKey), JSON.stringify(entry));
  } catch {
    // Silently fail if localStorage is full
  }
}

function clearCache(publicKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(cacheKey(publicKey));
  } catch {
    // Silently ignore
  }
}

// ── Event decoding ────────────────────────────────────────────────────────────

/**
 * Decode a single Soroban `executed` event from the RPC response.
 *
 * Event schema (from README §Events emitted):
 *   Topics: (symbol("executed"), subscriber, merchant, token)
 *   Data:   amount: i128
 *
 * Returns null if the event cannot be decoded (wrong format, missing fields).
 */
function decodeExecutedEvent(
  rawEvent: SorobanRpc.Api.RawEventResponse,
): PaymentEvent | null {
  try {
    const { topic, value, ledger, ledgerClosedAt, id, txHash } = rawEvent;

    if (!topic || topic.length < 4) return null;

    // Decode topics: [symbol, subscriber, merchant, token]
    const [typeVal, subscriberVal, merchantVal, tokenVal] = topic.map((t) =>
      scValToNative(xdr.ScVal.fromXDR(t, 'base64')),
    );

    if (typeVal !== 'executed') return null;

    // Decode data: amount as i128 → BigInt
    const amountRaw = scValToNative(xdr.ScVal.fromXDR(value, 'base64'));
    const amountBigInt =
      typeof amountRaw === 'bigint' ? amountRaw : BigInt(String(amountRaw));

    const subscriber = String(subscriberVal);
    const merchant = String(merchantVal);
    const token = String(tokenVal);

    // ledgerClosedAt is an ISO-8601 string from the RPC
    const timestamp = ledgerClosedAt ?? new Date(0).toISOString();

    return {
      ledger,
      timestamp,
      subscriber,
      merchant,
      token,
      amount: stroopsToTokens(amountBigInt),
      amountStroops: amountBigInt.toString(),
      txHash: txHash ?? '',
      id,
    };
  } catch {
    // Malformed event — skip silently
    return null;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

const PAGE_SIZE_DEFAULT = 20;

export function usePaymentHistory({
  publicKey,
  pageSize = PAGE_SIZE_DEFAULT,
  rpcUrl = RPC_URL,
  contractId = CONTRACT_ID,
}: UsePaymentHistoryOptions): UsePaymentHistoryResult {
  const [events, setEvents] = useState<PaymentEvent[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  // cursor is the RPC pagination cursor for the next page
  const cursorRef = useRef<string | null>(null);
  // Whether we have done the initial fetch for the current publicKey
  const initializedRef = useRef<string | null>(null);

  /**
   * Fetch one page of executed events from the Soroban RPC.
   *
   * @param cursor   RPC pagination cursor, null for the first page
   * @param append   True when loading more (append to existing events)
   * @param skipCache  True when the user explicitly refreshes
   */
  const fetchPage = useCallback(
    async (
      cursor: string | null,
      append: boolean,
      skipCache: boolean,
    ): Promise<void> => {
      if (!publicKey || !contractId) {
        setEvents([]);
        setHasMore(false);
        return;
      }

      // Check cache on initial load (not append, not refresh)
      if (!append && !skipCache) {
        const cached = readCache(publicKey);
        if (cached) {
          setEvents(cached.events);
          cursorRef.current = cached.cursor;
          setHasMore(cached.hasMore);
          return;
        }
      }

      setIsLoading(true);
      setError(null);

      try {
        const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });

        // Build the getEvents filter:
        //   topic[0] = symbol("executed")  — event type
        //   topic[1] = subscriber address  — public key filter
        // startLedger must be > 0; use 1 if no cursor (beginning of time)
        const requestOpts: SorobanRpc.Server.GetEventsRequest = {
          filters: [
            {
              type: 'contract',
              contractIds: [contractId],
              topics: [
                // First topic must be the "executed" symbol
                // Second topic must match the subscriber's address
                // We use wildcards ('*') for merchant and token
                ['executed', publicKey, '*', '*'],
              ],
            },
          ],
          limit: pageSize,
        };

        if (cursor) {
          (requestOpts as Record<string, unknown>).cursor = cursor;
        } else {
          // Start from ledger 1 for the very first fetch
          requestOpts.startLedger = 1;
        }

        const response = await server.getEvents(requestOpts);

        const decoded: PaymentEvent[] = [];
        for (const raw of response.events ?? []) {
          const event = decodeExecutedEvent(raw as SorobanRpc.Api.RawEventResponse);
          if (event) decoded.push(event);
        }

        const nextCursor = response.cursor ?? null;
        const moreAvailable =
          !!nextCursor && (response.events?.length ?? 0) >= pageSize;

        let nextEvents: PaymentEvent[];
        if (append) {
          nextEvents = [...events, ...decoded];
        } else {
          nextEvents = decoded;
        }

        cursorRef.current = moreAvailable ? nextCursor : null;
        setEvents(nextEvents);
        setHasMore(moreAvailable);

        // Only cache the first page (non-append)
        if (!append) {
          writeCache(publicKey, {
            events: nextEvents,
            cursor: cursorRef.current,
            hasMore: moreAvailable,
            timestamp: Date.now(),
          });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to load payment history';
        setError(msg);
        setHasMore(false);
      } finally {
        setIsLoading(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [publicKey, contractId, rpcUrl, pageSize],
  );

  // Initial fetch when publicKey changes
  useEffect(() => {
    if (!publicKey) {
      setEvents([]);
      setError(null);
      setHasMore(false);
      cursorRef.current = null;
      initializedRef.current = null;
      return;
    }

    if (initializedRef.current === publicKey) return;
    initializedRef.current = publicKey;
    cursorRef.current = null;

    void fetchPage(null, false, false);
  }, [publicKey, fetchPage]);

  const loadMore = useCallback(() => {
    if (!isLoading && hasMore && cursorRef.current) {
      void fetchPage(cursorRef.current, true, false);
    }
  }, [isLoading, hasMore, fetchPage]);

  const refresh = useCallback(() => {
    if (!publicKey) return;
    clearCache(publicKey);
    cursorRef.current = null;
    initializedRef.current = null;
    void fetchPage(null, false, true);
  }, [publicKey, fetchPage]);

  return { events, isLoading, error, hasMore, loadMore, refresh };
}

// Re-export for convenience
export type { PaymentEvent as DecodedPaymentEvent };
export { truncateAddress };
