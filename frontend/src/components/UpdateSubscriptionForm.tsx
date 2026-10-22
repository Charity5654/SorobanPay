'use client';

/**
 * UpdateSubscriptionForm.tsx
 *
 * Frontend UI for the on-chain `update_subscription` contract function.
 *
 * Currently subscribers must cancel and re-subscribe just to change their
 * amount or billing interval. This component lets them update the amount and
 * interval of an existing subscription in place — one transaction, no
 * re-subscription needed, and the current billing cycle is not interrupted
 * (the contract deliberately leaves `next_payment` untouched).
 *
 * Features (Issue #794):
 *   - Fields pre-filled with the current subscription values (via `initialValues`
 *     or by loading them from `get_subscription`).
 *   - Validation matches the contract error conditions:
 *       * amount > 0            (AmountMustBePositive)
 *       * 86400 <= interval <= 31536000 (IntervalTooShort/IntervalTooLong)
 *   - Confirmation modal before submitting.
 *   - Shows the transaction hash with a Stellar Expert explorer link on success.
 */

import { useState, useCallback, type FormEvent } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { buildExplorerUrl } from '@/hooks/useTransactionPoller';
import { buildAndSubmitUpdateSubscription } from '@/lib/transaction_builder';
import { isValidGAddress, MIN_INTERVAL_SECONDS, MAX_INTERVAL_SECONDS } from '@/lib/validation';
import { CONTRACT_ID, NETWORK_PASSPHRASE, NETWORK_NAME, RPC_URL } from '@/constants/network';
import { mapError } from '@/lib/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Initial values used to pre-fill the form with current subscription values. */
export interface UpdateSubscriptionInitialValues {
  /** Current merchant Stellar G-address. */
  merchantAddress?: string;
  /** Current token contract C-address (optional — used to load current values). */
  tokenAddress?: string;
  /** Current payment amount (token units). */
  amount?: string;
  /** Current payment interval in seconds. */
  interval?: string;
}

export interface UpdateSubscriptionFormProps {
  /** Optional pre-filled current subscription values. */
  initialValues?: UpdateSubscriptionInitialValues;
}

interface FieldErrors {
  merchantAddress?: string;
  amount?: string;
  interval?: string;
}

// ─── Shared styles (matches SubscriptionForm) ────────────────────────────────

const inputCls =
  'w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base ' +
  'text-white placeholder-gray-500 ' +
  'focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 ' +
  'disabled:opacity-50 min-h-[48px] transition-all duration-150';

function fieldClass(hasError: boolean): string {
  return `${inputCls} ${hasError ? 'border-red-500 ring-1 ring-red-400/30 focus-visible:ring-red-400' : ''}`;
}

const labelCls = 'block text-sm font-semibold text-gray-100 mb-2.5';
const hintCls = 'text-xs text-gray-300 leading-relaxed';

// ─── Confirmation modal ──────────────────────────────────────────────────────

function ConfirmModal({
  merchantAddress,
  amount,
  interval,
  onConfirm,
  onCancel,
}: {
  merchantAddress: string;
  amount: string;
  interval: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const days = Math.round(Number(interval) / 86400);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="update-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white">
        <h3 id="update-confirm-title" className="text-lg font-bold">
          Update subscription
        </h3>
        <p className="text-sm text-gray-400">
          Review the new terms before authorizing the on-chain transaction. Your
          current billing cycle will continue uninterrupted.
        </p>

        <dl className="bg-gray-800/60 rounded-lg divide-y divide-gray-700 text-sm">
          {[
            ['Merchant', merchantAddress],
            ['New amount', `${amount} tokens`],
            [
              'New interval',
              `${days} day${days !== 1 ? 's' : ''} (${interval} s)`,
            ],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 px-4 py-3">
              <dt className="text-xs text-gray-400 font-medium">{label}</dt>
              <dd className="break-all font-mono text-xs text-gray-100">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-600 bg-gray-800/50 text-gray-300 hover:bg-gray-700 active:bg-gray-800 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            Go Back
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            Confirm & Authorize
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function UpdateSubscriptionForm({
  initialValues,
}: UpdateSubscriptionFormProps = {}) {
  const { publicKey, isCheckingFreighter, freighterInstalled, connect } = useWallet();

  const [merchantAddress, setMerchantAddress] = useState(
    initialValues?.merchantAddress ?? '',
  );
  const [tokenAddress] = useState(initialValues?.tokenAddress ?? '');
  const [amount, setAmount] = useState(initialValues?.amount ?? '');
  const [interval, setInterval] = useState(initialValues?.interval ?? '');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);
  const [isLoadingCurrent, setIsLoadingCurrent] = useState(false);
  const [loadCurrentError, setLoadCurrentError] = useState<string | null>(null);

  // ── Load current subscription values from the contract (Issue #794) ────────
  const loadCurrentValues = useCallback(async () => {
    setLoadCurrentError(null);
    if (!publicKey) return;
    if (!isValidGAddress(merchantAddress.trim())) {
      setLoadCurrentError('Enter a valid merchant address first.');
      return;
    }
    if (!tokenAddress.trim()) {
      setLoadCurrentError(
        'A token contract address is required to load current values.',
      );
      return;
    }

    setIsLoadingCurrent(true);
    try {
      const { Contract, Address, scValToNative, SorobanRpc } = await import(
        '@stellar/stellar-sdk'
      );
      const server = new SorobanRpc.Server(RPC_URL, { allowHttp: true });
      const contract = new Contract(CONTRACT_ID);

      // Read-only simulation of get_subscription(subscriber, merchant, token).
      const { TransactionBuilder, BASE_FEE } = await import('@stellar/stellar-sdk');
      const sourceAccount = await server
        .getAccount(publicKey)
        .catch(() => null);
      if (!sourceAccount) {
        setLoadCurrentError('Could not read account state from the RPC.');
        return;
      }

      const tx = new TransactionBuilder(sourceAccount, {
        fee: BASE_FEE,
        networkPassphrase: NETWORK_PASSPHRASE,
      })
        .addOperation(
          contract.call(
            'get_subscription',
            new Address(publicKey).toScVal(),
            new Address(merchantAddress.trim()).toScVal(),
            new Address(tokenAddress.trim()).toScVal(),
          ),
        )
        .setTimeout(30)
        .build();

      const simResult = await server.simulateTransaction(tx);
      if (!SorobanRpc.Api.isSimulationSuccess(simResult)) {
        setLoadCurrentError(
          'No subscription found for this merchant (or the contract call failed).',
        );
        return;
      }
      const retVal = simResult.result?.retval;
      if (!retVal) {
        setLoadCurrentError('No subscription found for this merchant.');
        return;
      }
      const native = scValToNative(retVal);
      if (!native || typeof native !== 'object') {
        setLoadCurrentError('No subscription found for this merchant.');
        return;
      }
      const data = native as Record<string, unknown>;
      const currentAmount = data.amount;
      const currentInterval = data.interval;

      setAmount(typeof currentAmount === 'bigint' ? currentAmount.toString() : String(currentAmount ?? ''));
      setInterval(typeof currentInterval === 'bigint' ? currentInterval.toString() : String(currentInterval ?? ''));
    } catch (err) {
      setLoadCurrentError(
        err instanceof Error ? err.message : 'Failed to load current subscription values.',
      );
    } finally {
      setIsLoadingCurrent(false);
    }
  }, [publicKey, merchantAddress, tokenAddress]);

  // ── Validation (matches the contract error conditions) ─────────────────────
  function validate(): FieldErrors {
    const errors: FieldErrors = {};
    if (!merchantAddress.trim()) {
      errors.merchantAddress = 'Merchant address is required.';
    } else if (!isValidGAddress(merchantAddress)) {
      errors.merchantAddress =
        'Must be a valid Stellar G-address (56 characters, starts with G).';
    }

    const amountNum = Number(amount);
    if (!amount.trim()) {
      errors.amount = 'Amount is required.';
    } else if (!Number.isInteger(amountNum) || isNaN(amountNum) || amountNum <= 0) {
      errors.amount = 'Amount must be a whole number greater than 0.';
    }

    const intervalNum = Number(interval);
    if (!interval.trim()) {
      errors.interval = 'Interval is required.';
    } else if (!Number.isInteger(intervalNum) || isNaN(intervalNum)) {
      errors.interval = 'Interval must be a whole number of seconds.';
    } else if (intervalNum < MIN_INTERVAL_SECONDS) {
      errors.interval = `Interval must be at least ${MIN_INTERVAL_SECONDS.toLocaleString()} seconds (1 day).`;
    } else if (intervalNum > MAX_INTERVAL_SECONDS) {
      errors.interval = `Interval must be at most ${MAX_INTERVAL_SECONDS.toLocaleString()} seconds (365 days).`;
    }
    return errors;
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTxError(null);
    setSuccessTxHash(null);

    const errors = validate();
    setFieldErrors(errors);
    if (Object.keys(errors).length > 0) return;
    if (!publicKey) return;

    setShowConfirm(true);
  }

  async function confirmAndSubmit() {
    setShowConfirm(false);
    if (!publicKey || !CONTRACT_ID) return;

    setIsSubmitting(true);
    setTxError(null);
    setSuccessTxHash(null);

    try {
      const result = await buildAndSubmitUpdateSubscription(
        {
          subscriber: publicKey,
          merchant: merchantAddress.trim(),
          newAmount: Number(amount),
          newInterval: Number(interval),
        },
        CONTRACT_ID,
        publicKey,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );
      setSuccessTxHash(result.txHash);
    } catch (err) {
      const mapped = mapError(err);
      setTxError(mapped.message);
    } finally {
      setIsSubmitting(false);
    }
  }

  const canSubmit =
    !!publicKey && !!merchantAddress.trim() && !!amount.trim() && !!interval.trim();

  const showLoadCurrent = !!publicKey && !!tokenAddress.trim();

  return (
    <div className="w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 text-white">
      {showConfirm && (
        <ConfirmModal
          merchantAddress={merchantAddress}
          amount={amount}
          interval={interval}
          onConfirm={confirmAndSubmit}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <div className="flex items-start justify-between mb-1 gap-3">
        <h2 className="text-xl sm:text-2xl font-bold leading-tight">
          Update Subscription
        </h2>
        <span
          aria-label={publicKey ? 'Wallet connected' : 'Wallet disconnected'}
          className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
            publicKey
              ? 'bg-green-900/40 border border-green-700/50 text-green-300'
              : 'bg-gray-800 border border-gray-700 text-gray-400'
          }`}
        >
          <span
            className={`h-1.5 w-1.5 rounded-full ${publicKey ? 'bg-green-400' : 'bg-gray-500'}`}
            aria-hidden="true"
          />
          {publicKey ? 'Connected' : 'Disconnected'}
        </span>
      </div>
      <p className="text-gray-400 text-sm mt-1 mb-6">
        Change the amount or billing interval of an existing subscription
        without cancelling and re-subscribing.
      </p>

      {/* Wallet required notice */}
      {!publicKey && (
        <div
          role="status"
          className="mb-4 rounded-lg border border-yellow-700/40 bg-yellow-900/20 px-4 py-3 text-sm text-yellow-200"
        >
          {!freighterInstalled ? (
            <>
              Freighter wallet is not installed.{' '}
              <a
                href="https://www.freighter.app"
                target="_blank"
                rel="noopener noreferrer"
                className="underline hover:text-yellow-100"
              >
                Install Freighter
              </a>{' '}
              to update a subscription.
            </>
          ) : (
            <>
              Connect your Freighter wallet to update your subscription.
              {!isCheckingFreighter && (
                <button
                  type="button"
                  onClick={connect}
                  className="ml-2 rounded bg-blue-600 hover:bg-blue-500 px-3 py-1 text-xs font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                >
                  Connect
                </button>
              )}
            </>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate>
        {/* Merchant */}
        <div className="mb-4">
          <label htmlFor="update-merchant" className={labelCls}>
            Merchant address<span aria-hidden="true" className="text-red-400 ml-1">*</span>
          </label>
          <input
            id="update-merchant"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="G…"
            value={merchantAddress}
            onChange={(e) => setMerchantAddress(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.merchantAddress}
            aria-describedby={
              fieldErrors.merchantAddress ? 'update-merchant-error' : undefined
            }
            className={fieldClass(!!fieldErrors.merchantAddress)}
          />
          {fieldErrors.merchantAddress && (
            <p id="update-merchant-error" role="alert" className="mt-2 text-xs text-red-400">
              {fieldErrors.merchantAddress}
            </p>
          )}
          <p className={hintCls + ' mt-1'}>
            The merchant your subscription is currently with.
          </p>
        </div>

        {/* Load current values */}
        {showLoadCurrent && (
          <div className="mb-4 flex flex-col gap-2">
            {loadCurrentError && (
              <p role="alert" className="text-xs text-red-400">
                {loadCurrentError}
              </p>
            )}
            <button
              type="button"
              onClick={loadCurrentValues}
              disabled={isLoadingCurrent}
              className="self-start inline-flex items-center gap-1.5 rounded-lg border border-gray-700 px-3 py-1.5 text-xs text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              {isLoadingCurrent ? (
                <>
                  <svg
                    className="h-3 w-3 animate-spin"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                  >
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Loading…
                </>
              ) : (
                <>↻ Load current values</>
              )}
            </button>
          </div>
        )}

        {/* New amount */}
        <div className="mb-4">
          <label htmlFor="update-amount" className={labelCls}>
            New amount<span aria-hidden="true" className="text-red-400 ml-1">*</span>
          </label>
          <input
            id="update-amount"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 100"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.amount}
            aria-describedby={fieldErrors.amount ? 'update-amount-error' : undefined}
            className={fieldClass(!!fieldErrors.amount)}
          />
          {fieldErrors.amount && (
            <p id="update-amount-error" role="alert" className="mt-2 text-xs text-red-400">
              {fieldErrors.amount}
            </p>
          )}
          <p className={hintCls + ' mt-1'}>Must be greater than 0.</p>
        </div>

        {/* New interval */}
        <div className="mb-4">
          <label htmlFor="update-interval" className={labelCls}>
            New interval (seconds)
            <span aria-hidden="true" className="text-red-400 ml-1">*</span>
          </label>
          <input
            id="update-interval"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="e.g. 2592000 (30 days)"
            value={interval}
            onChange={(e) => setInterval(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.interval}
            aria-describedby={fieldErrors.interval ? 'update-interval-error' : undefined}
            className={fieldClass(!!fieldErrors.interval)}
          />
          {fieldErrors.interval && (
            <p id="update-interval-error" role="alert" className="mt-2 text-xs text-red-400">
              {fieldErrors.interval}
            </p>
          )}
          <p className={hintCls + ' mt-1'}>
            Between {MIN_INTERVAL_SECONDS.toLocaleString()} (1 day) and{' '}
            {MAX_INTERVAL_SECONDS.toLocaleString()} seconds (365 days).
          </p>
        </div>

        {/* Success state */}
        {successTxHash && (
          <div
            role="status"
            className="mb-4 rounded-xl bg-gradient-to-br from-green-900/60 to-green-800/30 border-2 border-green-600/60 p-5 text-sm space-y-2"
          >
            <p className="font-semibold text-green-300">
              Subscription updated successfully!
            </p>
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-gray-400 break-all font-mono text-xs flex-1">
                {successTxHash}
              </p>
              <a
                href={buildExplorerUrl(successTxHash)}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="View transaction on Stellar Expert"
                className="text-xs text-blue-400 hover:text-blue-300 underline shrink-0"
              >
                View on {NETWORK_NAME === 'Mainnet' ? 'Stellar Expert' : 'Stellar Expert (testnet)'} ↗
              </a>
            </div>
          </div>
        )}

        {/* Error state */}
        {txError && (
          <div
            role="alert"
            className="mb-4 rounded-lg bg-red-900/40 border border-red-600/70 px-4 py-3 text-sm text-red-300"
          >
            {txError}
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={!canSubmit || isSubmitting}
          className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed py-3 text-sm font-semibold text-white transition-all duration-150 min-h-[48px] hover:shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          {isSubmitting ? 'Submitting…' : 'Update Subscription'}
        </button>
      </form>
    </div>
  );
}
