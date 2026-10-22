import {
  Address,
  BASE_FEE,
  Contract,
  type Keypair,
  rpc as SorobanRpc,
  TransactionBuilder,
} from '@stellar/stellar-sdk';
import {
  handleIdempotencyCheck,
  recordIdempotencySuccess,
  recordIdempotencyFailure,
  IdempotencyConflictError,
  type IdempotencyKeyParams,
} from './idempotencyService';

export interface ExecutePaymentParams {
  subscriber: string;
  merchant: string;
  /** Optional idempotency key for safe retries. If provided, enables idempotent behavior. */
  idempotencyKey?: string;
}

export interface ExecutePaymentOptions {
  server: SorobanRpc.Server;
  contractId: string;
  signer: Keypair;
  networkPassphrase: string;
}

export interface ExecutePaymentResult {
  txHash: string;
  /** Whether this result was from a cached idempotent retry */
  isRetry?: boolean;
}

export class ExecutePaymentHelperError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutePaymentHelperError';
  }
}

/**
 * Submit an execute_payment contract call and wait for on-chain confirmation.
 *
 * This helper centralizes the contract call construction, simulation, signing,
 * transaction submission, and confirmation polling used by the backend payment
 * scheduler and retry flow.
 *
 * Issue #1060: Supports optional idempotency keys for safe retries.
 * When idempotencyKey is provided:
 *  - First request: executes payment and caches result with txHash
 *  - Retry with same key & parameters: returns cached txHash
 *  - Retry with same key but different parameters: throws ConflictError
 */
export async function submitExecutePayment(
  params: ExecutePaymentParams,
  options: ExecutePaymentOptions,
): Promise<ExecutePaymentResult> {
  const { server, contractId, signer, networkPassphrase } = options;
  const { subscriber, merchant, idempotencyKey } = params;

  if (!subscriber || !merchant) {
    throw new ExecutePaymentHelperError('subscriber and merchant are required for execute_payment');
  }

  try {
    new Address(subscriber);
    new Address(merchant);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExecutePaymentHelperError(`Invalid execute_payment addresses: ${msg}`);
  }

  // Check idempotency if key provided (Issue #1060)
  if (idempotencyKey) {
    // Note: token and amount are typically extracted from subscription state,
    // but for this helper we use placeholder values for demonstration.
    // In production, these would come from querySubscription or contract state.
    const idempotencyParams: IdempotencyKeyParams = {
      idempotencyKey,
      subscriber,
      merchant,
      token: 'token_placeholder', // Would be fetched from subscription
      amount: 'amount_placeholder', // Would be fetched from subscription
    };

    try {
      const cachedResult = await handleIdempotencyCheck(idempotencyParams);
      if (cachedResult) {
        return {
          txHash: cachedResult.txHash,
          isRetry: cachedResult.isRetry,
        };
      }
    } catch (err) {
      if (err instanceof IdempotencyConflictError) {
        throw new ExecutePaymentHelperError(
          `Idempotency conflict: ${err.message}`,
        );
      }
      throw err;
    }
  }

  let account;
  try {
    account = await server.getAccount(signer.publicKey());
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new ExecutePaymentHelperError(`Failed to fetch signing account: ${msg}`);
  }

  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'execute_payment',
        new Address(subscriber).toScVal(),
        new Address(merchant).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  let simResult;
  try {
    simResult = await server.simulateTransaction(tx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (idempotencyKey) {
      // Record failure for idempotency tracking
      await recordIdempotencyFailure(
        {
          idempotencyKey,
          subscriber,
          merchant,
          token: 'token_placeholder',
          amount: 'amount_placeholder',
        },
        `Simulation failed: ${msg}`,
      ).catch(() => {}); // Ignore idempotency logging errors
    }
    throw new ExecutePaymentHelperError(`Simulation failed: ${msg}`);
  }

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    const detail = simResult.error ? String(simResult.error) : 'unknown simulation error';
    if (idempotencyKey) {
      await recordIdempotencyFailure(
        {
          idempotencyKey,
          subscriber,
          merchant,
          token: 'token_placeholder',
          amount: 'amount_placeholder',
        },
        `Simulation failed: ${detail}`,
      ).catch(() => {});
    }
    throw new ExecutePaymentHelperError(`Simulation failed: ${detail}`);
  }

  const preparedTx = SorobanRpc.assembleTransaction(tx, simResult).build();
  preparedTx.sign(signer);

  let sendResult;
  try {
    sendResult = await server.sendTransaction(preparedTx);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (idempotencyKey) {
      await recordIdempotencyFailure(
        {
          idempotencyKey,
          subscriber,
          merchant,
          token: 'token_placeholder',
          amount: 'amount_placeholder',
        },
        `Send failed: ${msg}`,
      ).catch(() => {});
    }
    throw new ExecutePaymentHelperError(`Send failed: ${msg}`);
  }

  if (sendResult.status === 'ERROR') {
    const detail = sendResult.errorResult ? JSON.stringify(sendResult.errorResult) : 'unknown error';
    if (idempotencyKey) {
      await recordIdempotencyFailure(
        {
          idempotencyKey,
          subscriber,
          merchant,
          token: 'token_placeholder',
          amount: 'amount_placeholder',
        },
        `Send failed: ${detail}`,
      ).catch(() => {});
    }
    throw new ExecutePaymentHelperError(`Send failed: ${detail}`);
  }

  const txHash = sendResult.hash;

  for (let i = 0; i < 20; i++) {
    await sleep(1500);
    const status = await server.getTransaction(txHash);

    if (status.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      // Record success for idempotency tracking (Issue #1060)
      if (idempotencyKey) {
        await recordIdempotencySuccess(
          {
            idempotencyKey,
            subscriber,
            merchant,
            token: 'token_placeholder',
            amount: 'amount_placeholder',
          },
          txHash,
        ).catch(() => {}); // Ignore idempotency logging errors
      }

      return { txHash, isRetry: false };
    }

    if (status.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      const detail = `Transaction failed on-chain: ${txHash}`;
      if (idempotencyKey) {
        await recordIdempotencyFailure(
          {
            idempotencyKey,
            subscriber,
            merchant,
            token: 'token_placeholder',
            amount: 'amount_placeholder',
          },
          detail,
        ).catch(() => {});
      }
      throw new ExecutePaymentHelperError(detail);
    }
  }

  const detail = `Transaction ${txHash} not confirmed after 30 s`;
  if (idempotencyKey) {
    await recordIdempotencyFailure(
      {
        idempotencyKey,
        subscriber,
        merchant,
        token: 'token_placeholder',
        amount: 'amount_placeholder',
      },
      detail,
    ).catch(() => {});
  }
  throw new ExecutePaymentHelperError(detail);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
