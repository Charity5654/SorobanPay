/**
 * pollTransaction.ts — Issue #36
 *
 * The single, shared implementation of "poll a submitted Soroban transaction
 * until it reaches a terminal state" for the transaction-builder layer.
 * Extracted out of transaction_builder.ts, where it lived as a private
 * function that every builder there (subscribe, cancel, execute_payment,
 * batch execute, update, transfer) already called into — this doesn't change
 * behavior, it gives the logic its own module so it's unmistakably "the one
 * poller" instead of an implementation detail buried in one particular file,
 * and can be imported or unit-tested independently of transaction_builder.ts.
 *
 * Every failure — an on-chain FAILED status or a timeout — is thrown through
 * normalizeRpcError() so callers always get the same NormalizedRpcError
 * shape no matter which builder function triggered it, per this issue's
 * "consistently handle confirmation delays and show the same user-facing
 * error" goal.
 *
 * Note: the two-phase subscribe flow's exponential-backoff poller
 * (useTransactionPoller.ts) is a React hook with its own
 * cancellation/component-lifecycle concerns and is intentionally not folded
 * into this helper — merging a hook's state machine into a plain async
 * function would be a much larger, riskier change than "give the
 * transaction-builder layer one poller." Its timeout message still contains
 * "confirmation timeout", so normalizeRpcError() classifies it under the
 * same 'confirmation_timeout' category as this helper's timeout.
 */

import { SorobanRpc } from '@stellar/stellar-sdk';
import { normalizeRpcError } from './rpc_error_normalizer';

/** Delay between confirmation checks, in milliseconds. */
export const POLL_INTERVAL_MS = 1_000;
/** Maximum number of checks before giving up (60 attempts × 1 s = 60 s total). */
export const MAX_POLL_ATTEMPTS = 60;

/**
 * Poll `getTransaction` at a fixed interval until the transaction reaches
 * SUCCESS or FAILED, or MAX_POLL_ATTEMPTS is exhausted.
 *
 * @param server  Soroban RPC server instance used for the original submission.
 * @param hash    Transaction hash returned by sendTransaction.
 * @returns       The same hash, once confirmed successful.
 * @throws        A NormalizedRpcError (category 'onchain_failed' or
 *                'confirmation_timeout'), via normalizeRpcError().
 */
export async function pollForConfirmation(
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
      throw normalizeRpcError(
        new Error(`Transaction failed on-chain: ${meta ?? 'no result meta available'}`),
      );
    }

    // status === NOT_FOUND — still in mempool, continue polling
  }

  throw normalizeRpcError(
    new Error(
      `Transaction confirmation timeout after ${MAX_POLL_ATTEMPTS} seconds. Hash: ${hash}`,
    ),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
