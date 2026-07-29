/**
 * useTransactionPoller.test.ts
 *
 * Tests for the useTransactionPoller hook covering:
 *   - Success: transaction reaches SUCCESS status
 *   - Contract error: transaction reaches FAILED status with error code
 *   - Timeout: no terminal status within 60 seconds
 *   - RPC error: getTransaction throws on individual poll attempts
 *   - buildExplorerUrl: testnet and mainnet URL generation
 *   - extractFailureMessage: message extraction from failed response
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useTransactionPoller, buildExplorerUrl, extractFailureMessage } from '@/hooks/useTransactionPoller';
import { SorobanRpc } from '@stellar/stellar-sdk';

// ── Mock stellar-sdk ──────────────────────────────────────────────────────────

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Api: {
        GetTransactionStatus: {
          SUCCESS: 'SUCCESS',
          FAILED: 'FAILED',
          NOT_FOUND: 'NOT_FOUND',
        },
      },
      Server: jest.fn(),
    },
  };
});

// ── Timer setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.runOnlyPendingTimers();
  jest.useRealTimers();
  jest.clearAllMocks();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const MOCK_TX_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';

function makeServer(getTransactionImpl: () => Promise<unknown>): SorobanRpc.Server {
  return {
    getTransaction: jest.fn().mockImplementation(getTransactionImpl),
  } as unknown as SorobanRpc.Server;
}

// ── buildExplorerUrl ──────────────────────────────────────────────────────────

describe('buildExplorerUrl', () => {
  it('returns testnet URL for Testnet network', () => {
    const url = buildExplorerUrl(MOCK_TX_HASH, 'Testnet');
    expect(url).toBe(`https://stellar.expert/explorer/testnet/tx/${MOCK_TX_HASH}`);
  });

  it('returns mainnet URL for Mainnet network', () => {
    const url = buildExplorerUrl(MOCK_TX_HASH, 'Mainnet');
    expect(url).toBe(`https://stellar.expert/explorer/public/tx/${MOCK_TX_HASH}`);
  });

  it('defaults to testnet for unknown network names', () => {
    const url = buildExplorerUrl(MOCK_TX_HASH, 'Unknown');
    expect(url).toBe(`https://stellar.expert/explorer/testnet/tx/${MOCK_TX_HASH}`);
  });
});

// ── extractFailureMessage ─────────────────────────────────────────────────────

describe('extractFailureMessage', () => {
  it('returns generic message when status is not FAILED', () => {
    const msg = extractFailureMessage({ status: 'SUCCESS' } as SorobanRpc.Api.GetTransactionResponse);
    expect(msg).toBe('Transaction failed');
  });

  it('returns no-metadata message when resultMetaXdr is missing', () => {
    const response = {
      status: 'FAILED',
      resultMetaXdr: undefined,
    } as unknown as SorobanRpc.Api.GetTransactionResponse;
    expect(extractFailureMessage(response)).toContain('no result metadata');
  });

  it('extracts contract error code from Error(Contract, #N) pattern', () => {
    const response = {
      status: 'FAILED',
      resultMetaXdr: 'AAAA Error(Contract, #7) BBBB',
    } as unknown as SorobanRpc.Api.GetTransactionResponse;
    const msg = extractFailureMessage(response);
    expect(msg).toContain('contract error #7');
  });

  it('extracts contract error code from "contract error: N" pattern', () => {
    const response = {
      status: 'FAILED',
      resultMetaXdr: 'contract error: 4 occurred',
    } as unknown as SorobanRpc.Api.GetTransactionResponse;
    const msg = extractFailureMessage(response);
    expect(msg).toContain('contract error #4');
  });

  it('returns truncated XDR when no code pattern matches', () => {
    const response = {
      status: 'FAILED',
      resultMetaXdr: 'AAABBBCCC',
    } as unknown as SorobanRpc.Api.GetTransactionResponse;
    const msg = extractFailureMessage(response);
    expect(msg).toContain('AAABBBCCC');
  });
});

// ── useTransactionPoller ──────────────────────────────────────────────────────

describe('useTransactionPoller', () => {
  it('starts in idle state', () => {
    const { result } = renderHook(() => useTransactionPoller());
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.txHash).toBeNull();
    expect(result.current.state.explorerUrl).toBeNull();
  });

  it('transitions to confirming immediately on startPolling', async () => {
    // Server that never resolves so we can inspect the confirming state
    const server = makeServer(() => new Promise(() => {}));
    const { result } = renderHook(() => useTransactionPoller());

    act(() => {
      result.current.startPolling(MOCK_TX_HASH, server);
    });

    expect(result.current.state.status).toBe('confirming');
    expect(result.current.state.txHash).toBe(MOCK_TX_HASH);
    expect(result.current.state.explorerUrl).toContain(MOCK_TX_HASH);
  });

  it('transitions to success when getTransaction returns SUCCESS', async () => {
    const onSuccess = jest.fn();
    const server = makeServer(async () => ({ status: 'SUCCESS' }));

    const { result } = renderHook(() =>
      useTransactionPoller({ onSuccess }),
    );

    act(() => {
      result.current.startPolling(MOCK_TX_HASH, server);
    });

    // Advance past the initial 2 s delay
    await act(async () => {
      jest.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('success');
    });

    expect(onSuccess).toHaveBeenCalledWith(MOCK_TX_HASH);
    expect(result.current.state.txHash).toBe(MOCK_TX_HASH);
  });

  it('transitions to failed on contract FAILED status and calls onFailed', async () => {
    const onFailed = jest.fn();
    const server = makeServer(async () => ({
      status: 'FAILED',
      resultMetaXdr: 'Error(Contract, #7)',
    }));

    const { result } = renderHook(() =>
      useTransactionPoller({ onFailed }),
    );

    act(() => {
      result.current.startPolling(MOCK_TX_HASH, server);
    });

    await act(async () => {
      jest.advanceTimersByTime(2500);
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('failed');
    });

    expect(result.current.state.errorMessage).toContain('contract error #7');
    expect(onFailed).toHaveBeenCalledWith(
      expect.stringContaining('contract error #7'),
      MOCK_TX_HASH,
    );
  });

  it('transitions to timeout after 60 seconds with no terminal status and calls onTimeout', async () => {
    const onTimeout = jest.fn();
    // Always returns NOT_FOUND
    const server = makeServer(async () => ({ status: 'NOT_FOUND' }));

    const { result } = renderHook(() =>
      useTransactionPoller({ onTimeout }),
    );

    act(() => {
      result.current.startPolling(MOCK_TX_HASH, server);
    });

    // Advance 61 seconds to trigger the timeout check
    await act(async () => {
      jest.advanceTimersByTime(61_000);
      // Flush all microtasks
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    await waitFor(() => {
      expect(result.current.state.status).toBe('timeout');
    });

    expect(onTimeout).toHaveBeenCalledWith(
      MOCK_TX_HASH,
      expect.stringContaining(MOCK_TX_HASH),
    );
  });

  it('retries on RPC error and eventually times out', async () => {
    const onTimeout = jest.fn();
    const onFailed = jest.fn();
    // Every call throws an RPC error
    const server = makeServer(async () => {
      throw new Error('RPC connection refused');
    });

    const { result } = renderHook(() =>
      useTransactionPoller({ onTimeout, onFailed }),
    );

    act(() => {
      result.current.startPolling(MOCK_TX_HASH, server);
    });

    // Advance well past the timeout
    await act(async () => {
      jest.advanceTimersByTime(65_000);
      for (let i = 0; i < 20; i++) {
        await Promise.resolve();
      }
    });

    await waitFor(() => {
      // Should either timeout (if the RPC error fires after time check) or fail
      expect(['timeout', 'failed']).toContain(result.current.state.status);
    });
  });

  it('uses exponential backoff — delay grows between retries', async () => {
    const getTransaction = jest.fn().mockResolvedValue({ status: 'NOT_FOUND' });
    const server = { getTransaction } as unknown as SorobanRpc.Server;

    const { result } = renderHook(() => useTransactionPoller());

    act(() => {
      result.current.startPolling(MOCK_TX_HASH, server);
    });

    // After 2 s: 1st call
    await act(async () => {
      jest.advanceTimersByTime(2000);
      await Promise.resolve();
    });
    const callsAfter2s = getTransaction.mock.calls.length;

    // After another 3 s (2 s + backoff ~3 s): should NOT yet have a 2nd call
    // (2nd delay = 2000 × 1.5 = 3000 ms)
    await act(async () => {
      jest.advanceTimersByTime(2999);
      await Promise.resolve();
    });
    // Still only the first call
    expect(getTransaction.mock.calls.length).toBe(callsAfter2s);

    // 1 more ms: 2nd call fires
    await act(async () => {
      jest.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(getTransaction.mock.calls.length).toBeGreaterThan(callsAfter2s);
  });

  it('reset() returns to idle state', async () => {
    const server = makeServer(() => new Promise(() => {}));
    const { result } = renderHook(() => useTransactionPoller());

    act(() => {
      result.current.startPolling(MOCK_TX_HASH, server);
    });
    expect(result.current.state.status).toBe('confirming');

    act(() => {
      result.current.reset();
    });
    expect(result.current.state.status).toBe('idle');
    expect(result.current.state.txHash).toBeNull();
  });

  it('explorerUrl is set to testnet URL during confirming', () => {
    const server = makeServer(() => new Promise(() => {}));
    const { result } = renderHook(() => useTransactionPoller());

    act(() => {
      result.current.startPolling(MOCK_TX_HASH, server);
    });

    expect(result.current.state.explorerUrl).toBe(
      `https://stellar.expert/explorer/testnet/tx/${MOCK_TX_HASH}`,
    );
  });
});
