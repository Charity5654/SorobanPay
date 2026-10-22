/**
 * useFriendbot.test.ts
 *
 * Unit tests for the useFriendbot hook.
 *
 * Covers:
 *  - fund() does nothing when publicKey is null
 *  - fund() does nothing when already funding (isFunding guard)
 *  - Sets isFunding true during the request
 *  - Sets success=true after a successful response
 *  - Calls onSuccess after successDelayMs on success
 *  - Sets error on non-OK HTTP response (with detail message from JSON)
 *  - Sets error on non-OK HTTP response without JSON body
 *  - Sets error on network failure (fetch throws)
 *  - Resets success/error on each new call
 *  - Encodes the public key in the Friendbot URL
 */

import { renderHook, act, waitFor } from '@testing-library/react';
import { useFriendbot, FRIENDBOT_URL } from '@/hooks/useFriendbot';

// ── fetch mock ────────────────────────────────────────────────────────────────

const mockFetch = jest.fn();
global.fetch = mockFetch;

// ── Helpers ───────────────────────────────────────────────────────────────────

function okResponse() {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => ({ hash: 'txhash123' }),
  } as Response);
}

function errorResponse(status = 400, detail = 'createAccountAlreadyExist') {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => ({ detail }),
  } as Response);
}

function errorResponseNoJson(status = 500) {
  return Promise.resolve({
    ok: false,
    status,
    json: async () => { throw new Error('not json'); },
  } as unknown as Response);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

const publicKey = 'GPUBKEY000000000000000000000000000000000000000000000000';

describe('useFriendbot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does nothing when publicKey is null', async () => {
    const { result } = renderHook(() =>
      useFriendbot({ publicKey: null, friendbotUrl: FRIENDBOT_URL }),
    );

    await act(async () => { await result.current.fund(); });

    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.current.isFunding).toBe(false);
  });

  it('sets isFunding true while the request is in flight', async () => {
    let resolveFetch!: (v: unknown) => void;
    mockFetch.mockReturnValue(new Promise((res) => { resolveFetch = res; }));

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, friendbotUrl: 'https://mock-friendbot' }),
    );

    // Start the call but don't await
    act(() => { void result.current.fund(); });
    // Give one microtask tick for state updates
    await act(async () => { await Promise.resolve(); });

    expect(result.current.isFunding).toBe(true);

    // Resolve to clean up
    resolveFetch({ ok: true, status: 200, json: async () => ({}) });
  });

  it('sets success=true after a successful response', async () => {
    mockFetch.mockReturnValue(okResponse());

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, friendbotUrl: 'https://mock-friendbot' }),
    );

    await act(async () => { await result.current.fund(); });

    expect(result.current.success).toBe(true);
    expect(result.current.error).toBeNull();
    expect(result.current.isFunding).toBe(false);
  });

  it('calls onSuccess after successDelayMs on success', async () => {
    mockFetch.mockReturnValue(okResponse());
    const onSuccess = jest.fn();

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, onSuccess, successDelayMs: 5000, friendbotUrl: 'https://mock-friendbot' }),
    );

    await act(async () => { await result.current.fund(); });

    expect(onSuccess).not.toHaveBeenCalled(); // not yet

    act(() => { jest.advanceTimersByTime(5000); });

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not call onSuccess before the delay elapses', async () => {
    mockFetch.mockReturnValue(okResponse());
    const onSuccess = jest.fn();

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, onSuccess, successDelayMs: 5000, friendbotUrl: 'https://mock-friendbot' }),
    );

    await act(async () => { await result.current.fund(); });

    act(() => { jest.advanceTimersByTime(4999); });
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it('sets error with detail message on non-OK response', async () => {
    mockFetch.mockReturnValue(errorResponse(400, 'createAccountAlreadyExist'));

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, friendbotUrl: 'https://mock-friendbot' }),
    );

    await act(async () => { await result.current.fund(); });

    expect(result.current.success).toBe(false);
    expect(result.current.error).toBe('createAccountAlreadyExist');
    expect(result.current.isFunding).toBe(false);
  });

  it('sets error with HTTP status when JSON body is unavailable', async () => {
    mockFetch.mockReturnValue(errorResponseNoJson(503));

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, friendbotUrl: 'https://mock-friendbot' }),
    );

    await act(async () => { await result.current.fund(); });

    expect(result.current.error).toBe('HTTP 503');
  });

  it('sets error when fetch throws (network failure)', async () => {
    mockFetch.mockRejectedValue(new Error('Failed to fetch'));

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, friendbotUrl: 'https://mock-friendbot' }),
    );

    await act(async () => { await result.current.fund(); });

    expect(result.current.error).toBe('Failed to fetch');
    expect(result.current.success).toBe(false);
  });

  it('resets error and success at the start of each new call', async () => {
    // First call fails
    mockFetch.mockReturnValueOnce(errorResponse(400, 'some error'));

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, friendbotUrl: 'https://mock-friendbot' }),
    );

    await act(async () => { await result.current.fund(); });
    expect(result.current.error).toBe('some error');

    // Second call succeeds
    mockFetch.mockReturnValueOnce(okResponse());
    await act(async () => { await result.current.fund(); });

    expect(result.current.error).toBeNull();
    expect(result.current.success).toBe(true);
  });

  it('encodes the public key correctly in the request URL', async () => {
    mockFetch.mockReturnValue(okResponse());

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, friendbotUrl: 'https://mock-friendbot' }),
    );

    await act(async () => { await result.current.fund(); });

    expect(mockFetch).toHaveBeenCalledWith(
      `https://mock-friendbot/?addr=${encodeURIComponent(publicKey)}`,
    );
  });

  it('prevents concurrent calls — ignores fund() while isFunding', async () => {
    let resolveFetch!: (v: unknown) => void;
    mockFetch.mockReturnValue(new Promise((res) => { resolveFetch = res; }));

    const { result } = renderHook(() =>
      useFriendbot({ publicKey, friendbotUrl: 'https://mock-friendbot' }),
    );

    // Start first call
    act(() => { void result.current.fund(); });
    await act(async () => { await Promise.resolve(); });

    // Try second call while first is in flight
    await act(async () => { await result.current.fund(); });

    // Only one fetch should have been made
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // Clean up
    resolveFetch({ ok: true, status: 200, json: async () => ({}) });
  });
});
