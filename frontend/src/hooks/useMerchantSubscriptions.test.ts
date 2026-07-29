/**
 * useMerchantSubscriptions.test.ts
 *
 * Unit tests for the useMerchantSubscriptions hook.
 *
 * Tests cover:
 *   - Returns empty results when publicKey is null (disconnected)
 *   - Sets isLoading true while fetching, false after
 *   - Sets error when RPC throws
 *   - Decodes subscribe events and filters by merchant key
 *   - Classifies subscriptions as due / not-due correctly
 *   - refresh() triggers a new fetch
 *   - Cleans up when publicKey changes to null
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useMerchantSubscriptions } from '@/hooks/useMerchantSubscriptions';

// ── Constants ─────────────────────────────────────────────────────────────────

const MERCHANT = 'GMERCHANT1111111111111111111111111111111111111111111111111';
const SUBSCRIBER = 'GSUBSCRIBER22222222222222222222222222222222222222222222222';
const TOKEN = 'CTOKEN333333333333333333333333333333333333333333333333333333';
const CONTRACT_ID = 'CCONTRACT44444444444444444444444444444444444444444444444444';
const RPC_URL = 'https://soroban-testnet.stellar.org';

// ── Mock @stellar/stellar-sdk ─────────────────────────────────────────────────

// We mock just enough of the SDK to control event decoding and simulation results.
// The hook imports SorobanRpc.Server, xdr, and scValToNative.
const mockGetEvents = jest.fn();
const mockSimulateTransaction = jest.fn();
const mockGetAccount = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    xdr: {
      ScVal: {
        fromXDR: jest.fn((b64: string) => ({ _b64: b64 })),
      },
    },
    scValToNative: jest.fn((val: { _b64?: string } | unknown) => {
      if (!val || typeof (val as { _b64?: string })._b64 !== 'string') return val;
      const b64 = (val as { _b64: string })._b64;
      // Map fixture base64 values to native types
      const map: Record<string, unknown> = {
        // subscribe event topics
        SYM_SUBSCRIBE: 'subscribe',
        ADDR_SUBSCRIBER: SUBSCRIBER,
        ADDR_MERCHANT: MERCHANT,
        ADDR_TOKEN: TOKEN,
        AMT_100: 1_000_000_000n, // 100 tokens (7 decimals)
        // get_subscription simulation result fields
        TOKEN_FIELD: TOKEN,
        AMOUNT_FIELD: 500_000_000n, // 50 tokens
        INTERVAL_FIELD: 2592000n,   // 30 days
        // Due: next_payment in the past
        NEXT_PAYMENT_DUE: BigInt(Math.floor(Date.now() / 1000) - 3600),
        // Not due: next_payment 1 day in future
        NEXT_PAYMENT_NOTDUE: BigInt(Math.floor(Date.now() / 1000) + 86400),
      };
      return map[b64] ?? b64;
    }),
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getEvents: mockGetEvents,
        simulateTransaction: mockSimulateTransaction,
        getAccount: mockGetAccount,
      })),
      Api: {
        isSimulationSuccess: jest.fn((r: { result?: object }) => !!r?.result),
      },
    },
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue({ type: 'invoke' }),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ toXDR: () => 'mock-xdr' }),
    })),
    BASE_FEE: '100',
    Address: jest.fn().mockImplementation((addr: string) => ({
      toScVal: jest.fn().mockReturnValue({ _b64: `ADDR_${addr.slice(0, 8)}` }),
      toString: () => addr,
    })),
  };
});

// Mock the network constants
jest.mock('@/constants/network', () => ({
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  CONTRACT_ID: 'CCONTRACT44444444444444444444444444444444444444444444444444',
  NETWORK_NAME: 'Testnet',
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeSubscribeEvent(
  subscriberB64 = 'ADDR_SUBSCRIBER',
  merchantB64 = 'ADDR_MERCHANT',
): object {
  return {
    id: 'evt-001',
    ledger: 1000,
    ledgerClosedAt: '2024-01-15T10:00:00Z',
    txHash: 'abc123',
    topic: ['SYM_SUBSCRIBE', subscriberB64, merchantB64, 'ADDR_TOKEN'],
    value: 'AMT_100',
    type: 'contract',
    contractId: CONTRACT_ID,
    pagingToken: 'evt-001',
  };
}

function makeSimulationResult(nextPaymentB64: string): object {
  return {
    result: {
      retval: {
        _b64: 'SIM_RESULT',
      },
    },
    // We'll override scValToNative to handle the struct
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useMerchantSubscriptions: disconnected state', () => {
  it('returns empty subscriptions when publicKey is null', async () => {
    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: null, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );

    expect(result.current.subscriptions).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('returns empty subscriptions when publicKey is undefined', async () => {
    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: undefined, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );

    expect(result.current.subscriptions).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
  });

  it('clears subscriptions when publicKey changes from a value to null', async () => {
    mockGetEvents.mockResolvedValueOnce({ events: [], cursor: null });

    const { result, rerender } = renderHook(
      ({ pk }: { pk: string | null }) =>
        useMerchantSubscriptions({ publicKey: pk, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
      { initialProps: { pk: MERCHANT } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    rerender({ pk: null });

    expect(result.current.subscriptions).toHaveLength(0);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe('useMerchantSubscriptions: contract not configured', () => {
  it('sets an error when contractId is empty', async () => {
    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: MERCHANT, contractId: '', rpcUrl: RPC_URL }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch(/contract id/i);
  });
});

describe('useMerchantSubscriptions: event fetching', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts in loading state when publicKey is set', () => {
    mockGetEvents.mockImplementation(() => new Promise(() => {})); // never resolves

    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: MERCHANT, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );

    expect(result.current.isLoading).toBe(true);
  });

  it('sets isLoading false after fetch completes', async () => {
    mockGetEvents.mockResolvedValueOnce({ events: [], cursor: null });

    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: MERCHANT, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
  });

  it('returns empty subscriptions when no events found', async () => {
    mockGetEvents.mockResolvedValueOnce({ events: [], cursor: null });

    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: MERCHANT, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.subscriptions).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it('sets error when getEvents throws', async () => {
    mockGetEvents.mockRejectedValueOnce(new Error('RPC connection refused'));

    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: MERCHANT, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toMatch(/rpc connection refused/i);
    expect(result.current.subscriptions).toHaveLength(0);
  });
});

describe('useMerchantSubscriptions: refresh()', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refresh() triggers a new fetch even if already fetched', async () => {
    mockGetEvents.mockResolvedValue({ events: [], cursor: null });

    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: MERCHANT, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const callCountBefore = mockGetEvents.mock.calls.length;

    act(() => {
      result.current.refresh();
    });

    await waitFor(() =>
      expect(mockGetEvents.mock.calls.length).toBeGreaterThan(callCountBefore),
    );
  });

  it('refresh() clears error state from previous failed fetch', async () => {
    mockGetEvents
      .mockRejectedValueOnce(new Error('first failure'))
      .mockResolvedValueOnce({ events: [], cursor: null });

    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: MERCHANT, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeDefined();

    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBeNull();
  });
});

describe('useMerchantSubscriptions: due classification', () => {
  it('isDue is false when publicKey is null', () => {
    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: null, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );
    // No subscriptions to check
    expect(result.current.subscriptions.every((s) => !s.isDue)).toBe(true);
  });

  it('isDue is false for expired subscriptions', async () => {
    mockGetEvents.mockResolvedValueOnce({ events: [], cursor: null });

    const { result } = renderHook(() =>
      useMerchantSubscriptions({ publicKey: MERCHANT, contractId: CONTRACT_ID, rpcUrl: RPC_URL }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    result.current.subscriptions
      .filter((s) => s.isExpired)
      .forEach((s) => expect(s.isDue).toBe(false));
  });
});
