/**
 * transaction_builder.timeout.test.ts
 *
 * Verifies that buildAndSubmitSubscribe throws a timeout error when
 * pollForConfirmation exhausts MAX_POLL_ATTEMPTS (60) NOT_FOUND responses.
 */

// Mock @stellar/stellar-sdk before importing the module under test
jest.mock('@stellar/stellar-sdk', () => {
  const NOT_FOUND = 'NOT_FOUND';

  const mockServer = {
    getAccount: jest.fn().mockResolvedValue({ id: 'GPUBKEY', sequence: '0' }),
    // simulateTransaction used by checkAllowance — return a successful allowance sim
    simulateTransaction: jest.fn().mockResolvedValue({ result: { retval: {} } }),
    prepareTransaction: jest.fn().mockResolvedValue({ toXDR: () => 'MOCK_XDR' }),
    sendTransaction: jest.fn().mockResolvedValue({ status: 'PENDING', hash: 'testhash123' }),
    getTransaction: jest.fn().mockResolvedValue({ status: NOT_FOUND }),
  };

  return {
    Contract: jest.fn().mockReturnValue({
      call: jest.fn().mockReturnValue({}),
    }),
    TransactionBuilder: jest.fn().mockReturnValue({
      addOperation: jest.fn().mockReturnThis(),
      setTimeout: jest.fn().mockReturnThis(),
      build: jest.fn().mockReturnValue({ toXDR: () => 'MOCK_XDR' }),
      fromXDR: jest.fn().mockReturnValue({}),
    }),
    BASE_FEE: '100',
    nativeToScVal: jest.fn().mockReturnValue({}),
    Address: jest.fn().mockReturnValue({ toScVal: jest.fn().mockReturnValue({}) }),
    // scValToNative is called by checkAllowance to decode the i128 allowance
    scValToNative: jest.fn().mockReturnValue(9999999n),
    xdr: {},
    SorobanRpc: {
      Server: jest.fn().mockReturnValue(mockServer),
      Api: {
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED', NOT_FOUND },
        // checkAllowance uses these type-guards to inspect the simulation result
        isSimulationError:   jest.fn().mockReturnValue(false),
        isSimulationSuccess: jest.fn().mockReturnValue(true),
      },
    },
  };
});

jest.mock('@/lib/wallet_manager', () => ({
  signTx: jest.fn().mockResolvedValue('SIGNED_XDR'),
}));

// Also need TransactionBuilder.fromXDR as a static method
import { TransactionBuilder, SorobanRpc } from '@stellar/stellar-sdk';
(TransactionBuilder as any).fromXDR = jest.fn().mockReturnValue({});

import { buildAndSubmitSubscribe } from '@/lib/transaction_builder';

const VALID_PARAMS = {
  subscriber: 'G' + 'A'.repeat(55),
  merchant:   'G' + 'B'.repeat(55),
  token:      'C' + 'A'.repeat(55),
  amount: 100,
  interval: 86400,
};

describe('buildAndSubmitSubscribe – timeout', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('throws timeout error after MAX_POLL_ATTEMPTS NOT_FOUND responses', async () => {
    // Catch early to prevent unhandled rejection while timers run
    let caughtError: { rawMessage?: string; message?: string } | null = null;
    const promise = buildAndSubmitSubscribe(
      VALID_PARAMS,
      'C' + 'A'.repeat(55),   // valid 56-char C-address
      VALID_PARAMS.subscriber,
      'Test SDF Network ; September 2015',
      'https://soroban-testnet.stellar.org',
    ).catch((e: unknown) => { caughtError = e as { rawMessage?: string; message?: string }; });

    // Advance through all 60 poll iterations (each sleeps 1000ms)
    await jest.runAllTimersAsync();
    await promise;

    expect(caughtError).not.toBeNull();
    // normalizeRpcError returns a NormalizedRpcError object — the timeout
    // message is in rawMessage, not message.
    expect(caughtError!.rawMessage).toMatch(/timeout/i);
  });
});
