/**
 * cancel_builder.test.ts
 *
 * Unit tests for buildAndSubmitCancel.
 * Mocks the SorobanRpc.Server and wallet_manager to verify the happy path
 * and error paths without making real network calls.
 */

import { buildAndSubmitCancel } from '@/lib/cancel_builder';

// ── Mocks ──────────────────────────────────────────────────────────────────

const mockGetAccount = jest.fn();
const mockPrepareTransaction = jest.fn();
const mockSendTransaction = jest.fn();
const mockGetTransaction = jest.fn();

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

const mockSignTx = jest.fn();
jest.mock('@/lib/wallet_manager', () => ({
  signTx: (...args: unknown[]) => mockSignTx(...args),
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const CONTRACT_ID      = 'C' + 'A'.repeat(55);
const SUBSCRIBER       = 'G' + 'A'.repeat(55);
const MERCHANT         = 'G' + 'B'.repeat(55);
const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';
const RPC_URL          = 'https://soroban-testnet.stellar.org';
const TX_HASH          = 'deadbeef'.repeat(8);

function mockAccountSequence() {
  mockGetAccount.mockResolvedValue({
    id: SUBSCRIBER,
    sequenceNumber: () => '1000',
    incrementSequenceNumber: () => {},
    accountId: () => SUBSCRIBER,
    sequence: '1000',
  });
}

function mockPrepare() {
  mockPrepareTransaction.mockImplementation((tx: { toXDR: () => string }) => ({
    toXDR: () => tx.toXDR(),
  }));
}

function mockSign() {
  mockSignTx.mockResolvedValue('signedXDR');
}

function mockSend(status = 'PENDING') {
  mockSendTransaction.mockResolvedValue({ status, hash: TX_HASH });
}

function mockPoll(status: string, count = 1) {
  for (let i = 0; i < count; i++) {
    mockGetTransaction.mockResolvedValueOnce({ status: 'NOT_FOUND' });
  }
  mockGetTransaction.mockResolvedValueOnce({ status });
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('buildAndSubmitCancel – happy path', () => {
  beforeEach(() => {
    mockGetAccount.mockReset();
    mockPrepareTransaction.mockReset();
    mockSendTransaction.mockReset();
    mockGetTransaction.mockReset();
    mockSignTx.mockReset();

    mockAccountSequence();
    mockPrepare();
    mockSign();
    mockSend('PENDING');
    mockPoll('SUCCESS');
  });

  it('returns txHash on successful cancel', async () => {
    const result = await buildAndSubmitCancel(
      { subscriber: SUBSCRIBER, merchant: MERCHANT },
      CONTRACT_ID,
      SUBSCRIBER,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    expect(result.txHash).toBe(TX_HASH);
  });

  it('calls signTx with the network passphrase', async () => {
    await buildAndSubmitCancel(
      { subscriber: SUBSCRIBER, merchant: MERCHANT },
      CONTRACT_ID,
      SUBSCRIBER,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    expect(mockSignTx).toHaveBeenCalledWith(expect.any(String), NETWORK_PASSPHRASE);
  });

  it('polls until SUCCESS status', async () => {
    mockGetTransaction.mockReset();
    mockGetTransaction
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'NOT_FOUND' })
      .mockResolvedValueOnce({ status: 'SUCCESS' });

    const result = await buildAndSubmitCancel(
      { subscriber: SUBSCRIBER, merchant: MERCHANT },
      CONTRACT_ID,
      SUBSCRIBER,
      NETWORK_PASSPHRASE,
      RPC_URL,
    );
    expect(result.txHash).toBe(TX_HASH);
    expect(mockGetTransaction).toHaveBeenCalledTimes(3);
  });
});

describe('buildAndSubmitCancel – error paths', () => {
  beforeEach(() => {
    mockGetAccount.mockReset();
    mockPrepareTransaction.mockReset();
    mockSendTransaction.mockReset();
    mockGetTransaction.mockReset();
    mockSignTx.mockReset();
  });

  it('throws when prepareTransaction fails', async () => {
    mockAccountSequence();
    mockPrepareTransaction.mockRejectedValue(new Error('Simulation failed'));
    mockSign();

    await expect(
      buildAndSubmitCancel(
        { subscriber: SUBSCRIBER, merchant: MERCHANT },
        CONTRACT_ID,
        SUBSCRIBER,
        NETWORK_PASSPHRASE,
        RPC_URL,
      ),
    ).rejects.toThrow(/Transaction preparation failed/);
  });

  it('throws when sendTransaction returns ERROR status', async () => {
    mockAccountSequence();
    mockPrepare();
    mockSign();
    mockSendTransaction.mockResolvedValue({ status: 'ERROR', errorResult: null });

    await expect(
      buildAndSubmitCancel(
        { subscriber: SUBSCRIBER, merchant: MERCHANT },
        CONTRACT_ID,
        SUBSCRIBER,
        NETWORK_PASSPHRASE,
        RPC_URL,
      ),
    ).rejects.toThrow(/Transaction submission failed/);
  });

  it('throws when on-chain transaction FAILED', async () => {
    mockAccountSequence();
    mockPrepare();
    mockSign();
    mockSend('PENDING');
    mockGetTransaction.mockResolvedValue({ status: 'FAILED', resultMetaXdr: 'meta' });

    await expect(
      buildAndSubmitCancel(
        { subscriber: SUBSCRIBER, merchant: MERCHANT },
        CONTRACT_ID,
        SUBSCRIBER,
        NETWORK_PASSPHRASE,
        RPC_URL,
      ),
    ).rejects.toThrow(/Transaction failed on-chain/);
  });
});
