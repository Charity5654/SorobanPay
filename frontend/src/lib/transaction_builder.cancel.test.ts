/**
 * Regression tests for the shared cancel transaction builder.
 * Ensures the central transaction_builder exposes the cancel flow and validates
 * subscriber/merchant addresses before any RPC call is attempted.
 */

import { buildAndSubmitCancel } from './transaction_builder';

const VALID_G = 'G' + 'A'.repeat(55);
const CONTRACT_ID = 'C' + 'A'.repeat(55);
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const RPC_URL = 'https://soroban-testnet.stellar.org';

const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();
const mockSignTx = jest.fn();

jest.mock('@stellar/stellar-sdk', () => {
  const actual = jest.requireActual('@stellar/stellar-sdk');
  return {
    ...actual,
    SorobanRpc: {
      ...actual.SorobanRpc,
      Server: jest.fn().mockImplementation(() => ({
        getAccount: mockGetAccount,
        prepareTransaction: mockPrepareTransaction,
        sendTransaction: mockSendTransaction,
        getTransaction: mockGetTransaction,
      })),
      Api: {
        ...actual.SorobanRpc.Api,
        GetTransactionStatus: {
          SUCCESS: 'SUCCESS',
          FAILED: 'FAILED',
          NOT_FOUND: 'NOT_FOUND',
        },
      },
    },
  };
});

jest.mock('@/lib/wallet_manager', () => ({
  signTx: (...args: unknown[]) => mockSignTx(...args),
}));

describe('transaction_builder cancel flow', () => {
  beforeEach(() => {
    mockGetAccount.mockReset();
    mockPrepareTransaction.mockReset();
    mockSendTransaction.mockReset();
    mockGetTransaction.mockReset();
    mockSignTx.mockReset();

    mockGetAccount.mockResolvedValue({
      id: VALID_G,
      sequenceNumber: () => '1000',
      incrementSequenceNumber: () => {},
      accountId: () => VALID_G,
      sequence: '1000',
    });
    mockPrepareTransaction.mockImplementation((tx: { toXDR: () => string }) => ({
      toXDR: () => tx.toXDR(),
    }));
    mockSignTx.mockResolvedValue('signedXDR');
    mockSendTransaction.mockResolvedValue({ status: 'PENDING', hash: 'deadbeef'.repeat(8) });
    mockGetTransaction.mockResolvedValue({ status: 'SUCCESS' });
  });

  it('builds and submits cancel with the shared transaction builder', async () => {
    const result = await buildAndSubmitCancel(
      { subscriber: VALID_G, merchant: VALID_G, token: 'C' + 'A'.repeat(55) },
      CONTRACT_ID,
      VALID_G,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );

    expect(result.txHash).toBe('deadbeef'.repeat(8));
    expect(mockSignTx).toHaveBeenCalledWith(expect.any(String), NETWORK_PASSPHRASE);
  });

  it('rejects invalid addresses before RPC calls are made', async () => {
    await expect(
      buildAndSubmitCancel(
        { subscriber: 'BAD', merchant: VALID_G, token: 'C' + 'A'.repeat(55) },
        CONTRACT_ID,
        VALID_G,
        NETWORK_PASSPHRASE,
        RPC_URL,
      ),
    ).rejects.toThrow(/invalid subscriber address/i);
  });
});
