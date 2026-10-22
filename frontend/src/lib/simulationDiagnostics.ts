/**
 * simulationDiagnostics.ts — Issue #34
 *
 * Captures and exposes Soroban `simulateTransaction` diagnostics when a
 * transaction fails to prepare, instead of relying on whatever string
 * `server.prepareTransaction()` happens to throw.
 *
 * `prepareTransaction()` runs the same simulation internally and discards
 * the structured response on failure, surfacing only an SDK-formatted Error.
 * That message is often serviceable (it usually already contains the Soroban
 * host's own "Error(Contract, #N)" text for a contract-level rejection,
 * which rpc_error_normalizer.ts's contract-code extraction can parse) — but
 * it isn't guaranteed, and there's no way to inspect the full diagnostic
 * (event log, cost) for a "technical details" panel.
 *
 * Calling `simulateTransaction()` explicitly first, the way
 * transaction_builder.ts's batch_execute_payment path already does to decode
 * its return value, means a failure always carries the simulation's own
 * `error` string and the full raw response — deterministically, not as a
 * side effect of the SDK's error-formatting choices.
 */

import { SorobanRpc, Transaction, TransactionBuilder } from '@stellar/stellar-sdk';

export interface SimulationDiagnostic {
  /**
   * The simulation's own error string. For a contract-level rejection this
   * usually includes the Soroban host's "Error(Contract, #N)" / event log
   * text, which rpc_error_normalizer.ts's contract-code extraction already
   * knows how to turn into a specific, human-readable rejection reason
   * (e.g. "You cannot subscribe to yourself") instead of a generic
   * "simulation failed" message.
   */
  message: string;
  /** The full simulateTransaction error response, for a "technical details" panel. */
  raw: SorobanRpc.Api.SimulateTransactionErrorResponse;
}

export class SimulationFailedError extends Error {
  readonly diagnostic: SimulationDiagnostic;

  constructor(diagnostic: SimulationDiagnostic) {
    super(diagnostic.message);
    this.name = 'SimulationFailedError';
    this.diagnostic = diagnostic;
  }
}

/**
 * Simulate `tx`, and if simulation fails, throw a SimulationFailedError
 * carrying the full diagnostic instead of a generic message. On success,
 * behaves like `server.prepareTransaction(tx)` — returns the assembled,
 * fee-and-footprint-populated transaction ready to sign.
 *
 * @throws SimulationFailedError when the simulation itself reports a failure.
 * @throws Whatever server.prepareTransaction() throws for failures that only
 *         show up in the (re-)assembly step after a successful simulation.
 */
export async function prepareTransactionWithDiagnostics(
  server: SorobanRpc.Server,
  tx: Transaction,
): Promise<ReturnType<typeof TransactionBuilder.fromXDR>> {
  const simResult = await server.simulateTransaction(tx);

  if (SorobanRpc.Api.isSimulationError(simResult)) {
    throw new SimulationFailedError({ message: simResult.error, raw: simResult });
  }

  // Simulation succeeded — let prepareTransaction assemble the final tx.
  // It re-simulates internally, but that's a cheap read-only RPC call, and
  // keeps this function's return value identical to calling the SDK's own
  // prepareTransaction directly.
  return server.prepareTransaction(tx);
}
