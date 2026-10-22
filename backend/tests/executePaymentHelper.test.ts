import { Keypair, Networks, rpc as SorobanRpc } from '@stellar/stellar-sdk';
import {
  ExecutePaymentHelperError,
  submitExecutePayment,
} from '../src/services/executePaymentHelper';

describe('submitExecutePayment', () => {
  const validSubscriber = 'GBQ6H5JY7H5H5KQK6XH3YJQF7J5D5J7SHB4Y5S3V2KHLHDXTV6QYQ5X';
  const validMerchant = 'GCGS5Y7JH3TXQ7H4B6HQX7K7K4MZ6U7V6DY5Q7JQH2R2X37Y5J4V2D2';

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects invalid Stellar addresses before contacting the RPC server', async () => {
    const server = {
      getAccount: jest.fn(),
    } as any;

    await expect(
      submitExecutePayment(
        { subscriber: 'invalid', merchant: validMerchant },
        {
          server,
          contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
          signer: Keypair.random(),
          networkPassphrase: Networks.TESTNET,
        },
      ),
    ).rejects.toBeInstanceOf(ExecutePaymentHelperError);

    expect(server.getAccount).not.toHaveBeenCalled();
  });

  it('returns the transaction hash after successful simulation and confirmation', async () => {
    const signer = Keypair.random();
    const server = {
      getAccount: jest.fn().mockResolvedValue({ sequence: '1' }),
      simulateTransaction: jest.fn().mockResolvedValue({}),
      sendTransaction: jest.fn().mockResolvedValue({ status: 'PENDING', hash: 'abc123' }),
      getTransaction: jest.fn().mockResolvedValue({ status: SorobanRpc.Api.GetTransactionStatus.SUCCESS }),
    } as any;

    const preparedTx = { sign: jest.fn() };
    jest.spyOn(SorobanRpc, 'assembleTransaction').mockReturnValue({
      build: () => preparedTx,
    } as any);

    const result = await submitExecutePayment(
      { subscriber: validSubscriber, merchant: validMerchant },
      {
        server,
        contractId: 'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
        signer,
        networkPassphrase: Networks.TESTNET,
      },
    );

    expect(result).toEqual({ txHash: 'abc123' });
    expect(server.getAccount).toHaveBeenCalledWith(signer.publicKey());
    expect(server.simulateTransaction).toHaveBeenCalledTimes(1);
    expect(preparedTx.sign).toHaveBeenCalledWith(signer);
    expect(server.sendTransaction).toHaveBeenCalledWith(preparedTx);
  });
});
