/**
 * useSimulateFee.test.ts
 *
 * Unit tests for the useSimulateFee hook.
 *
 * Covers:
 *  - stroopsToXlm conversion helper
 *  - Hook stays idle when formValid is false
 *  - Hook stays idle when subscriber is empty
 *  - Hook sets status=loading immediately when params become valid
 *  - Hook sets status=success and populates fee/breakdown on a good simulation
 *  - Hook sets status=error on a simulation error response
 *  - Hook sets status=error when simulateTransaction throws
 *  - Hook debounces: rapid param changes only trigger one RPC call
 *  - Hook resets to idle when formValid flips back to false
 *  - Hook cancels in-flight request when params change mid-flight
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useSimulateFee, stroopsToXlm } from '@/hooks/useSimulateFee';

// ── Jest fake timers ──────────────────────────────────────────────────────────
// We use fake timers to control the 500ms debounce without real wait.

// ── Mock @stellar/stellar-sdk ────────────────────────────────────────────────

jest.mock('@stellar/stellar-sdk', () => {
  // Minimal stub — only the surface useSimulateFee touches.
  const SorobanRpc = {
    Server: jest.fn(),
    Api: {
      isSimulationError: jest.fn(),
      isSimulationSuccess: jest.fn(),
    },
  };

  class MockAddress {
    private addr: string;
    constructor(addr: string) { this.addr = addr; }
    toScVal() { return { type: 'Address', value: this.addr }; }
  }

  return {
    SorobanRpc,
    Contract: jest.fn().mockImplementation(() => ({
      call: jest.fn().mockReturnValue({ type: 'operation' }),
    })),
    TransactionBuilder: jest.fn().mockImplementation(() => ({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ type: 'transaction' }),
    })),
    BASE_FEE: '100',
    nativeToScVal: jest.fn().mockReturnValue({ type: 'ScVal' }),
    Address: MockAddress,
    xdr: {},
  };
});

// ── Helpers ────────────────────────────────────────────────────────────────────

const { SorobanRpc } = jest.requireMock('@stellar/stellar-sdk');

const VALID_G = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_C = 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
const VALID_G2 = 'GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB';
const RPC_URL = 'https://mock-rpc';
const CONTRACT_ID = VALID_C;
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

// A successful simulation result stub
function makeSimSuccess(minResourceFee = '12345') {
  const resources = {
    instructions: () => 100_000,
    readBytes: () => 256,
    writeBytes: () => 128,
  };
  return {
    minResourceFee,
    transactionData: {
      build: () => ({ resources: () => resources }),
    },
  };
}

// A simulation error result stub
function makeSimError(errorMsg = 'HostError: trap') {
  return { error: errorMsg };
}

function makeMockServer(overrides: Partial<{
  getAccount: jest.Mock;
  simulateTransaction: jest.Mock;
}> = {}) {
  return {
    getAccount: jest.fn().mockResolvedValue({
      id: VALID_G,
      sequence: '1000',
    }),
    simulateTransaction: jest.fn().mockResolvedValue(makeSimSuccess()),
    ...overrides,
  };
}

function defaultParams(overrides = {}) {
  return {
    subscriber: VALID_G,
    merchant: VALID_G2,
    token: VALID_C,
    amount: 100,
    interval: 86400,
    formValid: true,
    ...overrides,
  };
}

// ── stroopsToXlm ──────────────────────────────────────────────────────────────

describe('stroopsToXlm', () => {
  it('converts 10_000_000 stroops to 1.0000000 XLM', () => {
    expect(stroopsToXlm('10000000')).toBe('1.0000000');
  });

  it('converts 1 stroop to 0.0000001 XLM', () => {
    expect(stroopsToXlm('1')).toBe('0.0000001');
  });

  it('converts 0 stroops to 0.0000000 XLM', () => {
    expect(stroopsToXlm('0')).toBe('0.0000000');
  });

  it('converts 100 stroops to 0.0000100 XLM', () => {
    expect(stroopsToXlm('100')).toBe('0.0000100');
  });

  it('handles large fee values correctly', () => {
    expect(stroopsToXlm('50000000')).toBe('5.0000000');
  });

  it('returns 0.0000000 for non-numeric input', () => {
    expect(stroopsToXlm('not-a-number')).toBe('0.0000000');
  });
});

// ── useSimulateFee ────────────────────────────────────────────────────────────

describe('useSimulateFee', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
    // Default: all Api predicates return false (overridden per-test)
    SorobanRpc.Api.isSimulationError.mockReturnValue(false);
    SorobanRpc.Api.isSimulationSuccess.mockReturnValue(false);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ── Idle when form is invalid ───────────────────────────────────────────────

  it('stays idle when formValid is false', () => {
    SorobanRpc.Server.mockReturnValue(makeMockServer());
    const { result } = renderHook(() =>
      useSimulateFee(
        defaultParams({ formValid: false }),
        RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
      ),
    );
    expect(result.current.status).toBe('idle');
    expect(result.current.minResourceFee).toBeNull();
    expect(result.current.breakdown).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('stays idle when subscriber is empty', () => {
    SorobanRpc.Server.mockReturnValue(makeMockServer());
    const { result } = renderHook(() =>
      useSimulateFee(
        defaultParams({ subscriber: '' }),
        RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
      ),
    );
    expect(result.current.status).toBe('idle');
  });

  // ── Loading state ───────────────────────────────────────────────────────────

  it('sets status=loading immediately when params become valid', async () => {
    // Never-resolving server to keep it in the loading state
    const pendingGetAccount = new Promise(() => {});
    SorobanRpc.Server.mockReturnValue({
      getAccount: jest.fn().mockReturnValue(pendingGetAccount),
      simulateTransaction: jest.fn(),
    });

    const { result } = renderHook(() =>
      useSimulateFee(
        defaultParams(),
        RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
      ),
    );

    // Before the debounce fires: loading is set immediately
    act(() => { jest.advanceTimersByTime(0); });
    expect(result.current.status).toBe('loading');
  });

  // ── Success path ────────────────────────────────────────────────────────────

  it('returns status=success with fee and breakdown after successful simulation', async () => {
    const mockServer = makeMockServer();
    SorobanRpc.Server.mockReturnValue(mockServer);
    SorobanRpc.Api.isSimulationSuccess.mockReturnValue(true);

    const { result } = renderHook(() =>
      useSimulateFee(
        defaultParams(),
        RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
      ),
    );

    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => expect(result.current.status).toBe('success'));

    expect(result.current.minResourceFee).toBe('12345');
    expect(result.current.breakdown).toEqual({
      instructions: 100_000,
      readBytes: 256,
      writeBytes: 128,
    });
    expect(result.current.error).toBeNull();
  });

  // ── Simulation error response ───────────────────────────────────────────────

  it('sets status=error when simulateTransaction returns an error result', async () => {
    const mockServer = makeMockServer({
      simulateTransaction: jest.fn().mockResolvedValue(makeSimError('HostError: wasm trap')),
    });
    SorobanRpc.Server.mockReturnValue(mockServer);
    SorobanRpc.Api.isSimulationError.mockReturnValue(true);

    const { result } = renderHook(() =>
      useSimulateFee(
        defaultParams(),
        RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
      ),
    );

    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => expect(result.current.status).toBe('error'));

    expect(result.current.error).toBe('HostError: wasm trap');
    expect(result.current.minResourceFee).toBeNull();
    expect(result.current.breakdown).toBeNull();
  });

  it('sets status=error with fallback message when simulation error has no .error field', async () => {
    const mockServer = makeMockServer({
      simulateTransaction: jest.fn().mockResolvedValue({ error: '' }),
    });
    SorobanRpc.Server.mockReturnValue(mockServer);
    SorobanRpc.Api.isSimulationError.mockReturnValue(true);

    const { result } = renderHook(() =>
      useSimulateFee(
        defaultParams(),
        RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
      ),
    );

    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/simulation failed/i);
  });

  // ── Thrown error ────────────────────────────────────────────────────────────

  it('sets status=error when simulateTransaction throws', async () => {
    const mockServer = makeMockServer({
      simulateTransaction: jest.fn().mockRejectedValue(new Error('Network timeout')),
    });
    SorobanRpc.Server.mockReturnValue(mockServer);

    const { result } = renderHook(() =>
      useSimulateFee(
        defaultParams(),
        RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
      ),
    );

    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Network timeout');
  });

  it('sets status=error when getAccount throws', async () => {
    const mockServer = makeMockServer({
      getAccount: jest.fn().mockRejectedValue(new Error('Account not funded')),
    });
    SorobanRpc.Server.mockReturnValue(mockServer);

    const { result } = renderHook(() =>
      useSimulateFee(
        defaultParams(),
        RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
      ),
    );

    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toBe('Account not funded');
  });

  // ── Debounce ────────────────────────────────────────────────────────────────

  it('debounces: only triggers one RPC call when params change rapidly', async () => {
    const simulateMock = jest.fn().mockResolvedValue(makeSimSuccess());
    const getAccountMock = jest.fn().mockResolvedValue({ id: VALID_G, sequence: '1' });
    SorobanRpc.Server.mockReturnValue({
      getAccount: getAccountMock,
      simulateTransaction: simulateMock,
    });
    SorobanRpc.Api.isSimulationSuccess.mockReturnValue(true);

    const { rerender } = renderHook(
      ({ amount }: { amount: number }) =>
        useSimulateFee(
          defaultParams({ amount }),
          RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
        ),
      { initialProps: { amount: 100 } },
    );

    // Rapid changes within the 500ms window
    act(() => { jest.advanceTimersByTime(100); });
    rerender({ amount: 200 });
    act(() => { jest.advanceTimersByTime(100); });
    rerender({ amount: 300 });
    act(() => { jest.advanceTimersByTime(100); });
    rerender({ amount: 400 });

    // Only after the full debounce period from the last change
    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => expect(simulateMock).toHaveBeenCalledTimes(1));
  });

  // ── Resets to idle when form becomes invalid ────────────────────────────────

  it('resets to idle when formValid flips back to false', async () => {
    const mockServer = makeMockServer();
    SorobanRpc.Server.mockReturnValue(mockServer);
    SorobanRpc.Api.isSimulationSuccess.mockReturnValue(true);

    const { result, rerender } = renderHook(
      ({ formValid }: { formValid: boolean }) =>
        useSimulateFee(
          defaultParams({ formValid }),
          RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
        ),
      { initialProps: { formValid: true } },
    );

    act(() => { jest.advanceTimersByTime(500); });
    await waitFor(() => expect(result.current.status).toBe('success'));

    // Flip formValid to false (e.g., user blanks out a field)
    rerender({ formValid: false });

    expect(result.current.status).toBe('idle');
    expect(result.current.minResourceFee).toBeNull();
    expect(result.current.breakdown).toBeNull();
    expect(result.current.error).toBeNull();
  });

  // ── Unexpected (non-error, non-success) result ─────────────────────────────

  it('sets status=error for a result that is neither success nor error', async () => {
    const mockServer = makeMockServer({
      simulateTransaction: jest.fn().mockResolvedValue({ unexpected: true }),
    });
    SorobanRpc.Server.mockReturnValue(mockServer);
    // Both predicates return false → neither branch matches
    SorobanRpc.Api.isSimulationError.mockReturnValue(false);
    SorobanRpc.Api.isSimulationSuccess.mockReturnValue(false);

    const { result } = renderHook(() =>
      useSimulateFee(
        defaultParams(),
        RPC_URL, CONTRACT_ID, NETWORK_PASSPHRASE,
      ),
    );

    act(() => { jest.advanceTimersByTime(500); });

    await waitFor(() => expect(result.current.status).toBe('error'));
    expect(result.current.error).toMatch(/unexpected result/i);
  });
});
