/**
 * allowance_checker.test.ts
 *
 * Unit tests for the `checkAllowance` utility in allowance_checker.ts.
 *
 * Covers:
 *   1. Input validation — bad addresses and negative amounts rejected before
 *      any RPC call (synchronous guards).
 *   2. Happy path — simulation success with sufficient allowance.
 *   3. Insufficient allowance — correct `sufficient`, `shortfall` computed.
 *   4. Zero allowance edge case.
 *   5. Allowance exactly equal to required amount (boundary: sufficient).
 *   6. Simulation error path — throws with descriptive message.
 *   7. Unexpected simulation result type (neither success nor error) — throws.
 *   8. Unexpected retval type (non-bigint from scValToNative) — throws.
 *   9. `formatAllowance` helper — decimal and raw formatting.
 */

// ─── Shared mock state ─────────────────────────────────────────────────────────

const mockGetAccount     = jest.fn();
const mockSimulateTx     = jest.fn();

// scValToNative is called to decode the simulation return value.
// We mock it so tests control the decoded allowance without XDR encoding.
const mockScValToNative  = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const isSimulationError   = jest.fn();
  const isSimulationSuccess = jest.fn();

  return {
    Contract: jest.fn().mockReturnValue({
      call: jest.fn().mockReturnValue({}),
    }),
    TransactionBuilder: Object.assign(
      jest.fn().mockReturnValue({
        addOperation: jest.fn().mockReturnThis(),
        setTimeout:   jest.fn().mockReturnThis(),
        build:        jest.fn().mockReturnValue({ toXDR: () => 'MOCK_XDR' }),
      }),
      { fromXDR: jest.fn().mockReturnValue({}) },
    ),
    BASE_FEE: '100',
    nativeToScVal: jest.fn().mockReturnValue({}),
    Address: jest.fn().mockReturnValue({ toScVal: jest.fn().mockReturnValue({}) }),
    // scValToNative is called in allowance_checker.ts to decode the i128 return value
    scValToNative: (...args: unknown[]) => mockScValToNative(...args),
    xdr: {},
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount:          mockGetAccount,
        simulateTransaction: mockSimulateTx,
      })),
      Api: {
        isSimulationError,
        isSimulationSuccess,
      },
    },
  };
});

import { SorobanRpc } from '@stellar/stellar-sdk';
import { checkAllowance, formatAllowance } from './allowance_checker';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

/** 56-char G-address (valid StrKey format for tests) */
const SUBSCRIBER = 'G' + 'A'.repeat(55);
/** 56-char C-address for the token contract */
const TOKEN      = 'C' + 'A'.repeat(55);
/** 56-char C-address for the SorobanPay contract (spender) */
const CONTRACT   = 'C' + 'B'.repeat(55);

const BASE_PARAMS = {
  subscriberAddress: SUBSCRIBER,
  tokenContractId:   TOKEN,
  contractId:        CONTRACT,
  requiredAmount:    1000n,
  rpcUrl:            'https://soroban-testnet.stellar.org',
  networkPassphrase: 'Test SDF Network ; September 2015',
};

// Helpers to cast Soroban type-guard functions to jest.Mock.
// The double cast (as unknown as jest.Mock) is required because these are
// typed as type predicates — a direct `as jest.Mock` cast is rejected by TS.
const mockIsSimError   = SorobanRpc.Api.isSimulationError   as unknown as jest.Mock;
const mockIsSimSuccess = SorobanRpc.Api.isSimulationSuccess as unknown as jest.Mock;

/** Convenience: helpers to control SorobanRpc.Api.isSimulation* */
function setSimSuccess(retval: unknown) {
  mockIsSimError.mockReturnValue(false);
  mockIsSimSuccess.mockReturnValue(true);
  mockSimulateTx.mockResolvedValue({ result: { retval } });
}

function setSimError(msg: string) {
  mockIsSimError.mockReturnValue(true);
  mockIsSimSuccess.mockReturnValue(false);
  mockSimulateTx.mockResolvedValue({ error: msg });
}

function setSimUnexpected() {
  mockIsSimError.mockReturnValue(false);
  mockIsSimSuccess.mockReturnValue(false);
  mockSimulateTx.mockResolvedValue({});
}

beforeEach(() => {
  mockGetAccount.mockResolvedValue({ id: SUBSCRIBER, sequence: '0' });
});

afterEach(() => jest.clearAllMocks());

// ─── 1. Input validation ───────────────────────────────────────────────────────

describe('checkAllowance: input validation', () => {
  it('throws for an invalid subscriber address (not G-address)', async () => {
    await expect(
      checkAllowance({ ...BASE_PARAMS, subscriberAddress: 'notastellaraddr' }),
    ).rejects.toThrow(/invalid subscriber address/i);
  });

  it('throws for a C-address used as subscriber', async () => {
    await expect(
      checkAllowance({ ...BASE_PARAMS, subscriberAddress: CONTRACT }),
    ).rejects.toThrow(/invalid subscriber address/i);
  });

  it('throws for an invalid token contract address (not C-address)', async () => {
    await expect(
      checkAllowance({ ...BASE_PARAMS, tokenContractId: SUBSCRIBER }),
    ).rejects.toThrow(/invalid token contract address/i);
  });

  it('throws for an empty token contract address', async () => {
    await expect(
      checkAllowance({ ...BASE_PARAMS, tokenContractId: '' }),
    ).rejects.toThrow(/invalid token contract address/i);
  });

  it('throws for an invalid SorobanPay contract address (not C-address)', async () => {
    await expect(
      checkAllowance({ ...BASE_PARAMS, contractId: SUBSCRIBER }),
    ).rejects.toThrow(/invalid SorobanPay contract address/i);
  });

  it('throws for a negative requiredAmount', async () => {
    await expect(
      checkAllowance({ ...BASE_PARAMS, requiredAmount: -1n }),
    ).rejects.toThrow(/requiredAmount must be non-negative/i);
  });

  it('rejects before making any network call for a bad address', async () => {
    // If validation fires first, getAccount is never called
    await expect(
      checkAllowance({ ...BASE_PARAMS, subscriberAddress: 'BAD' }),
    ).rejects.toThrow(/invalid subscriber address/i);
    expect(mockGetAccount).not.toHaveBeenCalled();
  });
});

// ─── 2. Happy path — sufficient allowance ─────────────────────────────────────

describe('checkAllowance: sufficient allowance', () => {
  it('returns sufficient=true and shortfall=0 when allowance >= required', async () => {
    mockScValToNative.mockReturnValue(5000n); // 5000 > 1000 required
    setSimSuccess({});

    const result = await checkAllowance({ ...BASE_PARAMS, requiredAmount: 1000n });
    expect(result.sufficient).toBe(true);
    expect(result.shortfall).toBe(0n);
    expect(result.allowance).toBe(5000n);
  });

  it('calls simulateTransaction with the token allowance call', async () => {
    mockScValToNative.mockReturnValue(2000n);
    setSimSuccess({});

    await checkAllowance(BASE_PARAMS);
    expect(mockSimulateTx).toHaveBeenCalledTimes(1);
  });

  it('fetches the source account before simulating', async () => {
    mockScValToNative.mockReturnValue(2000n);
    setSimSuccess({});

    await checkAllowance(BASE_PARAMS);
    expect(mockGetAccount).toHaveBeenCalledWith(SUBSCRIBER);
  });
});

// ─── 3. Insufficient allowance ────────────────────────────────────────────────

describe('checkAllowance: insufficient allowance', () => {
  it('returns sufficient=false when allowance < required', async () => {
    mockScValToNative.mockReturnValue(200n); // 200 < 1000 required
    setSimSuccess({});

    const result = await checkAllowance({ ...BASE_PARAMS, requiredAmount: 1000n });
    expect(result.sufficient).toBe(false);
  });

  it('computes shortfall = required - allowance', async () => {
    mockScValToNative.mockReturnValue(300n);
    setSimSuccess({});

    const result = await checkAllowance({ ...BASE_PARAMS, requiredAmount: 1000n });
    expect(result.shortfall).toBe(700n); // 1000 - 300
  });

  it('returns the correct raw allowance', async () => {
    mockScValToNative.mockReturnValue(50n);
    setSimSuccess({});

    const result = await checkAllowance({ ...BASE_PARAMS, requiredAmount: 1000n });
    expect(result.allowance).toBe(50n);
  });
});

// ─── 4. Zero allowance ────────────────────────────────────────────────────────

describe('checkAllowance: zero allowance edge case', () => {
  it('returns sufficient=false and shortfall=requiredAmount when allowance is 0', async () => {
    mockScValToNative.mockReturnValue(0n);
    setSimSuccess({});

    const result = await checkAllowance({ ...BASE_PARAMS, requiredAmount: 1000n });
    expect(result.sufficient).toBe(false);
    expect(result.shortfall).toBe(1000n);
    expect(result.allowance).toBe(0n);
  });

  it('returns sufficient=true when requiredAmount is also 0', async () => {
    mockScValToNative.mockReturnValue(0n);
    setSimSuccess({});

    const result = await checkAllowance({ ...BASE_PARAMS, requiredAmount: 0n });
    expect(result.sufficient).toBe(true);
    expect(result.shortfall).toBe(0n);
  });

  it('clamps negative raw i128 allowance to 0 (defensive guard)', async () => {
    // A well-behaved SEP-41 token never returns a negative allowance, but
    // we clamp defensively to avoid surprising callers.
    mockScValToNative.mockReturnValue(-5n);
    setSimSuccess({});

    const result = await checkAllowance({ ...BASE_PARAMS, requiredAmount: 10n });
    expect(result.allowance).toBe(0n);
    expect(result.sufficient).toBe(false);
  });
});

// ─── 5. Boundary: allowance exactly equal to required ─────────────────────────

describe('checkAllowance: allowance exactly equals required amount', () => {
  it('returns sufficient=true when allowance === requiredAmount', async () => {
    mockScValToNative.mockReturnValue(1000n);
    setSimSuccess({});

    const result = await checkAllowance({ ...BASE_PARAMS, requiredAmount: 1000n });
    expect(result.sufficient).toBe(true);
    expect(result.shortfall).toBe(0n);
  });
});

// ─── 6. Simulation error ──────────────────────────────────────────────────────

describe('checkAllowance: simulation error', () => {
  it('throws with a descriptive message when simulation returns an error', async () => {
    setSimError('contract not found');

    await expect(checkAllowance(BASE_PARAMS)).rejects.toThrow(
      /simulation failed.*contract not found/i,
    );
  });

  it('throws when the RPC call itself rejects (network failure)', async () => {
    mockIsSimError.mockReturnValue(false);
    mockIsSimSuccess.mockReturnValue(false);
    mockSimulateTx.mockRejectedValue(new Error('fetch failed'));

    await expect(checkAllowance(BASE_PARAMS)).rejects.toThrow(/fetch failed/i);
  });
});

// ─── 7. Unexpected simulation result ─────────────────────────────────────────

describe('checkAllowance: unexpected simulation result', () => {
  it('throws when result is neither success nor error', async () => {
    setSimUnexpected();

    await expect(checkAllowance(BASE_PARAMS)).rejects.toThrow(
      /unexpected simulation result/i,
    );
  });

  it('throws when simulation result has no `result` field', async () => {
    mockIsSimError.mockReturnValue(false);
    mockIsSimSuccess.mockReturnValue(true);
    mockSimulateTx.mockResolvedValue({ result: undefined });

    await expect(checkAllowance(BASE_PARAMS)).rejects.toThrow(
      /no result value/i,
    );
  });
});

// ─── 8. Non-bigint retval ─────────────────────────────────────────────────────

describe('checkAllowance: unexpected retval type from scValToNative', () => {
  it('throws when scValToNative returns a number instead of bigint', async () => {
    mockScValToNative.mockReturnValue(1000); // number, not bigint
    setSimSuccess({});

    await expect(checkAllowance(BASE_PARAMS)).rejects.toThrow(
      /expected i128 \(bigint\)/i,
    );
  });

  it('throws when scValToNative returns a string', async () => {
    mockScValToNative.mockReturnValue('1000');
    setSimSuccess({});

    await expect(checkAllowance(BASE_PARAMS)).rejects.toThrow(
      /expected i128 \(bigint\)/i,
    );
  });
});

// ─── 9. formatAllowance helper ────────────────────────────────────────────────

describe('formatAllowance', () => {
  it('returns raw integer string when no decimals specified', () => {
    expect(formatAllowance(500n)).toBe('500');
  });

  it('returns raw integer string when decimals is 0', () => {
    expect(formatAllowance(12345n, 0)).toBe('12345');
  });

  it('formats with 7 decimal places (SEP-41 stroop convention)', () => {
    expect(formatAllowance(10_000_000n, 7)).toBe('1.0000000');
  });

  it('formats a fractional amount correctly', () => {
    // 1_234_567 stroops = 0.1234567 tokens (7 decimals)
    expect(formatAllowance(1_234_567n, 7)).toBe('0.1234567');
  });

  it('pads leading zeros in the fractional part', () => {
    // 7 stroops = 0.0000007 tokens (7 decimals)
    expect(formatAllowance(7n, 7)).toBe('0.0000007');
  });

  it('handles zero value', () => {
    expect(formatAllowance(0n, 7)).toBe('0.0000000');
  });

  it('handles large amounts (> 10^18)', () => {
    const large = 1_000_000_000_000_000_000_000_000n; // 10^24
    // With 7 decimals: 10^24 / 10^7 = 10^17 whole, 0 fraction
    const result = formatAllowance(large, 7);
    expect(result).toBe('100000000000000000.0000000');
  });
});
