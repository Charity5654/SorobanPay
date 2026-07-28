/**
 * transaction_builder.rpc-failures.test.ts
 *
 * Verifies that buildAndSubmitSubscribe surfaces clear error messages when
 * the Soroban RPC layer fails at two distinct stages:
 *   1. prepareTransaction  — simulation / resource-fee injection failure
 *   2. sendTransaction     — submission failure (ERROR status)
 */

// ─── Shared mock fixtures ──────────────────────────────────────────────────────

const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const NOT_FOUND = 'NOT_FOUND';
  return {
    Contract: jest.fn().mockReturnValue({
      call: jest.fn().mockReturnValue({}),
    }),
    TransactionBuilder: Object.assign(
      jest.fn().mockReturnValue({
        addOperation: jest.fn().mockReturnThis(),
        setTimeout: jest.fn().mockReturnThis(),
        build: jest.fn().mockReturnValue({ toXDR: () => 'MOCK_XDR' }),
      }),
      { fromXDR: jest.fn().mockReturnValue({}) },
    ),
    BASE_FEE: '100',
    nativeToScVal: jest.fn().mockReturnValue({}),
    Address: jest.fn().mockReturnValue({ toScVal: jest.fn().mockReturnValue({}) }),
    xdr: {},
    SorobanRpc: {
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        prepareTransaction: mockPrepareTransaction,
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
      })),
      Api: {
        GetTransactionStatus: { SUCCESS: 'SUCCESS', FAILED: 'FAILED', NOT_FOUND },
      },
    },
  };
});

jest.mock('@/lib/wallet_manager', () => ({
  signTx: jest.fn().mockResolvedValue('SIGNED_XDR'),
}));

import { buildAndSubmitSubscribe } from './transaction_builder';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const VALID_PARAMS = {
  subscriber: 'G' + 'A'.repeat(55),
  merchant:   'G' + 'B'.repeat(55),
  token:      'C' + 'A'.repeat(55),
  amount: 100,
  interval: 86400,
};
const CONTRACT_ID        = 'C' + 'A'.repeat(55);
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const RPC_URL            = 'https://soroban-testnet.stellar.org';

function callBuilder() {
  return buildAndSubmitSubscribe(
    VALID_PARAMS,
    CONTRACT_ID,
    VALID_PARAMS.subscriber,
    NETWORK_PASSPHRASE,
    RPC_URL,
  );
}

// ─── prepareTransaction failures ──────────────────────────────────────────────

describe('buildAndSubmitSubscribe – prepareTransaction RPC failure', () => {
  beforeEach(() => {
    mockGetAccount.mockResolvedValue({ id: VALID_PARAMS.subscriber, sequence: '0' });
  });

  afterEach(() => jest.clearAllMocks());

  it('wraps a prepareTransaction network error with a descriptive message', async () => {
    mockPrepareTransaction.mockRejectedValueOnce(new Error('Network request failed'));

    await expect(callBuilder()).rejects.toThrow(/transaction preparation failed/i);
  });

  it('includes the original error text in the thrown message', async () => {
    mockPrepareTransaction.mockRejectedValueOnce(new Error('simulation error: resource exhausted'));

    await expect(callBuilder()).rejects.toThrow(/simulation error: resource exhausted/i);
  });

  it('wraps a non-Error rejection (string) from prepareTransaction', async () => {
    mockPrepareTransaction.mockRejectedValueOnce('RPC 503 Service Unavailable');

    await expect(callBuilder()).rejects.toThrow(/transaction preparation failed/i);
  });
});

// ─── sendTransaction failures ─────────────────────────────────────────────────

describe('buildAndSubmitSubscribe – sendTransaction RPC failure', () => {
  beforeEach(() => {
    mockGetAccount.mockResolvedValue({ id: VALID_PARAMS.subscriber, sequence: '0' });
    mockPrepareTransaction.mockResolvedValue({ toXDR: () => 'PREPARED_XDR' });
  });

  afterEach(() => jest.clearAllMocks());

  it('throws when sendTransaction returns status ERROR', async () => {
    mockSendTransaction.mockResolvedValueOnce({
      status: 'ERROR',
      errorResult: null,
    });

    await expect(callBuilder()).rejects.toThrow(/transaction submission failed/i);
  });

  it('includes XDR in the error when errorResult is present', async () => {
    mockSendTransaction.mockResolvedValueOnce({
      status: 'ERROR',
      errorResult: { toXDR: () => 'AAAA_ERROR_XDR==' },
    });

    await expect(callBuilder()).rejects.toThrow(/AAAA_ERROR_XDR==/);
  });

  it('falls back to "unknown error" text when errorResult is null', async () => {
    mockSendTransaction.mockResolvedValueOnce({ status: 'ERROR', errorResult: null });

    await expect(callBuilder()).rejects.toThrow(/unknown error/i);
  });

  it('throws when sendTransaction itself rejects (network-level error)', async () => {
    mockSendTransaction.mockRejectedValueOnce(new Error('fetch failed'));

    await expect(callBuilder()).rejects.toThrow(/fetch failed/i);
  });
});
