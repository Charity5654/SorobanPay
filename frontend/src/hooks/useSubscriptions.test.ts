import { act, renderHook, waitFor } from '@testing-library/react';
import { useSubscriptions } from '@/hooks/useSubscriptions';

const PUBLIC_KEY = `G${'A'.repeat(55)}`;
const MERCHANT = `G${'B'.repeat(55)}`;
const TOKEN = `C${'C'.repeat(55)}`;
const mockGetLatestLedger = jest.fn();
const mockGetEvents = jest.fn();
const mockGetAccount = jest.fn();
const mockSimulateTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    Address: jest.fn().mockImplementation((address: string) => ({
      toScVal: () => ({ toXDR: () => address }),
    })),
    Contract: jest.fn().mockImplementation(() => ({ call: jest.fn(() => ({})) })),
    scValToNative: jest.fn((value: { native?: unknown }) => value?.native ?? value),
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        getLatestLedger: mockGetLatestLedger,
        getEvents: mockGetEvents,
        getAccount: mockGetAccount,
        simulateTransaction: mockSimulateTransaction,
      })),
      Api: {
        ...actual.SorobanRpc.Api,
        isSimulationSuccess: jest.fn((result: { result?: unknown }) => !!result?.result),
      },
    },
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn(() => ({})),
    })),
    xdr: {
      ...actual.xdr,
      ScVal: {
        scvSymbol: jest.fn((symbol: string) => ({ toXDR: () => symbol })),
      },
    },
  };
});

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: `C${'D'.repeat(55)}`,
  NETWORK_PASSPHRASE: 'Test Network',
  RPC_URL: 'https://rpc.example.test',
}));

function makeSubscriptionEvent() {
  return {
    topic: ['subscribe', PUBLIC_KEY, MERCHANT, TOKEN],
    ledger: 10,
  };
}

describe('useSubscriptions bounded RPC retries', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetLatestLedger.mockResolvedValue({ sequence: 10 });
    mockGetEvents.mockImplementation((request: { filters: Array<{ topics: string[][] }> }) =>
      Promise.resolve(
        request.filters[0].topics[0][0] === 'subscribe'
          ? { events: [makeSubscriptionEvent()] }
          : { events: [] },
      ),
    );
    mockGetAccount.mockResolvedValue({ sequence: '1' });
    mockSimulateTransaction.mockResolvedValue({
      result: {
        retval: {
          native: {
            amount: 10_000_000n,
            interval: 86_400n,
            next_payment: 2_000_000_000n,
          },
        },
      },
    });
  });

  it('retries a transient read and returns the successful subscription data', async () => {
    mockGetLatestLedger
      .mockRejectedValueOnce(new Error('temporary network failure'))
      .mockResolvedValueOnce({ sequence: 10 });

    const { result } = renderHook(() => useSubscriptions(PUBLIC_KEY));

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(mockGetLatestLedger).toHaveBeenCalledTimes(2);
    expect(result.current.error).toBeNull();
    expect(result.current.subscriptions).toHaveLength(1);
    expect(result.current.subscriptions[0].merchant).toBe(MERCHANT);
  });

  it('retains the last successful data and hides RPC details after retries fail', async () => {
    const { result } = renderHook(() => useSubscriptions(PUBLIC_KEY));
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const previousSubscriptions = result.current.subscriptions;

    mockGetLatestLedger.mockRejectedValue(new Error('secret endpoint response'));
    act(() => result.current.refetch());
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.subscriptions).toEqual(previousSubscriptions);
    expect(result.current.error).toMatch(/several attempts/i);
    expect(result.current.error).not.toContain('secret endpoint response');
    expect(mockGetLatestLedger).toHaveBeenCalledTimes(4);
  });

  it('reports loading while a read is pending', async () => {
    let resolveRead!: (value: { sequence: number }) => void;
    mockGetLatestLedger.mockImplementationOnce(
      () => new Promise((resolve) => { resolveRead = resolve; }),
    );

    const { result, unmount } = renderHook(() => useSubscriptions(PUBLIC_KEY));
    expect(result.current.isLoading).toBe(true);
    unmount();
    resolveRead({ sequence: 10 });
  });

  it('does not retry or expose data when the wallet changes during a read', async () => {
    let rejectRead!: (error: Error) => void;
    mockGetLatestLedger.mockImplementationOnce(
      () => new Promise((_resolve, reject) => { rejectRead = reject; }),
    );

    const { result, rerender } = renderHook(
      ({ publicKey }: { publicKey: string | null }) => useSubscriptions(publicKey),
      { initialProps: { publicKey: PUBLIC_KEY } },
    );

    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      rerender({ publicKey: null });
      rejectRead(new Error('request cancelled'));
    });

    expect(result.current.isLoading).toBe(false);
    expect(result.current.subscriptions).toEqual([]);
    expect(mockGetLatestLedger).toHaveBeenCalledTimes(1);
  });
});
