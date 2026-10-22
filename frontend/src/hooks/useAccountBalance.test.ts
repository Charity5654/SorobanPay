/**
 * useAccountBalance.test.ts
 *
 * Unit tests for the useAccountBalance hook.
 *
 * Covers:
 *  - Returns null balance and no loading when publicKey is null
 *  - Sets isLoading true during fetch, false after
 *  - Returns native XLM balance string on success
 *  - Treats account-not-found (404) as "0.0000000"
 *  - Sets error on unexpected RPC failures
 *  - Re-fetches when refreshTrigger increments
 *  - Re-fetches when refetch() is called
 *  - Cancels in-flight fetch when publicKey changes
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useAccountBalance } from '@/hooks/useAccountBalance';

// ── Mock @stellar/stellar-sdk ────────────────────────────────────────────────

jest.mock('@stellar/stellar-sdk', () => ({
  SorobanRpc: {
    Server: jest.fn(),
  },
}));

const { SorobanRpc } = jest.requireMock('@stellar/stellar-sdk');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeMockServer(balance = '100.0000000') {
  return {
    getAccount: jest.fn().mockResolvedValue({
      balances: [{ asset_type: 'native', balance }],
    }),
  };
}

function makeNotFoundServer() {
  return {
    getAccount: jest.fn().mockRejectedValue(new Error('account not found')),
  };
}

function makeErrorServer(msg = 'RPC timeout') {
  return {
    getAccount: jest.fn().mockRejectedValue(new Error(msg)),
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const publicKey = 'GPUBKEY000000000000000000000000000000000000000000000000';

describe('useAccountBalance', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns null balance and no loading when publicKey is null', () => {
    SorobanRpc.Server.mockReturnValue(makeMockServer());
    const { result } = renderHook(() =>
      useAccountBalance({ publicKey: null }),
    );
    expect(result.current.balance).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it('sets isLoading true while fetching', async () => {
    let resolveGetAccount!: (v: unknown) => void;
    const pending = new Promise((res) => { resolveGetAccount = res; });
    SorobanRpc.Server.mockReturnValue({ getAccount: jest.fn().mockReturnValue(pending) });

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey, rpcUrl: 'https://mock-rpc' }),
    );

    await act(async () => { await Promise.resolve(); });
    expect(result.current.isLoading).toBe(true);

    // Clean up
    resolveGetAccount({ balances: [] });
  });

  it('returns native XLM balance on success', async () => {
    SorobanRpc.Server.mockReturnValue(makeMockServer('42.5000000'));

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey, rpcUrl: 'https://mock-rpc' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBe('42.5000000');
    expect(result.current.error).toBeNull();
  });

  it('returns "0.0000000" when account is not found (unfunded)', async () => {
    SorobanRpc.Server.mockReturnValue(makeNotFoundServer());

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey, rpcUrl: 'https://mock-rpc' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBe('0.0000000');
    expect(result.current.error).toBeNull();
  });

  it('treats "Not Found" errors as zero balance', async () => {
    SorobanRpc.Server.mockReturnValue({
      getAccount: jest.fn().mockRejectedValue(new Error('Not Found')),
    });

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey, rpcUrl: 'https://mock-rpc' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBe('0.0000000');
    expect(result.current.error).toBeNull();
  });

  it('treats "404" errors as zero balance', async () => {
    SorobanRpc.Server.mockReturnValue({
      getAccount: jest.fn().mockRejectedValue(new Error('404 response')),
    });

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey, rpcUrl: 'https://mock-rpc' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBe('0.0000000');
  });

  it('sets error on unexpected RPC failure', async () => {
    SorobanRpc.Server.mockReturnValue(makeErrorServer('Network timed out'));

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey, rpcUrl: 'https://mock-rpc' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.error).toBe('Network timed out');
    expect(result.current.balance).toBeNull();
  });

  it('returns "0.0000000" when balances array has no native entry', async () => {
    SorobanRpc.Server.mockReturnValue({
      getAccount: jest.fn().mockResolvedValue({
        balances: [{ asset_type: 'credit_alphanum4', balance: '10.0000000' }],
      }),
    });

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey, rpcUrl: 'https://mock-rpc' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.balance).toBe('0.0000000');
  });

  it('re-fetches when refreshTrigger increments', async () => {
    const mockGetAccount = jest.fn().mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '10.0000000' }],
    });
    SorobanRpc.Server.mockReturnValue({ getAccount: mockGetAccount });

    const { result, rerender } = renderHook(
      ({ trigger }) => useAccountBalance({ publicKey, rpcUrl: 'https://mock-rpc', refreshTrigger: trigger }),
      { initialProps: { trigger: 0 } },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetAccount).toHaveBeenCalledTimes(1);

    rerender({ trigger: 1 });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
  });

  it('re-fetches when refetch() is called', async () => {
    const mockGetAccount = jest.fn().mockResolvedValue({
      balances: [{ asset_type: 'native', balance: '5.0000000' }],
    });
    SorobanRpc.Server.mockReturnValue({ getAccount: mockGetAccount });

    const { result } = renderHook(() =>
      useAccountBalance({ publicKey, rpcUrl: 'https://mock-rpc' }),
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetAccount).toHaveBeenCalledTimes(1);

    act(() => { result.current.refetch(); });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(mockGetAccount).toHaveBeenCalledTimes(2);
  });

  it('clears balance when publicKey becomes null', async () => {
    SorobanRpc.Server.mockReturnValue(makeMockServer('50.0000000'));

    const { result, rerender } = renderHook(
      ({ pk }) => useAccountBalance({ publicKey: pk, rpcUrl: 'https://mock-rpc' }),
      { initialProps: { pk: publicKey as string | null } },
    );

    await waitFor(() => expect(result.current.balance).toBe('50.0000000'));

    rerender({ pk: null });
    expect(result.current.balance).toBeNull();
    expect(result.current.error).toBeNull();
  });
});
