'use client';

/**
 * useSimulateFee.ts
 *
 * Debounced hook that calls simulateTransaction() against the Soroban RPC
 * to estimate the resource fee for a `subscribe` call before the user
 * submits the form.
 *
 * Features:
 *  - Debounced 500 ms so that rapid typing doesn't flood the RPC
 *  - Returns loading, fee (in stroops), breakdown (instructions, readBytes,
 *    writeBytes), and any simulation error
 *  - Skips simulation when formValid is false or publicKey is absent
 *  - Cancels in-flight work when params change or the component unmounts
 *  - Uses useReducer to batch all state updates into a single dispatch,
 *    preventing multiple React renders and act() warnings in tests
 */

import { useReducer, useEffect } from 'react';
import {
  Contract,
  TransactionBuilder,
  BASE_FEE,
  nativeToScVal,
  Address,
} from '@stellar/stellar-sdk';
import { SorobanRpc } from '@stellar/stellar-sdk';
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  RPC_URL,
} from '@/constants/network';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SimulateFeeParams {
  /** Subscriber G-address (from connected wallet). */
  subscriber: string;
  /** Merchant G-address (from form). */
  merchant: string;
  /** Token contract C-address (from form). */
  token: string;
  /** Payment amount in token's smallest unit. */
  amount: number;
  /** Payment interval in seconds. */
  interval: number;
  /** Whether all form fields pass validation. Simulation is skipped when false. */
  formValid: boolean;
}

export interface SimulateFeeBreakdown {
  /** CPU instructions consumed by the transaction. */
  instructions: number;
  /** Ledger bytes read. */
  readBytes: number;
  /** Ledger bytes written. */
  writeBytes: number;
}

export type SimulateFeeStatus = 'idle' | 'loading' | 'success' | 'error';

export interface UseSimulateFeeResult {
  /** Current status of the simulation. */
  status: SimulateFeeStatus;
  /**
   * Estimated minimum resource fee in stroops.
   * Convert to XLM: `minResourceFee / 10_000_000`.
   * Null when status !== 'success'.
   */
  minResourceFee: string | null;
  /** Detailed resource breakdown. Null when status !== 'success'. */
  breakdown: SimulateFeeBreakdown | null;
  /** Simulation error message. Null when status !== 'error'. */
  error: string | null;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 500;
const STROOPS_PER_XLM = 10_000_000;

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert stroop string to a human-readable XLM value with 7 decimal places. */
export function stroopsToXlm(stroops: string): string {
  const n = Number(stroops);
  if (!Number.isFinite(n)) return '0.0000000';
  return (n / STROOPS_PER_XLM).toFixed(7);
}

// ── Reducer ───────────────────────────────────────────────────────────────────

type State = UseSimulateFeeResult;

type Action =
  | { type: 'RESET' }
  | { type: 'LOADING' }
  | { type: 'SUCCESS'; minResourceFee: string; breakdown: SimulateFeeBreakdown }
  | { type: 'ERROR'; error: string };

const initialState: State = {
  status: 'idle',
  minResourceFee: null,
  breakdown: null,
  error: null,
};

function reducer(_state: State, action: Action): State {
  switch (action.type) {
    case 'RESET':
      return initialState;
    case 'LOADING':
      return { status: 'loading', minResourceFee: null, breakdown: null, error: null };
    case 'SUCCESS':
      return {
        status: 'success',
        minResourceFee: action.minResourceFee,
        breakdown: action.breakdown,
        error: null,
      };
    case 'ERROR':
      return { status: 'error', minResourceFee: null, breakdown: null, error: action.error };
    default:
      return _state;
  }
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Simulate the `subscribe` transaction and return the fee estimate.
 *
 * @param params     Form field values + formValid gate
 * @param rpcUrl     Override RPC URL (useful in tests)
 * @param contractId Override contract ID (useful in tests)
 * @param networkPassphrase Override network passphrase (useful in tests)
 */
export function useSimulateFee(
  params: SimulateFeeParams,
  rpcUrl = RPC_URL,
  contractId = CONTRACT_ID,
  networkPassphrase = NETWORK_PASSPHRASE,
): UseSimulateFeeResult {
  const [state, dispatch] = useReducer(reducer, initialState);

  const {
    subscriber,
    merchant,
    token,
    amount,
    interval,
    formValid,
  } = params;

  useEffect(() => {
    // Reset to idle immediately when form becomes invalid
    if (!formValid || !subscriber) {
      dispatch({ type: 'RESET' });
      return;
    }

    let cancelled = false;

    dispatch({ type: 'LOADING' });

    const timer = setTimeout(async () => {
      if (cancelled) return;

      try {
        const server = new SorobanRpc.Server(rpcUrl, { allowHttp: true });

        // We need an account sequence to build a valid transaction for simulation.
        // getAccount may throw for unfunded accounts — treat that as a simulation error.
        const account = await server.getAccount(subscriber);
        if (cancelled) return;

        const contract = new Contract(contractId);
        const tx = new TransactionBuilder(account, {
          fee: BASE_FEE,
          networkPassphrase,
        })
          .addOperation(
            contract.call(
              'subscribe',
              new Address(subscriber).toScVal(),
              new Address(merchant).toScVal(),
              new Address(token).toScVal(),
              nativeToScVal(BigInt(amount), { type: 'i128' }),
              nativeToScVal(BigInt(interval), { type: 'u64' }),
            ),
          )
          .setTimeout(30)
          .build();

        const simResult = await server.simulateTransaction(tx);
        if (cancelled) return;

        if (SorobanRpc.Api.isSimulationError(simResult)) {
          dispatch({
            type: 'ERROR',
            error: simResult.error || 'Simulation failed — see contract requirements.',
          });
          return;
        }

        if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
          dispatch({ type: 'ERROR', error: 'Simulation returned an unexpected result.' });
          return;
        }

        // Extract resource metrics from the XDR soroban data.
        // SorobanDataBuilder.build() returns xdr.SorobanTransactionData which
        // has a .resources() method returning xdr.SorobanResources.
        const txDataXdr = simResult.transactionData.build();
        const resources = txDataXdr.resources();
        const instrValue = resources.instructions();
        const readValue = resources.readBytes();
        const writeValue = resources.writeBytes();

        dispatch({
          type: 'SUCCESS',
          minResourceFee: simResult.minResourceFee,
          breakdown: {
            instructions: typeof instrValue === 'number' ? instrValue : Number(instrValue),
            readBytes: typeof readValue === 'number' ? readValue : Number(readValue),
            writeBytes: typeof writeValue === 'number' ? writeValue : Number(writeValue),
          },
        });
      } catch (err: unknown) {
        if (cancelled) return;
        const msg = err instanceof Error ? err.message : String(err);
        dispatch({ type: 'ERROR', error: msg });
      }
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    subscriber,
    merchant,
    token,
    amount,
    interval,
    formValid,
    rpcUrl,
    contractId,
    networkPassphrase,
  ]);

  return state;
}
