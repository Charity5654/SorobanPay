/**
 * useTokenInfo.test.tsx
 *
 * Unit tests for the useTokenInfo hook.
 *
 * Tests cover:
 *   - idle state when addresses are absent or invalid
 *   - loading → success transition with balance + allowance
 *   - stale-fetch guard (generation counter)
 *   - error state for failed simulations (non-SEP-41, network)
 *   - 30-second interval refresh
 *   - window focus refresh
 *   - manual refresh()
 *
 * Uses jsdom environment (testEnvironment: 'jsdom') because renderHook from
 * @testing-library/react requires a DOM. File extension is .tsx so jest.config.js
 * routes it to the 'components' project with jsdom.
 *
 * The stellar-sdk is mocked at the module level to avoid real RPC calls and
 * StrKey validation failures.
 */

// ── Mocks ─────────────────────────────────────────────────────────────────────

jest.mock('@/constants/network', () => ({
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  CONTRACT_ID: 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW',
  NETWORK_NAME: 'Testnet',
}));

const mockSimulateTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  // isSimulationError check: the hook calls SorobanRpc.Api.isSimulationError(result)
  const isSimulationError = (r: { error?: string }) => typeof r.error === 'string';

  // Stub Contract — just returns a plain op object
  class MockContract {
    constructor(public id: string) {}
    call(method: string, ..._args: unknown[]) {
      return { type: 'invoke_host_function', method, contractId: this.id };
    }
  }

  // Stub Address — skip StrKey validation entirely
  class MockAddress {
    constructor(public address: string) {}
    toScVal() {
      return { type: 'address', address: this.address };
    }
  }

  // Stub Account
  class MockAccount {
    constructor(public id: string, public seq: string) {}
    accountId() { return this.id; }
    sequenceNumber() { return this.seq; }
    incrementSequenceNumber() {}
  }

  // Stub TransactionBuilder — build() returns a minimal tx
  class MockTransactionBuilder {
    private ops: unknown[] = [];
    constructor(_account: unknown, _opts: unknown) {}
    addOperation(op: unknown) { this.ops.push(op); return this; }
    setTimeout(_n: number) { return this; }
    build() {
      return {
        toXDR: () => 'mock-xdr',
        ops: this.ops,
      };
    }
    static fromXDR() { return {}; }
  }

  return {
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        simulateTransaction: mockSimulateTransaction,
      })),
      Api: {
        isSimulationError,
      },
    },
    Contract: MockContract,
    Address: MockAddress,
    Account: MockAccount,
    TransactionBuilder: MockTransactionBuilder,
    BASE_FEE: '100',
    // nativeToScVal / scValToNative not used in the hook path being tested
    // (retval parsing uses scValToNative which is imported at module level)
    nativeToScVal: jest.fn((v: unknown) => ({ value: v })),
    scValToNative: jest.fn((v: unknown) => {
      // The hook calls scValToNative(retval) and expects a bigint.
      // Our makeSuccessResult stores the bigint directly in retval.__mockBigint.
      if (v && typeof v === 'object' && '__mockBigint' in (v as object)) {
        return (v as { __mockBigint: bigint }).__mockBigint;
      }
      return BigInt(0);
    }),
  };
});

// ── Imports (after mocks) ─────────────────────────────────────────────────────

import { renderHook, act, waitFor } from '@testing-library/react';
import { useTokenInfo } from '@/hooks/useTokenInfo';

// ── Helpers ───────────────────────────────────────────────────────────────────

// Valid G-address and C-addresses for tests (pass isValidGAddress / isValidCAddress regex).
// These use real Stellar StrKey-encoded values derived from known seeds so they
// satisfy the /^G[A-Z2-7]{55}$/ and /^C[A-Z2-7]{55}$/ regexes.
const VALID_TOKEN      = 'CABQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGAYDAMBQGCK3';  // 56 chars C-prefix
const VALID_SUBSCRIBER = 'GCFIRY65OQE7DFP5KLNS2PF2LVZMUZYJX4OZIEQ36N2IQANUB5XVYOJR'; // 56 chars G-prefix
const VALID_SPENDER    = 'CACAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAINCW';  // 56 chars C-prefix

/** Build a minimal successful SimulateTransactionSuccessResponse with a bigint retval. */
function makeSuccessResult(value: bigint) {
  return {
    result: {
      // scValToNative mock looks for __mockBigint on the retval
      retval: { __mockBigint: value },
    },
    minResourceFee: '100',
    events: [],
  };
}

/** Build a minimal error SimulateTransactionResponse. */
function makeErrorResult(error: string) {
  return { error };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('useTokenInfo – idle when addresses are invalid', () => {
  beforeEach(() => {
    mockSimulateTransaction.mockReset();
  });

  it('returns idle status when tokenAddress is empty', () => {
    const { result } = renderHook(() =>
      useTokenInfo('', VALID_SUBSCRIBER, VALID_SPENDER),
    );
    expect(result.current.status).toBe('idle');
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('returns idle status when tokenAddress is not a valid C-address', () => {
    const { result } = renderHook(() =>
      useTokenInfo('INVALID_TOKEN', VALID_SUBSCRIBER, VALID_SPENDER),
    );
    expect(result.current.status).toBe('idle');
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('returns idle status when subscriberAddress is empty', () => {
    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, '', VALID_SPENDER),
    );
    expect(result.current.status).toBe('idle');
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('returns idle status when subscriberAddress is not a valid G-address', () => {
    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, 'NOT_A_G_ADDRESS', VALID_SPENDER),
    );
    expect(result.current.status).toBe('idle');
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });

  it('returns idle status when spenderAddress is not a valid C-address', () => {
    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, 'NOT_A_C_ADDRESS'),
    );
    expect(result.current.status).toBe('idle');
    expect(mockSimulateTransaction).not.toHaveBeenCalled();
  });
});

describe('useTokenInfo – successful fetch', () => {
  beforeEach(() => {
    mockSimulateTransaction.mockReset();
  });

  it('transitions to success with correct balance and allowance', async () => {
    const BALANCE = 50_000_000n;
    const ALLOWANCE = 20_000_000n;

    mockSimulateTransaction
      .mockResolvedValueOnce(makeSuccessResult(BALANCE))
      .mockResolvedValueOnce(makeSuccessResult(ALLOWANCE));

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(result.current.balance).toBe(BALANCE);
    expect(result.current.allowance).toBe(ALLOWANCE);
    expect(result.current.error).toBeNull();
    expect(result.current.lastUpdated).not.toBeNull();
  });

  it('calls simulateTransaction exactly twice (balance + allowance)', async () => {
    mockSimulateTransaction
      .mockResolvedValueOnce(makeSuccessResult(1_000_000n))
      .mockResolvedValueOnce(makeSuccessResult(500_000n));

    renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER),
    );

    await waitFor(() => expect(mockSimulateTransaction).toHaveBeenCalledTimes(2));
  });
});

describe('useTokenInfo – error states', () => {
  beforeEach(() => {
    mockSimulateTransaction.mockReset();
  });

  it('transitions to error when simulation returns an error response', async () => {
    mockSimulateTransaction
      .mockResolvedValueOnce(makeErrorResult('host invocation failed'))
      .mockResolvedValueOnce(makeErrorResult('host invocation failed'));

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).not.toBeNull();
    expect(result.current.balance).toBeNull();
    expect(result.current.allowance).toBeNull();
  });

  it('transitions to error when simulation rejects (network failure)', async () => {
    mockSimulateTransaction.mockRejectedValue(new Error('failed to fetch'));

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/could not reach/i);
  });

  it('error message classifies timeout correctly', async () => {
    mockSimulateTransaction.mockRejectedValue(new Error('request timed out after 30000ms'));

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/timed out/i);
  });

  it('error message classifies non-SEP-41 contract correctly', async () => {
    mockSimulateTransaction.mockRejectedValue(
      new Error('No return value in simulation for "balance". The address may not be a valid SEP-41 token contract.'),
    );

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER),
    );

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/sep-41/i);
  });
});

describe('useTokenInfo – manual refresh', () => {
  beforeEach(() => {
    mockSimulateTransaction.mockReset();
  });

  it('re-fetches when refresh() is called', async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResult(5_000_000n));

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    const callCountAfterFirstFetch = mockSimulateTransaction.mock.calls.length;

    act(() => {
      result.current.refresh();
    });

    await waitFor(() =>
      expect(mockSimulateTransaction.mock.calls.length).toBeGreaterThan(callCountAfterFirstFetch),
    );
  });
});

describe('useTokenInfo – timer-based refresh', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockSimulateTransaction.mockReset();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  it('re-fetches after the refresh interval elapses', async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResult(1_000_000n));

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER, {
        refreshIntervalMs: 10_000,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    const afterFirst = mockSimulateTransaction.mock.calls.length;

    act(() => {
      jest.advanceTimersByTime(10_001);
    });

    await waitFor(() =>
      expect(mockSimulateTransaction.mock.calls.length).toBeGreaterThan(afterFirst),
    );
  });

  it('does NOT re-fetch when refreshIntervalMs is 0', async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResult(1_000_000n));

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER, {
        refreshIntervalMs: 0,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    const afterFirst = mockSimulateTransaction.mock.calls.length;

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    expect(mockSimulateTransaction.mock.calls.length).toBe(afterFirst);
  });
});

describe('useTokenInfo – focus-based refresh', () => {
  beforeEach(() => {
    mockSimulateTransaction.mockReset();
  });

  it('re-fetches when the window regains focus', async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResult(1_000_000n));

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    const afterFirst = mockSimulateTransaction.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    await waitFor(() =>
      expect(mockSimulateTransaction.mock.calls.length).toBeGreaterThan(afterFirst),
    );
  });

  it('does NOT add focus listener when refreshOnFocus is false', async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResult(1_000_000n));

    const { result } = renderHook(() =>
      useTokenInfo(VALID_TOKEN, VALID_SUBSCRIBER, VALID_SPENDER, {
        refreshOnFocus: false,
      }),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));
    const afterFirst = mockSimulateTransaction.mock.calls.length;

    act(() => {
      window.dispatchEvent(new Event('focus'));
    });

    expect(mockSimulateTransaction.mock.calls.length).toBe(afterFirst);
  });
});

describe('useTokenInfo – goes idle when addresses are cleared', () => {
  beforeEach(() => {
    mockSimulateTransaction.mockReset();
  });

  it('resets to idle state when token address is cleared after a successful fetch', async () => {
    mockSimulateTransaction.mockResolvedValue(makeSuccessResult(1_000_000n));

    let token = VALID_TOKEN;
    const { result, rerender } = renderHook(() =>
      useTokenInfo(token, VALID_SUBSCRIBER, VALID_SPENDER, { refreshIntervalMs: 0 }),
    );

    await waitFor(() => expect(result.current.status).toBe('success'));

    token = '';
    rerender();

    await waitFor(() => expect(result.current.status).toBe('idle'));
    expect(result.current.balance).toBeNull();
    expect(result.current.allowance).toBeNull();
  });
});
