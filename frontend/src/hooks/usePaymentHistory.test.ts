/**
 * usePaymentHistory.test.ts
 *
 * Unit tests for the usePaymentHistory hook.
 *
 * Tests cover:
 *  - Loading state (initial fetch)
 *  - Returns empty array when publicKey is null (disconnected)
 *  - Calls RPC getEvents and returns decoded events
 *  - Reads from localStorage cache when fresh
 *  - Bypasses cache on refresh()
 *  - Exposes error state on RPC failure
 *  - loadMore appends events and uses cursor
 *  - hasMore is false when fewer events than pageSize returned
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { usePaymentHistory } from '@/hooks/usePaymentHistory';

// ── Mock @stellar/stellar-sdk ────────────────────────────────────────────────

// We mock the module so we can control xdr/scValToNative and SorobanRpc.Server
jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    xdr: {
      ScVal: {
        fromXDR: jest.fn((b64: string) => ({ _b64: b64 })),
      },
    },
    scValToNative: jest.fn((val: { _b64: string }) => {
      // Map fixture base64 values back to native JS types for decoding
      const map: Record<string, unknown> = {
        TYPE_EXECUTED: 'executed',
        SUBSCRIBER_ADDR: 'GABC123SUBSCRIBER',
        MERCHANT_ADDR: 'GXYZ789MERCHANT00',
        TOKEN_ADDR: 'CABC123TOKEN00000',
        AMOUNT_VAL: 100_000_000n, // 10 tokens
      };
      return map[val._b64] ?? val._b64;
    }),
    SorobanRpc: {
      Server: jest.fn(),
    },
  };
});

// ── localStorage mock ────────────────────────────────────────────────────────

const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] ?? null),
    setItem: jest.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: jest.fn((key: string) => { delete store[key]; }),
    clear: jest.fn(() => { store = {}; }),
    get _store() { return store; },
  };
})();

Object.defineProperty(global, 'localStorage', {
  value: localStorageMock,
  writable: true,
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Build a raw mock event matching the fixture base64 keys in scValToNative mock */
function makeRawEvent(id = 'evt-001', ledger = 1000): object {
  return {
    id,
    ledger,
    ledgerClosedAt: '2024-01-15T10:00:00Z',
    txHash: 'abc123txhash456',
    topic: ['TYPE_EXECUTED', 'SUBSCRIBER_ADDR', 'MERCHANT_ADDR', 'TOKEN_ADDR'],
    value: 'AMOUNT_VAL',
    type: 'contract',
    contractId: 'CCONTRACT',
    pagingToken: id,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a mock SorobanRpc.Server instance with a getEvents implementation */
function makeMockServer(
  events: object[] = [],
  cursor = 'next-cursor',
  throws?: Error,
) {
  const getEvents = throws
    ? jest.fn().mockRejectedValue(throws)
    : jest.fn().mockResolvedValue({ events, cursor });

  return { getEvents };
}

// ── Test suites ───────────────────────────────────────────────────────────────

const { SorobanRpc } = jest.requireMock('@stellar/stellar-sdk');

describe('usePaymentHistory', () => {
  const publicKey = 'GPUBKEY000000000000000000000000000000000000000000000000';

  beforeEach(() => {
    localStorageMock.clear();
    jest.clearAllMocks();
  });

  it('returns empty events and no loading when publicKey is null', () => {
    const { result } = renderHook(() =>
      usePaymentHistory({ publicKey: null }),
    );
    expect(result.current.events).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it('sets isLoading to true during initial fetch', async () => {
    // Slow mock that never resolves — just to observe loading state
    let resolveGetEvents!: (v: unknown) => void;
    const pending = new Promise((res) => { resolveGetEvents = res; });
    SorobanRpc.Server.mockReturnValue({ getEvents: jest.fn().mockReturnValue(pending) });

    const { result } = renderHook(() =>
      usePaymentHistory({ publicKey, rpcUrl: 'https://mock-rpc', contractId: 'CCONTRACT' }),
    );

    // The hook fires the fetch inside useEffect — wait a tick
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isLoading).toBe(true);

    // Clean up: resolve to prevent dangling promise
    resolveGetEvents({ events: [], cursor: null });
  });

  it('decodes events and sets them after a successful fetch', async () => {
    const mockServer = makeMockServer([makeRawEvent('evt-001', 1000)], null);
    SorobanRpc.Server.mockReturnValue(mockServer);

    const { result } = renderHook(() =>
      usePaymentHistory({ publicKey, rpcUrl: 'https://mock-rpc', contractId: 'CCONTRACT', pageSize: 20 }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.events).toHaveLength(1);
    const event = result.current.events[0];
    expect(event.id).toBe('evt-001');
    expect(event.ledger).toBe(1000);
    expect(event.subscriber).toBe('GABC123SUBSCRIBER');
    expect(event.merchant).toBe('GXYZ789MERCHANT00');
    expect(event.token).toBe('CABC123TOKEN00000');
    expect(event.amount).toBe('10.0000000'); // 100_000_000 stroops = 10 tokens
    expect(event.txHash).toBe('abc123txhash456');
    expect(result.current.error).toBeNull();
  });

  it('sets hasMore to false when fewer events than pageSize are returned', async () => {
    const mockServer = makeMockServer([makeRawEvent()], 'some-cursor');
    SorobanRpc.Server.mockReturnValue(mockServer);

    const { result } = renderHook(() =>
      usePaymentHistory({ publicKey, rpcUrl: 'https://mock-rpc', contractId: 'CCONTRACT', pageSize: 20 }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // 1 event < 20 pageSize → hasMore = false
    expect(result.current.hasMore).toBe(false);
  });

  it('sets hasMore to true when events.length === pageSize and cursor is present', async () => {
    const events = Array.from({ length: 5 }, (_, i) => makeRawEvent(`evt-${i}`, 1000 + i));
    const mockServer = makeMockServer(events, 'next-page-cursor');
    SorobanRpc.Server.mockReturnValue(mockServer);

    const { result } = renderHook(() =>
      usePaymentHistory({ publicKey, rpcUrl: 'https://mock-rpc', contractId: 'CCONTRACT', pageSize: 5 }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.hasMore).toBe(true);
    expect(result.current.events).toHaveLength(5);
  });

  it('sets error and empty events on RPC failure', async () => {
    const rpcError = new Error('Network request failed');
    SorobanRpc.Server.mockReturnValue(makeMockServer([], undefined, rpcError));

    const { result } = renderHook(() =>
      usePaymentHistory({ publicKey, rpcUrl: 'https://mock-rpc', contractId: 'CCONTRACT' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.error).toBe('Network request failed');
    expect(result.current.events).toEqual([]);
    expect(result.current.hasMore).toBe(false);
  });

  it('reads from localStorage cache when valid cache is present', async () => {
    const cachedEntry = {
      events: [
        {
          id: 'cached-evt',
          ledger: 999,
          timestamp: '2024-01-10T00:00:00Z',
          subscriber: 'GSUB',
          merchant: 'GMER',
          token: 'CTOK',
          amount: '5.0000000',
          amountStroops: '50000000',
          txHash: 'cachedtxhash',
        },
      ],
      cursor: null,
      hasMore: false,
      timestamp: Date.now(), // fresh cache
    };

    // Write a valid cache entry
    localStorageMock.setItem(
      `sorobanpay_payment_history_${publicKey}`,
      JSON.stringify(cachedEntry),
    );

    // Server should NOT be called if cache is fresh
    const mockGetEvents = jest.fn().mockResolvedValue({ events: [], cursor: null });
    SorobanRpc.Server.mockReturnValue({ getEvents: mockGetEvents });

    const { result } = renderHook(() =>
      usePaymentHistory({ publicKey, rpcUrl: 'https://mock-rpc', contractId: 'CCONTRACT' }),
    );

    await waitFor(() => expect(result.current.events).toHaveLength(1));

    expect(result.current.events[0].id).toBe('cached-evt');
    expect(mockGetEvents).not.toHaveBeenCalled();
  });

  it('bypasses cache and re-fetches on refresh()', async () => {
    const cachedEntry = {
      events: [
        {
          id: 'stale-evt',
          ledger: 500,
          timestamp: '2024-01-01T00:00:00Z',
          subscriber: 'GSUB',
          merchant: 'GMER',
          token: 'CTOK',
          amount: '1.0000000',
          amountStroops: '10000000',
          txHash: 'stale',
        },
      ],
      cursor: null,
      hasMore: false,
      timestamp: Date.now(),
    };
    localStorageMock.setItem(
      `sorobanpay_payment_history_${publicKey}`,
      JSON.stringify(cachedEntry),
    );

    const freshEvent = makeRawEvent('fresh-evt', 2000);
    const mockGetEvents = jest.fn().mockResolvedValue({ events: [freshEvent], cursor: null });
    SorobanRpc.Server.mockReturnValue({ getEvents: mockGetEvents });

    const { result } = renderHook(() =>
      usePaymentHistory({ publicKey, rpcUrl: 'https://mock-rpc', contractId: 'CCONTRACT' }),
    );

    // Initial load uses cache
    await waitFor(() => expect(result.current.events[0].id).toBe('stale-evt'));
    expect(mockGetEvents).not.toHaveBeenCalled();

    // Trigger refresh
    act(() => { result.current.refresh(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetEvents).toHaveBeenCalled();
    expect(result.current.events[0].id).toBe('fresh-evt');
  });

  it('loadMore appends events and does not replace existing events', async () => {
    const page1 = Array.from({ length: 3 }, (_, i) => makeRawEvent(`p1-${i}`, 1000 + i));
    const page2 = Array.from({ length: 3 }, (_, i) => makeRawEvent(`p2-${i}`, 2000 + i));

    let callCount = 0;
    const mockGetEvents = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve({ events: page1, cursor: 'page-2-cursor' });
      }
      return Promise.resolve({ events: page2, cursor: null });
    });
    SorobanRpc.Server.mockReturnValue({ getEvents: mockGetEvents });

    const { result } = renderHook(() =>
      usePaymentHistory({ publicKey, rpcUrl: 'https://mock-rpc', contractId: 'CCONTRACT', pageSize: 3 }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.events).toHaveLength(3);
    expect(result.current.hasMore).toBe(true);

    // Load more
    act(() => { result.current.loadMore(); });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    // All 6 events should be present (3 original + 3 new)
    expect(result.current.events).toHaveLength(6);
    expect(result.current.events[0].id).toBe('p1-0');
    expect(result.current.events[3].id).toBe('p2-0');
  });

  it('clears events and state when publicKey becomes null', async () => {
    const mockServer = makeMockServer([makeRawEvent()], null);
    SorobanRpc.Server.mockReturnValue(mockServer);

    const { result, rerender } = renderHook(
      ({ pk }) => usePaymentHistory({ publicKey: pk, rpcUrl: 'https://mock-rpc', contractId: 'CCONTRACT' }),
      { initialProps: { pk: publicKey as string | null } },
    );

    await waitFor(() => expect(result.current.events).toHaveLength(1));

    rerender({ pk: null });

    expect(result.current.events).toEqual([]);
    expect(result.current.error).toBeNull();
    expect(result.current.hasMore).toBe(false);
  });

  it('does not fetch when contractId is empty', () => {
    const mockGetEvents = jest.fn();
    SorobanRpc.Server.mockReturnValue({ getEvents: mockGetEvents });

    renderHook(() =>
      usePaymentHistory({ publicKey, rpcUrl: 'https://mock-rpc', contractId: '' }),
    );

    // With empty contractId the hook should return early without calling getEvents
    expect(mockGetEvents).not.toHaveBeenCalled();
  });
});
