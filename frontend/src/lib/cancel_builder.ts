/**
 * cancel_builder.ts
 *
 * Builds, signs, and submits the `cancel` contract call for SorobanPay.
 *
 * Mirrors the buildAndSubmitSubscribe pattern in transaction_builder.ts.
 */

import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Address,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { signTx } from './wallet_manager';

export interface CancelParams {
  /** Subscriber Stellar G-address (the signer) */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
}

export interface CancelResult {
  txHash: string;
}

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 60;

/**
 * Build, sign, and submit a `cancel` transaction to the SorobanPay contract.
 *
 * @param params            Subscriber and merchant addresses
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Subscriber's connected public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 */
export async function buildAndSubmitCancel(
  params: CancelParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<CancelResult> {
  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // 1. Fetch account
  const account = await server.getAccount(publicKey);

  // 2. Build transaction
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'cancel',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  // 3. Prepare (simulate + inject resource fees)
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  // 4. Sign with Freighter
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  // 5. Submit
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(parsedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
    );
  }

  // 6. Poll for confirmation
  const txHash = await pollForConfirmation(server, sendResult.hash);
  return { txHash };
}

async function pollForConfirmation(
  server: SorobanRpc.Server,
  hash: string,
): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);
    const result = await server.getTransaction(hash);

    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }
    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      const meta = (result as SorobanRpc.Api.GetFailedTransactionResponse).resultMetaXdr;
      throw new Error(`Transaction failed on-chain: ${meta ?? 'no result meta available'}`);
    }
  }
  throw new Error(
    `Transaction confirmation timeout after ${MAX_POLL_ATTEMPTS} seconds. Hash: ${hash}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
