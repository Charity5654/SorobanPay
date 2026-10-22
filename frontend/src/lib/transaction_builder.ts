/**
 * transaction_builder.ts
 *
 * Builds, signs, and submits Soroban transactions for the SorobanPay protocol.
 *
 * Flow:
 *   1. Validate addresses (synchronous — throws before any network call)
 *   2. Check subscriber's token allowance via simulateTransaction (read-only)
 *   3. Fetch account sequence number from Soroban RPC
 *   4. Build transaction with `subscribe` contract call (including `strict` flag)
 *   5. prepareTransaction (simulates and fills resource fees)
 *   6. Sign with Freighter via signTx()
 *   7. Submit and poll for confirmation (up to 60 seconds)
 */

import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
  xdr,
  scValToNative,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import { signTx } from './wallet_manager';
import { assertValidGAddress, assertValidCAddress } from './validation';
import { normalizeRpcError } from './rpc_error_normalizer';
import { checkAllowance, type AllowanceResult } from './allowance_checker';
import { withBackoff, isRpcRetryable as isRetryable, getErrorMessage } from './backoff';

// Re-export NormalizedRpcError so callers can import from one place.
export type { NormalizedRpcError, RpcErrorCategory } from './rpc_error_normalizer';

// Re-export AllowanceResult for callers that want structured allowance data.
export type { AllowanceResult } from './allowance_checker';

// Re-export typed network API — callers can resolve network config here.
export { getNetworkConfig, NETWORK_CONFIGS } from './network_config';
export type { StellarNetwork, NetworkConfig } from './network_config';

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
  /**
   * When `true`, the on-chain `subscribe` call will reject with
   * `InsufficientAllowance` if the subscriber's current allowance is below
   * `amount`. When `false` (default) the contract emits a `low_allowance`
   * event instead of reverting, giving the subscriber time to approve more.
   *
   * The front-end performs its own pre-flight check via `checkAllowance`
   * regardless of this flag, and surfaces a warning to the user when the
   * allowance is insufficient. Set `strict = true` to also enforce the check
   * on-chain as a hard gate.
   */
  strict?: boolean;
}

/** Result of a successful subscription transaction */
export interface SubscribeResult {
  /** Transaction hash on Stellar network */
  txHash: string;
  /**
   * Allowance state at the time the transaction was submitted.
   * Populated from the pre-flight `checkAllowance` call.
   * `null` when the allowance check was skipped (e.g. test environments
   * where the RPC is unavailable before building).
   */
  allowanceCheck: AllowanceResult | null;
}

export interface CancelParams {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** Token contract C-address */
  token: string;
}

export interface CancelResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/** Parameters for collecting a recurring payment from a single subscriber */
export interface ExecutePaymentParams {
  /** Subscriber Stellar G-address (the account being charged) */
  subscriber: string;
  /** Merchant Stellar G-address (the account receiving payment) */
  merchant: string;
}

/** Result of a successful execute_payment transaction */
export interface ExecutePaymentResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/** A single entry in a batch payment collection request */
export interface BatchPaymentEntry {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
}

/** Per-entry result from a batch execute_payment run */
export interface BatchPaymentEntryResult {
  subscriber: string;
  merchant: string;
  /** Set on success */
  txHash?: string;
  /** Set on failure */
  error?: string;
}

/** Aggregate result returned by buildAndSubmitBatchExecutePayment */
export interface BatchExecutePaymentResult {
  /** Individual outcome per (subscriber, merchant) pair */
  results: BatchPaymentEntryResult[];
  /** Number of entries that succeeded */
  successCount: number;
  /** Number of entries that failed */
  failureCount: number;
}

/**
 * Intermediate result returned after the transaction is submitted but before
 * it has been confirmed. The caller should pass `txHash` and `server` to
 * `useTransactionPoller.startPolling()` to track the confirmation.
 */
export interface SubmitResult {
  /** Transaction hash (available immediately after sendTransaction) */
  txHash: string;
  /** The SorobanRpc.Server instance used ΓÇö pass to startPolling() */
  server: SorobanRpc.Server;
}

/** Parameters for executing a payment */
export interface ExecutePaymentParams {
  /** Subscriber Stellar G-address */
  subscriber: string;
  /** Merchant Stellar G-address (must match the signer) */
  merchant: string;
}

/** Result of a successful execute_payment transaction */
export interface ExecutePaymentResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/** One entry in a batch payment operation */
export interface BatchPaymentEntry {
  /** Subscriber address */
  subscriber: string;
  /** Merchant address */
  merchant: string;
}

/** Per-entry result for batch execute_payment */
export interface BatchPaymentResultEntry {
  subscriber: string;
  merchant: string;
  txHash?: string;
  error?: string;
}

/** Result of batch_execute_payment */
export interface BatchExecutePaymentResult {
  /** Per-entry results */
  results: BatchPaymentResultEntry[];
  /** Count of successful submissions */
  successCount: number;
  /** Count of failed submissions */
  failureCount: number;
}

// ΓöÇΓöÇ Phase 1: build, sign, and submit ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Build, sign, and submit a `subscribe` transaction with adaptive retry logic.
 *
 * Wraps RPC calls with exponential backoff and jitter:
 *   - getAccount: Retries up to 5 times over ~30s (transient network issues)
 *   - prepareTransaction: Retries up to 3 times over ~15s (mempool congestion)
 *   - sendTransaction: Retries up to 3 times over ~15s (rate limits, temporary RPC issues)
 *
 * Non-retryable errors (signing rejection, invalid addresses, contract errors)
 * are thrown immediately without retry.
 *
 * Returns the transaction hash and server instance as soon as the transaction
 * is accepted by the RPC (status !== 'ERROR'). The caller is responsible for
 * polling for confirmation ΓÇö use `useTransactionPoller.startPolling()`.
 *
 * @throws On validation failure, signing rejection, or persistent submission errors
 */
export async function buildSignAndSubmitSubscribe(
  params: SubscribeParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
  signal?: AbortSignal,
): Promise<SubmitResult> {
  const throwIfAborted = () => {
    if (signal?.aborted) {
      const error = new Error('Subscription submission cancelled');
      error.name = 'AbortError';
      throw error;
    }
  };

  throwIfAborted();
  // 0. Normalize + validate addresses before making any network calls
  //    (non-retryable) — Issue #37: shared helper instead of a hand-rolled
  //    if/throw per field. Reassigning onto `params` means every downstream
  //    use of params.subscriber/merchant/token (including the eventual
  //    `new Address(...)` calls) gets the trimmed value, not the raw input.
  params.subscriber = assertValidGAddress(params.subscriber, 'subscriber');
  params.merchant = assertValidGAddress(params.merchant, 'merchant');
  params.token = assertValidCAddress(params.token, 'token');

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // 1. Fetch account with retry (up to 5 attempts, transient network issues)
  const account = await withBackoff(
    () => {
      throwIfAborted();
      return server.getAccount(publicKey);
    },
    {
      maxRetries: 5,
      baseDelayMs: 300,
      maxDelayMs: 30_000,
      jitterFactor: 0.25,
      isRetryable,
      onRetry: (attempt, error, delayMs) => {
        console.warn(
          `[subscribe] getAccount retry ${attempt}/6 after ${delayMs}ms:`,
          getErrorMessage(error),
        );
      },
    },
  );
  throwIfAborted();

  // 2. Build transaction (local operation, no retry needed)
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
        nativeToScVal(BigInt(params.interval), { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  // 3. Prepare transaction with retry (simulation + resource fee, can fail transiently)
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await withBackoff(
      () => {
        throwIfAborted();
        return prepareTransactionWithDiagnostics(server, tx);
      },
      {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        jitterFactor: 0.25,
        isRetryable,
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[subscribe] prepareTransaction retry ${attempt}/4 after ${delayMs}ms:`,
            getErrorMessage(error),
          );
        },
      },
    );
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    throw new Error(`Transaction preparation failed after retries: ${msg}`);
  }
  throwIfAborted();

  // 4. Sign with Freighter (user action, no retry — if rejected, fail immediately)
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
  throwIfAborted();

  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  // 5. Submit with retry (rate limits, mempool backlog)
  let sendResult: SorobanRpc.Api.SendTransactionResponse;
  try {
    sendResult = await withBackoff(
      () => {
        throwIfAborted();
        return server.sendTransaction(parsedTx);
      },
      {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        jitterFactor: 0.25,
        isRetryable,
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[subscribe] sendTransaction retry ${attempt}/4 after ${delayMs}ms:`,
            getErrorMessage(error),
          );
        },
      },
    );
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    throw new Error(`Transaction submission failed after retries: ${msg}`);
  }
  throwIfAborted();

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
    );
  }

  // Return immediately ΓÇö polling is handled by useTransactionPoller
  return { txHash: sendResult.hash, server };
}

// ΓöÇΓöÇ Legacy all-in-one function (backward compatibility) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Build, sign, submit, and poll a `subscribe` transaction to completion.
 *
 * @deprecated Prefer `buildSignAndSubmitSubscribe` + `useTransactionPoller`
 * for the two-phase flow with intermediate 'confirming' state.
 *
 * Before building the transaction a **read-only allowance check** is performed
 * via `simulateTransaction`. The result is included in the return value so the
 * caller can surface a low-allowance warning even after a successful submission.
 *
 * @param params            Subscription parameters (including optional `strict`)
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash and pre-flight allowance check result
 * @throws                  On any failure: construction, signing, submission, or timeout
 */
export async function buildAndSubmitSubscribe(
  params: SubscribeParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<SubscribeResult> {
  const { txHash, server } = await buildSignAndSubmitSubscribe(
    params,
    contractId,
    publicKey,
    networkPassphrase,
    rpcUrl,
  );

  // Legacy in-process polling (fixed 1 s interval)
  const confirmedHash = await pollForConfirmation(server, txHash);
  return { txHash: confirmedHash };
}

// ── cancel builder ─────────────────────────────────────────────────────────────

/**
 * Build, sign, and submit a `cancel` transaction.
 *
 * The caller should pass the exact active subscription's token contract address,
 * because the contract key is `(subscriber, merchant, token)`.
 */
export async function buildSignAndSubmitCancel(
  params: CancelParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<SubmitResult> {
  params.subscriber = assertValidGAddress(params.subscriber, 'subscriber');
  params.merchant = assertValidGAddress(params.merchant, 'merchant');
  params.token = assertValidCAddress(params.token, 'token');

  const strict = params.strict ?? false;
  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // 1. Pre-flight allowance check (read-only, no fees, no signing)
  //    This mirrors what the on-chain `subscribe` does before writing storage.
  //    A failure here is non-fatal unless `strict` is true — we surface the
  //    result to the caller but still proceed with the transaction.
  let allowanceCheck: AllowanceResult | null = null;
  try {
    allowanceCheck = await checkAllowance({
      subscriberAddress: params.subscriber,
      tokenContractId: params.token,
      contractId,
      requiredAmount: BigInt(params.amount),
      rpcUrl,
      networkPassphrase,
    });

    if (strict && !allowanceCheck.sufficient) {
      throw new Error(
        `Insufficient token allowance: have ${allowanceCheck.allowance}, ` +
        `need ${BigInt(params.amount)} ` +
        `(shortfall: ${allowanceCheck.shortfall}). ` +
        `Approve more tokens in your wallet before subscribing.`,
      );
    }
  } catch (err) {
    // If strict mode threw above, re-throw it immediately
    if (
      strict &&
      err instanceof Error &&
      err.message.startsWith('Insufficient token allowance')
    ) {
      throw err;
    }
    // For non-strict mode or unexpected errors (network hiccup, unsupported
    // token contract), log and continue — the on-chain call is the source of
    // truth and will emit its own low_allowance event if needed.
    console.warn(
      '[allowance_checker] Pre-flight allowance check failed; proceeding anyway.',
      err,
    );
    allowanceCheck = null;
  }

  // 2. Fetch account
  const account = await server.getAccount(publicKey);

  // 3. Build transaction
  //    The `subscribe` entry point now takes 6 positional arguments:
  //      subscriber, merchant, token, amount, interval, strict
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
        new Address(params.token).toScVal(),
        nativeToScVal(BigInt(params.amount), { type: 'i128' }),
        nativeToScVal(BigInt(params.interval), { type: 'u64' }),
        // strict: bool — tells the contract to hard-reject on low allowance
        nativeToScVal(strict, { type: 'bool' }),
      )
    )
    .setTimeout(30)
    .build();

  // 4. Prepare transaction (simulation + resource fee injection)
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await prepareTransactionWithDiagnostics(server, tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Wrap in a descriptive message so the normalizer can classify it, then
    // throw the NormalizedRpcError so callers receive structured metadata.
    throw normalizeRpcError(new Error(`Transaction preparation failed: ${msg}`));
  }

  // 5. Sign with Freighter
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  // 6. Submit
  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);
  let sendResult: Awaited<ReturnType<typeof server.sendTransaction>>;
  try {
    sendResult = await server.sendTransaction(parsedTx);
  } catch (err: unknown) {
    throw new ContractLifecycleError(
      ContractLifecycleErrorCode.SUBMISSION_FAILED,
      `Transaction submission failed: ${err instanceof Error ? err.message : String(err)}`,
      err,
    );
  }

  if (sendResult.status === 'ERROR') {
    throw normalizeRpcError(
      new Error(
        `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`
      )
    );
  }

  // 7. Poll for confirmation
  const txHash = await pollForConfirmation(server, sendResult.hash);

  return { txHash, allowanceCheck };
}


// ΓöÇΓöÇ execute_payment builder ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Build, sign, and submit an `execute_payment` transaction with adaptive retry logic.
 *
 * Wraps RPC calls with exponential backoff and jitter:
 *   - getAccount: Retries up to 5 times (transient network issues)
 *   - prepareTransaction: Retries up to 3 times (mempool congestion)
 *   - sendTransaction: Retries up to 3 times (rate limits, temporary RPC issues)
 *
 * The connected merchant wallet must authorize this call. The contract verifies
 * that `merchant == require_auth()` signer and that the payment interval has
 * elapsed (`now >= next_payment`).
 *
 * Non-retryable errors (signing rejection, invalid addresses, contract errors)
 * are thrown immediately without retry.
 *
 * @param params            Subscriber and merchant addresses
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected merchant's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On validation failure, signing rejection, or persistent errors
 */
/** Parameters for collecting a single subscriber's payment */
export interface ExecutePaymentParams {
  /** Subscriber Stellar G-address being charged */
  subscriber: string;
  /** Merchant Stellar G-address (must match the connected wallet) */
  merchant: string;
}

/** Result of a successful execute_payment transaction */
export interface ExecutePaymentResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

export async function buildAndSubmitExecutePayment(
  params: ExecutePaymentParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<ExecutePaymentResult> {
  // Normalize + validate before any network calls (non-retryable)
  params.subscriber = assertValidGAddress(params.subscriber, 'subscriber');
  params.merchant = assertValidGAddress(params.merchant, 'merchant');

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // Fetch account sequence for the signer (merchant) with retry
  const account = await withBackoff(
    () => server.getAccount(publicKey),
    {
      maxRetries: 5,
      baseDelayMs: 300,
      maxDelayMs: 30_000,
      jitterFactor: 0.25,
      isRetryable,
      onRetry: (attempt, error, delayMs) => {
        console.warn(
          `[execute_payment] getAccount retry ${attempt}/6 after ${delayMs}ms:`,
          getErrorMessage(error),
        );
      },
    },
  );

  // Issue #35: type-safe wrapper instead of a hand-rolled contract.call() —
  // each argument's Soroban type is declared once via the `arg.*` helpers,
  // and a malformed argument is mapped through normalizeRpcError() the same
  // way every other transaction-layer failure is.
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      buildContractCall(contractId, 'execute_payment', [
        arg.address(params.subscriber),
        arg.address(params.merchant),
      ]),
    )
    .setTimeout(30)
    .build();

  // Simulate + inject resource fees with retry
  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await withBackoff(
      () => prepareTransactionWithDiagnostics(server, tx),
      {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        jitterFactor: 0.25,
        isRetryable,
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[execute_payment] prepareTransaction retry ${attempt}/4 after ${delayMs}ms:`,
            getErrorMessage(error),
          );
        },
      },
    );
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    throw new Error(`Transaction preparation failed after retries: ${msg}`);
  }

  // Sign with Freighter (user action, no retry — if rejected, fail immediately)
  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);

  const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

  // Submit with retry
  let sendResult: SorobanRpc.Api.SendTransactionResponse;
  try {
    sendResult = await withBackoff(
      () => server.sendTransaction(parsedTx),
      {
        maxRetries: 3,
        baseDelayMs: 500,
        maxDelayMs: 15_000,
        jitterFactor: 0.25,
        isRetryable,
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[execute_payment] sendTransaction retry ${attempt}/4 after ${delayMs}ms:`,
            getErrorMessage(error),
          );
        },
      },
    );
  } catch (err: unknown) {
    const msg = getErrorMessage(err);
    throw new Error(`Transaction submission failed after retries: ${msg}`);
  }

  if (sendResult.status === 'ERROR') {
    throw new Error(
      `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`,
    );
  }

  const txHash = await pollForConfirmation(server, sendResult.hash);
  return { txHash };
}

// ΓöÇΓöÇ batch_execute_payment builder ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ

/**
 * Execute payment collection for multiple subscribers using the on-chain
 * `batch_execute_payment` entry point.
 *
 * Entries that carry a token contract address are collected atomically: a
 * single transaction charges every subscriber in the same (merchant, token)
 * group at once, up to the contract's BATCH_MAX_SIZE. The per-subscriber
 * success/failure booleans returned by the contract are mapped back onto the
 * input entries so the UI can show which subscribers succeeded and which
 * were skipped on-chain.
 *
 * Entries without a token fall back to the legacy per-entry
 * `execute_payment` submission. Failures are captured per-entry and never
 * halt the batch.
 *
 * @param entries           Array of (subscriber, merchant, token) entries to collect from
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected merchant's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Per-entry results with success/failure breakdown
 */
/** A single (subscriber, merchant, token) triple to collect a payment from */
export interface BatchPaymentEntry {
  subscriber: string;
  merchant: string;
  /** Token contract address - required to use the atomic batch_execute_payment call */
  token?: string;
}

/** Per-entry outcome plus aggregate counts for a batch execute_payment run */
export interface BatchExecutePaymentResult {
  results: Array<{
    subscriber: string;
    merchant: string;
    /** Present when this entry's transaction succeeded */
    txHash?: string;
    /** Present when this entry failed (validation, signing, or on-chain error) */
    error?: string;
  }>;
  successCount: number;
  failureCount: number;
}

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

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });

  // 1. Validate every entry up front (non-retryable). A single bad row must
  //    not abort the rest of the batch. Entries that fail validation get an
  //    inline error result and are excluded from the atomic call.
  const output: BatchExecutePaymentResult['results'] = [];
  const atomicGroups = new Map<string, BatchPaymentEntry[]>();

  for (const entry of entries) {
    try {
      assertValidGAddress(entry.subscriber, 'subscriber');
    } catch (err: unknown) {
      output.push({
        subscriber: entry.subscriber,
        merchant: entry.merchant,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    try {
      assertValidGAddress(entry.merchant, 'merchant');
    } catch (err: unknown) {
      output.push({
        subscriber: entry.subscriber,
        merchant: entry.merchant,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    if (entry.token) {
      try {
        assertValidCAddress(entry.token, 'token');
      } catch (err: unknown) {
        output.push({
          subscriber: entry.subscriber,
          merchant: entry.merchant,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }
      const groupKey = `${entry.merchant}\u0000${entry.token}`;
      const group = atomicGroups.get(groupKey);
      if (group) {
        group.push(entry);
      } else {
        atomicGroups.set(groupKey, [entry]);
      }
    } else {
      // No token supplied — fall back to the legacy per-entry execute_payment.
      try {
        const { txHash } = await buildAndSubmitExecutePayment(
          { subscriber: entry.subscriber, merchant: entry.merchant },
          contractId,
          publicKey,
          networkPassphrase,
          rpcUrl,
        );
        output.push({ subscriber: entry.subscriber, merchant: entry.merchant, txHash });
      } catch (err: unknown) {
        const error = err instanceof Error ? err.message : String(err);
        output.push({ subscriber: entry.subscriber, merchant: entry.merchant, error });
      }
    }
  }

  // 2. Execute one on-chain batch_execute_payment transaction per
  //    (merchant, token) group — up to the contract's BATCH_MAX_SIZE.
  for (const group of atomicGroups.values()) {
    const groupResults = await submitAtomicBatchPayment(
      group,
      server,
      contractId,
      publicKey,
      networkPassphrase,
    );
    output.push(...groupResults);
  }

  // 3. Aggregate counts across the ordered results.
  const successCount = output.filter((r) => r.txHash).length;
  const failureCount = output.filter((r) => r.error).length;

  return { results: output, successCount, failureCount };
}

/**
 * Submit a single on-chain `batch_execute_payment` transaction for a group
 * of entries that share the same (merchant, token) pair.
 *
 * The contract charges each due subscriber in one `invokeHostFunction`
 * operation and returns `Vec<(Address, bool)>` — one per subscriber in input
 * order — which is mapped back onto the entries so the UI can show exactly
 * which subscribers succeeded and which were skipped on-chain.
 */
async function submitAtomicBatchPayment(
  entries: BatchPaymentEntry[],
  server: SorobanRpc.Server,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
): Promise<BatchExecutePaymentResult['results']> {
  const merchant = entries[0].merchant;
  const token = entries[0].token as string;

  try {
    const account = await withBackoff(
      () => server.getAccount(publicKey),
      {
        maxRetries: 5,
        baseDelayMs: 300,
        maxDelayMs: 30_000,
        jitterFactor: 0.25,
        isRetryable,
        onRetry: (attempt, error, delayMs) => {
          console.warn(
            `[batch_execute_payment] getAccount retry ${attempt}/6 after ${delayMs}ms:`,
            getErrorMessage(error),
          );
        },
      },
    );

    const contract = new Contract(contractId);

    const subscribersScVal = xdr.ScVal.scvVec(
      entries.map((e) => new Address(e.subscriber).toScVal()),
    );

    const tx = new TransactionBuilder(account, {
      fee: BASE_FEE,
      networkPassphrase,
    })
      .addOperation(
        contract.call(
          'batch_execute_payment',
          new Address(merchant).toScVal(),
          new Address(token).toScVal(),
          subscribersScVal,
        ),
      )
      .setTimeout(30)
      .build();

    // Simulate first so we can read the on-chain per-subscriber outcome
    // (Vec<(Address, bool)>) before signing.
    const simResult = await server.simulateTransaction(tx);
    if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
      const msg = simResult.error ?? 'batch_execute_payment simulation failed';
      return entries.map((e) => ({ subscriber: e.subscriber, merchant, error: msg }));
    }
    const outcomes = decodeBatchOutcomes(simResult.result?.retval);

    // Prepare (fills resource fees), sign with Freighter, and submit.
    let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
    try {
      preparedTx = await withBackoff(
        () => prepareTransactionWithDiagnostics(server, tx),
        {
          maxRetries: 3,
          baseDelayMs: 500,
          maxDelayMs: 15_000,
          jitterFactor: 0.25,
          isRetryable,
          onRetry: (attempt, error, delayMs) => {
            console.warn(
              `[batch_execute_payment] prepareTransaction retry ${attempt}/4 after ${delayMs}ms:`,
              getErrorMessage(error),
            );
          },
        },
      );
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      return entries.map((e) => ({
        subscriber: e.subscriber,
        merchant,
        error: `Transaction preparation failed: ${msg}`,
      }));
    }

    const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
    const parsedTx = TransactionBuilder.fromXDR(signedXdr, networkPassphrase);

    let sendResult: SorobanRpc.Api.SendTransactionResponse;
    try {
      sendResult = await withBackoff(
        () => server.sendTransaction(parsedTx),
        {
          maxRetries: 3,
          baseDelayMs: 500,
          maxDelayMs: 15_000,
          jitterFactor: 0.25,
          isRetryable,
          onRetry: (attempt, error, delayMs) => {
            console.warn(
              `[batch_execute_payment] sendTransaction retry ${attempt}/4 after ${delayMs}ms:`,
              getErrorMessage(error),
            );
          },
        },
      );
    } catch (err: unknown) {
      const msg = getErrorMessage(err);
      return entries.map((e) => ({
        subscriber: e.subscriber,
        merchant,
        error: `Transaction submission failed: ${msg}`,
      }));
    }

    if (sendResult.status === 'ERROR') {
      const msg = `Transaction submission failed: ${sendResult.errorResult?.toXDR('base64') ?? 'unknown error'}`;
      return entries.map((e) => ({ subscriber: e.subscriber, merchant, error: msg }));
    }

    const txHash = await pollForConfirmation(server, sendResult.hash);

    // 3. Map the on-chain booleans onto the input entries (contract preserves
    //    input order, but we fall back to matching by address defensively).
    const outcomeBySubscriber = new Map(
      outcomes.map((o) => [o.subscriber, o.success]),
    );

    return entries.map((e) => {
      const success = outcomeBySubscriber.get(e.subscriber) ?? false;
      return success
        ? { subscriber: e.subscriber, merchant, txHash }
        : {
            subscriber: e.subscriber,
            merchant,
            error:
              'Skipped on-chain: subscription not due, not found, or insufficient allowance/balance.',
          };
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return entries.map((e) => ({ subscriber: e.subscriber, merchant, error: message }));
  }
}

/**
 * Decode the return value of `batch_execute_payment` (`Vec<(Address, bool)>`)
 * into an ordered list of per-subscriber outcomes.
 */
function decodeBatchOutcomes(
  retval: xdr.ScVal | undefined,
): Array<{ subscriber: string; success: boolean }> {
  if (!retval) return [];
  try {
    const native = scValToNative(retval);
    if (!Array.isArray(native)) return [];
    return native
      .map((pair) => {
        const cells = Array.isArray(pair) ? pair : [];
        return {
          subscriber: cells.length > 0 ? String(cells[0]) : '',
          success: cells.length > 1 ? Boolean(cells[1]) : false,
        };
      })
      .filter((o) => o.subscriber !== '');
  } catch {
    return [];
  }
}

// ── update_subscription builder (Issue #768) ──────────────────────────────────

/** Parameters for updating an existing subscription's amount and/or interval */
export interface UpdateSubscriptionParams {
  /** Subscriber Stellar G-address (must match the connected wallet) */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** Replacement payment amount, in the token's smallest unit. Must be > 0. */
  newAmount: number;
  /** Replacement interval in seconds. Must be in [86400, 31536000]. */
  newInterval: number;
}

/** Result of a successful update_subscription transaction */
export interface UpdateSubscriptionResult {
  txHash: string;
}

/**
 * Build, sign, and submit an `update_subscription` transaction.
 *
 * Unlike cancel + re-subscribe, the contract preserves the subscription's
 * current `next_payment` — the subscriber's billing cycle is not disrupted
 * by an amount/interval change.
 *
 * @param params            Subscriber, merchant, and the replacement amount/interval
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On validation failure, signing rejection, or RPC errors
 */
export async function buildAndSubmitUpdateSubscription(
  params: UpdateSubscriptionParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<UpdateSubscriptionResult> {
  // Validate before any network calls — same rules as subscribe().
  params.subscriber = assertValidGAddress(params.subscriber, 'subscriber');
  params.merchant = assertValidGAddress(params.merchant, 'merchant');
  if (!Number.isInteger(params.newAmount) || params.newAmount <= 0) {
    throw new Error('Amount must be a positive whole number');
  }
  if (
    !Number.isInteger(params.newInterval) ||
    params.newInterval < 86_400 ||
    params.newInterval > 31_536_000
  ) {
    throw new Error(
      'Interval must be a whole number of seconds between 86,400 (1 day) and 31,536,000 (365 days)',
    );
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'update_subscription',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
        nativeToScVal(BigInt(params.newAmount), { type: 'i128' }),
        nativeToScVal(BigInt(params.newInterval), { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await prepareTransactionWithDiagnostics(server, tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
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

// ── update_subscription builder (Issue #794) ────────────────────────────────

/** Parameters for updating an active subscription's amount and/or interval */
export interface UpdateSubscriptionParams {
  /** Subscriber Stellar G-address (must match the connected wallet) */
  subscriber: string;
  /** Merchant Stellar G-address */
  merchant: string;
  /** New payment amount as a positive integer (in token's smallest unit) */
  newAmount: number;
  /** New payment interval in seconds [86400, 31536000] */
  newInterval: number;
}

/** Result of a successful update_subscription transaction */
export interface UpdateSubscriptionResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/**
 * Build, sign, and submit an `update_subscription` transaction.
 *
 * The connected subscriber wallet must authorize this call. The contract
 * replaces the stored amount/interval in-place without touching `next_payment`,
 * so the subscriber's current billing cycle continues uninterrupted.
 *
 * Validation mirrors the contract error conditions:
 *   - `newAmount > 0` (else AmountMustBePositive)
 *   - `86 400 <= newInterval <= 31 536 000` (else IntervalTooShort/Long)
 *
 * @param params            Subscriber, merchant, new amount, and new interval
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected wallet's public key (from Freighter) —
 *                          must equal `subscriber` or `oldMerchant`
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On validation failure, signing rejection, or RPC errors
 */
export async function buildAndSubmitUpdateSubscription(
  params: UpdateSubscriptionParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<UpdateSubscriptionResult> {
  params.subscriber = assertValidGAddress(params.subscriber, 'subscriber');
  params.merchant = assertValidGAddress(params.merchant, 'merchant');
  if (!Number.isInteger(params.newAmount) || params.newAmount <= 0) {
    throw new Error('Amount must be a positive integer.');
  }
  if (
    !Number.isInteger(params.newInterval) ||
    params.newInterval < 86_400 ||
    params.newInterval > 31_536_000
  ) {
    throw new Error('Interval must be between 86400 and 31536000 seconds.');
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'update_subscription',
        new Address(params.subscriber).toScVal(),
        new Address(params.merchant).toScVal(),
        nativeToScVal(BigInt(params.newAmount), { type: 'i128' }),
        nativeToScVal(BigInt(params.newInterval), { type: 'u64' }),
      ),
    )
    .setTimeout(30)
    .build();

  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await prepareTransactionWithDiagnostics(server, tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
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

// ── transfer_subscription builder (Issue #796) ──────────────────────────────

/** Parameters for migrating an active subscription to a new merchant wallet */
export interface TransferSubscriptionParams {
  /** Subscriber Stellar G-address (must match the connected wallet) */
  subscriber: string;
  /** Current merchant Stellar G-address */
  oldMerchant: string;
  /** Destination merchant Stellar G-address */
  newMerchant: string;
}

/** Result of a successful transfer_subscription transaction */
export interface TransferSubscriptionResult {
  /** Transaction hash on Stellar network */
  txHash: string;
}

/**
 * Build, sign, and submit a `transfer_subscription` transaction.
 *
 * Migrates an active subscription from one merchant wallet to another while
 * preserving state (token, amount, interval, `next_payment`) — no billing
 * cycle reset occurs.
 *
 * Validation mirrors the contract error conditions:
 *   - `oldMerchant != newMerchant` (else SameMerchant)
 *   - `subscriber != newMerchant` (else SelfSubscription)
 *
 * @param params            Subscriber, current merchant, and new merchant addresses
 * @param contractId        Deployed SorobanPay contract address
 * @param publicKey         Connected subscriber's public key (from Freighter)
 * @param networkPassphrase Stellar network passphrase
 * @param rpcUrl            Soroban RPC endpoint URL
 * @returns                 Transaction hash of the confirmed transaction
 * @throws                  On validation failure, signing rejection, or RPC errors
 */
export async function buildAndSubmitTransferSubscription(
  params: TransferSubscriptionParams,
  contractId: string,
  publicKey: string,
  networkPassphrase: string,
  rpcUrl: string,
): Promise<TransferSubscriptionResult> {
  params.subscriber = assertValidGAddress(params.subscriber, 'subscriber');
  params.oldMerchant = assertValidGAddress(params.oldMerchant, 'current merchant');
  params.newMerchant = assertValidGAddress(params.newMerchant, 'new merchant');
  if (params.oldMerchant === params.newMerchant) {
    throw new Error(
      'Transfer failed: the new merchant must be different from the current merchant.',
    );
  }
  if (params.subscriber === params.newMerchant) {
    throw new Error('Transfer failed: a subscriber cannot become their own merchant.');
  }

  const server = new SorobanRpc.Server(rpcUrl, { allowHttp: false });
  const account = await server.getAccount(publicKey);
  const contract = new Contract(contractId);

  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase,
  })
    .addOperation(
      contract.call(
        'transfer_subscription',
        new Address(params.subscriber).toScVal(),
        new Address(params.oldMerchant).toScVal(),
        new Address(params.newMerchant).toScVal(),
      ),
    )
    .setTimeout(30)
    .build();

  let preparedTx: ReturnType<typeof TransactionBuilder.fromXDR>;
  try {
    preparedTx = await prepareTransactionWithDiagnostics(server, tx);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Transaction preparation failed: ${msg}`);
  }

  const signedXdr = await signTx(preparedTx.toXDR(), networkPassphrase);
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
