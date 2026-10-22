'use client';

/**
 * TransferSubscriptionForm.tsx
 *
 * Frontend UI for the on-chain `transfer_subscription` contract function.
 *
 * Currently there is no way to migrate an active subscription to a new
 * merchant wallet from the UI — subscribers must cancel and re-subscribe. This
 * component lets a subscriber reassign an existing subscription to a new
 * merchant while preserving the subscription state (token, amount, interval,
 * next_payment), so no billing-cycle reset occurs.
 *
 * Features (Issue #796):
 *   - Two address fields: current merchant and new merchant.
 *   - Both validated as Stellar G-addresses (56-char base32, starts with G).
 *   - Clear error when old and new merchant are the same (SameMerchant) or when
 *     the subscriber would become their own merchant (SelfSubscription).
 *   - Confirmation modal before submitting.
 *   - Shows the transaction hash with a Stellar Expert explorer link on success.
 */

import { useState, type FormEvent } from 'react';
import { useWallet } from '@/hooks/useWallet';
import { buildExplorerUrl } from '@/hooks/useTransactionPoller';
import { buildAndSubmitTransferSubscription } from '@/lib/transaction_builder';
import { isValidGAddress } from '@/lib/validation';
import { CONTRACT_ID, NETWORK_PASSPHRASE, NETWORK_NAME, RPC_URL } from '@/constants/network';
import { mapError } from '@/lib/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

/** Initial values used to pre-fill the form. */
export interface TransferSubscriptionInitialValues {
  /** Current merchant Stellar G-address. */
  oldMerchant?: string;
  /** Destination merchant Stellar G-address. */
  newMerchant?: string;
}

export interface TransferSubscriptionFormProps {
  /** Optional pre-filled merchant addresses. */
  initialValues?: TransferSubscriptionInitialValues;
}

interface FieldErrors {
  oldMerchant?: string;
  newMerchant?: string;
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
  oldMerchant,
  newMerchant,
  onConfirm,
  onCancel,
}: {
  oldMerchant: string;
  newMerchant: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="transfer-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white">
        <h3 id="transfer-confirm-title" className="text-lg font-bold">
          Transfer subscription?
        </h3>
        <p className="text-sm text-gray-400 leading-relaxed">
          Future payments collected by{' '}
          <span className="break-all font-mono text-xs text-gray-200">
            {oldMerchant}
          </span>{' '}
          will instead be collected by{' '}
          <span className="break-all font-mono text-xs text-gray-200">
            {newMerchant}
          </span>
          . The amount, interval, and billing cycle are preserved.
        </p>

        <dl className="bg-gray-800/60 rounded-lg divide-y divide-gray-700 text-sm">
          {[
            ['Current merchant', oldMerchant],
            ['New merchant', newMerchant],
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

export default function TransferSubscriptionForm({
  initialValues,
}: TransferSubscriptionFormProps = {}) {
  const { publicKey, isCheckingFreighter, freighterInstalled, connect } = useWallet();

  const [oldMerchant, setOldMerchant] = useState(initialValues?.oldMerchant ?? '');
  const [newMerchant, setNewMerchant] = useState(initialValues?.newMerchant ?? '');

  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [showConfirm, setShowConfirm] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [txError, setTxError] = useState<string | null>(null);
  const [successTxHash, setSuccessTxHash] = useState<string | null>(null);

  // ── Validation (matches the contract error conditions) ─────────────────────
  function validate(): FieldErrors {
    const errors: FieldErrors = {};

    if (!oldMerchant.trim()) {
      errors.oldMerchant = 'Current merchant address is required.';
    } else if (!isValidGAddress(oldMerchant)) {
      errors.oldMerchant =
        'Must be a valid Stellar G-address (56 characters, starts with G).';
    }

    if (!newMerchant.trim()) {
      errors.newMerchant = 'New merchant address is required.';
    } else if (!isValidGAddress(newMerchant)) {
      errors.newMerchant =
        'Must be a valid Stellar G-address (56 characters, starts with G).';
    }

    if (
      !errors.oldMerchant &&
      !errors.newMerchant &&
      oldMerchant.trim() === newMerchant.trim()
    ) {
      // Mirrors the contract's SameMerchant error — a transfer to the same
      // address is a no-op (and likely a mistake).
      errors.newMerchant =
        'The new merchant must be different from the current merchant.';
    }

    if (!errors.newMerchant && publicKey && newMerchant.trim() === publicKey) {
      // Mirrors the contract's SelfSubscription error.
      errors.newMerchant =
        'You cannot transfer a subscription to your own wallet address.';
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
      const result = await buildAndSubmitTransferSubscription(
        {
          subscriber: publicKey,
          oldMerchant: oldMerchant.trim(),
          newMerchant: newMerchant.trim(),
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
    !!publicKey &&
    !!oldMerchant.trim() &&
    !!newMerchant.trim() &&
    oldMerchant.trim() !== newMerchant.trim();

  return (
    <div className="w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 text-white">
      {showConfirm && (
        <ConfirmModal
          oldMerchant={oldMerchant}
          newMerchant={newMerchant}
          onConfirm={confirmAndSubmit}
          onCancel={() => setShowConfirm(false)}
        />
      )}

      <div className="flex items-start justify-between mb-1 gap-3">
        <h2 className="text-xl sm:text-2xl font-bold leading-tight">
          Transfer Subscription
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
        Migrate an active subscription to a new merchant wallet. The amount,
        interval, and billing cycle are preserved.
      </p>

      {publicKey && (
        <div className="mb-5 rounded-lg bg-gray-800/60 border border-gray-700/60 px-4 py-3 text-xs text-gray-300">
          Transferring the subscription of{' '}
          <span className="font-mono break-all text-gray-100">{publicKey}</span>
        </div>
      )}

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
              to transfer a subscription.
            </>
          ) : (
            <>
              Connect your Freighter wallet to transfer a subscription.
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
        {/* Current merchant */}
        <div className="mb-4">
          <label htmlFor="transfer-old-merchant" className={labelCls}>
            Current merchant address
            <span aria-hidden="true" className="text-red-400 ml-1">*</span>
          </label>
          <input
            id="transfer-old-merchant"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="G…"
            value={oldMerchant}
            onChange={(e) => setOldMerchant(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.oldMerchant}
            aria-describedby={
              fieldErrors.oldMerchant ? 'transfer-old-merchant-error' : undefined
            }
            className={fieldClass(!!fieldErrors.oldMerchant)}
          />
          {fieldErrors.oldMerchant && (
            <p
              id="transfer-old-merchant-error"
              role="alert"
              className="mt-2 text-xs text-red-400"
            >
              {fieldErrors.oldMerchant}
            </p>
          )}
          <p className={hintCls + ' mt-1'}>
            The merchant that currently receives your payments.
          </p>
        </div>

        {/* New merchant */}
        <div className="mb-4">
          <label htmlFor="transfer-new-merchant" className={labelCls}>
            New merchant address
            <span aria-hidden="true" className="text-red-400 ml-1">*</span>
          </label>
          <input
            id="transfer-new-merchant"
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            placeholder="G…"
            value={newMerchant}
            onChange={(e) => setNewMerchant(e.target.value)}
            disabled={isSubmitting}
            aria-invalid={!!fieldErrors.newMerchant}
            aria-describedby={
              fieldErrors.newMerchant ? 'transfer-new-merchant-error' : undefined
            }
            className={fieldClass(!!fieldErrors.newMerchant)}
          />
          {fieldErrors.newMerchant && (
            <p
              id="transfer-new-merchant-error"
              role="alert"
              className="mt-2 text-xs text-red-400"
            >
              {fieldErrors.newMerchant}
            </p>
          )}
          <p className={hintCls + ' mt-1'}>
            The wallet that will collect your payments going forward. Must be
            different from the current merchant.
          </p>
        </div>

        {/* Success state */}
        {successTxHash && (
          <div
            role="status"
            className="mb-4 rounded-xl bg-gradient-to-br from-green-900/60 to-green-800/30 border-2 border-green-600/60 p-5 text-sm space-y-2"
          >
            <p className="font-semibold text-green-300">
              Subscription transferred successfully!
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
          {isSubmitting ? 'Submitting…' : 'Transfer Subscription'}
        </button>
      </form>
    </div>
  );
}
