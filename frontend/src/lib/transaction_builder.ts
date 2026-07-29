/**
 * transaction_builder.ts
 *
 * Builds, signs, and submits Soroban transactions for the SorobanPay protocol.
 *
 * Flow:
 *   1. Fetch account sequence number from Soroban RPC
 *   2. Build transaction with contract call
 *   3. prepareTransaction (simulates and fills resource fees)
 *   4. Sign with Freighter via signTx()
 *   5. Submit and poll for confirmation (up to 60 seconds)
 *
 * Exported builders:
 *   - buildAndSubmitSubscribe      — subscriber creates/updates a subscription
 *   - buildAndSubmitExecutePayment — merchant collects a single due payment
 *   - buildAndSubmitBatchExecutePayment — merchant collects multiple due payments
 */

import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { signTx } from './wallet_manager';
import { isValidCAddress, isValidGAddress } from './validation';

// ── Types ─────────────────────────────────────────────────────────────────────

/** Parameters for creating a new subscription */
export interface SubscribeParams {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** Token contract C-address */
  token: string;
  /** Payment amount as a positive integer (in token's smallest unit) */
  amount: number;
  /** Payment interval in seconds [86400, 31536000] */
  interval: number;
}

/** Result of a successful subscription transaction */
export interface SubscribeResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/**
 * Parameters for a merchant-initiated payment collection.
 * The merchant must be the signer (publicKey) of this transaction.
 */
export interface ExecutePaymentParams {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address — must match the connected wallet */
  merchant: string;
}

/** Result of a successful execute_payment transaction */
export interface ExecutePaymentResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/**
 * One entry in a batch payment collection request.
 * Each entry targets a distinct (subscriber, merchant) pair.
 */
export interface BatchPaymentEntry {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
}

/**
 * Result of a batch execute_payment transaction.
 * All entries are submitted as separate transactions and results are
 * reported per-entry so partial success is visible to the UI.
 */
export interface BatchExecutePaymentResult {
  /** Per-entry results in the same order as the input entries array */
  results: Array<{
    subscriber: string;
    merchant: string;
    /** Transaction hash when the individual collection succeeded */
    txHash?: string;
    /** Error message when the individual collection failed */
    error?: string;
  }>;
  /** Number of successfully collected payments */
  successCount: number;
  /** Number of failed payment attempts */
  failureCount: number;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const POLL_INTERVAL_MS = 1_000;
const MAX_POLL_ATTEMPTS = 60; // 60 seconds total

// ── Main function ─────────────────────────────────────────────────────────────

/**
 * Build, sign, and submit a `subscribe` transaction to the SorobanPay contract.
 *
 * @param params            Subscription parameters
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On any failure: construction, signing, submission, or timeout
 */
export async function buildAndSubmitSubscribe(
  params: SubscribeParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string
): Promise<SubscribeResult> {
  // 0. Validate addresses before making any network calls
  if (!isValidGAddress(params.subscriber)) {
    throw new Error(`Invalid subscriber address: ${params.subscriber}`);
  }
  if (!isValidGAddress(params.merchant)) {
    throw new Error(`Invalid merchant address: ${params.merchant}`);
  }
  if (!isValidCAddress(params.token)) {
    throw new Error(`Invalid token contract address: ${params.token}`);
  }

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
        'subscribe',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
        new Address(params.token).toScVal(),
        nativeToScVal(BigInt(params.amount), { type: 'i128' }),
        nativeToScVal(BigInt(params.interval), { type: 'u64' })
      )
    )
    .setTimeout(30)
    .build();

  // 3. Prepare transaction (simulation + resource fee injection)
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
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`
    );
  }

  // 6. Poll for confirmation
  const txHash = await pollForConfirmation(server, sendResult.hash);

  return { txHash };
}

// ── Polling helper ────────────────────────────────────────────────────────────

async function pollForConfirmation(
  server: SorobanRpc.Server,
  hash: string
): Promise<string> {
  for (let attempt = 0; attempt < MAX_POLL_ATTEMPTS; attempt++) {
    await sleep(POLL_INTERVAL_MS);

    const result = await server.getTransaction(hash);

    if (result.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return hash;
    }

    if (result.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      const meta = (result as SorobanRpc.Api.GetFailedTransactionResponse).resultMetaXdr;
      throw new Error(
        `Transaction failed on-chain: ${meta ?? 'no result meta available'}`
      );
    }

    // status === NOT_FOUND — still in mempool, continue polling
  }

  throw new Error(
    `Transaction confirmation timeout after ${MAX_POLL_ATTEMPTS} seconds. Hash: ${hash}`
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── execute_payment builder ───────────────────────────────────────────────────

/**
 * Build, sign, and submit an `execute_payment` transaction.
 *
 * The connected merchant wallet must authorize this call. The contract verifies
 * that `merchant == require_auth()` signer and that the payment interval has
 * elapsed (`now >= next_payment`).
 *
 * @param params            Subscriber and merchant addresses
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected merchant's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On validation failure, signing rejection, or RPC errors
 */
export async function buildAndSubmitExecutePayment(
  params: ExecutePaymentParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<ExecutePaymentResult> {
  // Validate before any network calls
  if (!isValidGAddress(params.subscriber)) {
    throw new Error(`Invalid subscriber address: ${params.subscriber}`);
  }
  if (!isValidGAddress(params.merchant)) {
    throw new Error(`Invalid merchant address: ${params.merchant}`);
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // Fetch account sequence for the signer (merchant)
  const account = await server.getAccount(publicKey);

  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'execute_payment',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  // Simulate + inject resource fees
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await server.prepareTransaction(tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  // Sign with Freighter
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  // Submit
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  const sendResult = await server.sendTransaction(parsedTx);

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
    );
  }

  const txHash = await pollForConfirmation(server, sendResult.hash);
  return { txHash };
}

// ── batch_execute_payment builder ─────────────────────────────────────────────

/**
 * Execute payment collection for multiple subscribers sequentially.
 *
 * Each entry is submitted as an independent `execute_payment` transaction.
 * Failures are captured per-entry and do not halt the batch — the UI can
 * show partial success with per-row error messages.
 *
 * Note: This is a client-side sequential batch. When the on-chain
 * `batch_execute_payment` entry point is deployed (SC-9), this function
 * should be updated to use a single multi-operation transaction for
 * atomicity and lower fee cost.
 *
 * @param entries           Array of (subscriber, merchant) pairs to collect from
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected merchant's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Per-entry results with success/failure breakdown
 */
export async function buildAndSubmitBatchExecutePayment(
  entries: BatchPaymentEntry[],
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<BatchExecutePaymentResult> {
  if (entries.length === 0) {
    return { results: [], successCount: 0, failureCount: 0 };
  }

  const results: BatchExecutePaymentResult['results'] = [];
  let successCount = 0;
  let failureCount = 0;

  for (const entry of entries) {
    try {
      const { txHash } = await buildAndSubmitExecutePayment(
        { subscriber: entry.subscriber, merchant: entry.merchant },
        contractId,
        publicKey,
        networkPassphrase,
        rpcUrl,
      );
      results.push({ subscriber: entry.subscriber, merchant: entry.merchant, txHash });
      successCount++;
    } catch (err: unknown) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ subscriber: entry.subscriber, merchant: entry.merchant, error });
      failureCount++;
    }
  }

  return { results, successCount, failureCount };
}
