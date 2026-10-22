"use client";
import { SubscriptionFormErrorSummary } from "@/components/SubscriptionFormInputs";

/**
 * SubscriptionForm.tsx
 *
 * Full subscription creation form with inline validation,
 * loading state, success and error notifications.
 *
 * Requirements: 10.1–10.9
 * Improvements:
 *  - Mobile spacing & touch targets (min 44px, larger padding)
 *  - Enhanced success state with next-steps guidance
 *  - Progress indicator (animated bar) during async transaction
 *  - Contract config error card with remediation steps
 *
 * ## Wallet connection UX states
 *
 * | State              | Trigger                                      | UI indicator                                      | Submit button                        |
 * |--------------------|----------------------------------------------|---------------------------------------------------|--------------------------------------|
 * | Disconnected       | `publicKey` is null                          | Gray "Disconnected" badge                         | Disabled; yellow wallet hint shown   |
 * | Connected / idle   | `publicKey` set, `isSubmitting` false        | Green "Connected" badge                           | Enabled: "Authorize Subscription"    |
 * | Awaiting signature | `isSubmitting` true                          | Blue spinner + animated progress bar              | Disabled: "Submitting…" + spinner    |
 * | Success            | `successData` set after tx confirmed         | Green SuccessCard (tx hash + next-steps)          | Hidden; "Create another" shown       |
 * | Error              | `txError` set after failure/rejection        | Red alert with message; form data preserved       | Re-enabled for retry                 |
 *
 * State transitions:
 *   Disconnected → Connected/idle (connect Freighter)
 *   Connected/idle → Awaiting signature (submit form)
 *   Awaiting signature → Success (user approves)
 *   Awaiting signature → Error (user rejects / timeout / RPC error)
 *   Error → Awaiting signature (fix & resubmit)
 *   Success → Connected/idle (click "Create another")
 */

import { useState, useEffect, useCallback, useRef, type FormEvent } from "react";
import { useWallet } from "@/hooks/useWallet";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { SkeletonForm } from "@/components/Skeleton";
import { downloadReceipt, type ReceiptData } from "@/components/SubscriptionReceipt";
import { ShareQRCode } from "@/components/ShareQRCode";
import { FeeEstimate } from "@/components/FeeEstimate";
import {
  getPersistedFormData,
  persistFormData,
  clearPersistedFormData,
  useFormPersist,
} from "@/hooks/useFormPersist";
import { buildSignAndSubmitSubscribe } from "@/lib/transaction_builder";
import { checkAllowance, type AllowanceResult } from "@/lib/allowance_checker";
import { normalizeRpcError } from "@/lib/rpc_error_normalizer";
import {
  validateSubscriptionForm,
  isFormValid,
  DEFAULT_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS,
  type FieldErrors,
} from "@/lib/validation";
import { isValidGAddress } from "@/lib/validation";
import {
  CONTRACT_ID,
  NETWORK_PASSPHRASE,
  NETWORK_NAME,
  RPC_URL,
} from "@/constants/network";
import { mapError } from "@/lib/errors";
import { useToast } from "@/components/Toast";
import { useAddressBook } from "@/hooks/useAddressBook";
import { AddressBookModal } from "@/components/AddressBookModal";
import { AddressDisplay } from "@/components/AddressDisplay";// ─── Types ────────────────────────────────────────────────────────────────────
import { TransactionProgressIndicator } from "@/components/TransactionProgressIndicator";

interface SuccessData {
  txHash: string;
  merchant: string;
  subscriber: string;
  token: string;
  amount: string;
  interval: string;
  issuedAt: string;
  /** Unix timestamp (seconds) of the last successful payment, or null if none yet (Issue #50). */
  lastPayment: number | null;
}

/** State for the pause/resume controls shown inside the success card. */
type PauseState = 'active' | 'pausing' | 'paused' | 'resuming';

// ─── Shared input className (larger py for ≥48px touch target on mobile) ─────
const inputCls =
  "w-full rounded-lg bg-gray-800 border border-gray-700 px-4 py-3 text-base " +
  "text-white placeholder-gray-500 " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900 " +
  "disabled:opacity-50 min-h-[48px] transition-all duration-150";

// ─── Copy button ──────────────────────────────────────────────────────────────

function CopyButton({
  text,
  label = "Copy",
}: {
  text: string;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? "Copied!" : `${label} to clipboard`}
      title={copied ? "Copied!" : `${label} to clipboard`}
      className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-medium
                 bg-gray-700 hover:bg-gray-600 active:bg-gray-500 text-gray-300
                 hover:text-white transition-colors duration-150 shrink-0
                 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
    >
      {copied ? (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5 text-green-400"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
              clipRule="evenodd"
            />
          </svg>
          <span className="text-green-400">Copied!</span>
        </>
      ) : (
        <>
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-3.5 w-3.5"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 3a1 1 0 011-1h2a1 1 0 110 2H9a1 1 0 01-1-1z" />
            <path d="M6 3a2 2 0 00-2 2v11a2 2 0 002 2h8a2 2 0 002-2V5a2 2 0 00-2-2 3 3 0 01-3 3H9a3 3 0 01-3-3z" />
          </svg>
          {label}
        </>
      )}
    </button>
  );
}

// ─── Network + contract status badge ──────────────────────────────────────────

type ReachStatus = "checking" | "reachable" | "unreachable";

function NetworkBadge() {
  const [status, setStatus] = useState<ReachStatus>("checking");

  useEffect(() => {
    let cancelled = false;
    fetch(RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    })
      .then(() => {
        if (!cancelled) setStatus("reachable");
      })
      .catch(() => {
        if (!cancelled) setStatus("unreachable");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const networkColor =
    NETWORK_NAME === "Mainnet"
      ? "bg-purple-900/50 border-purple-600/50 text-purple-300"
      : "bg-blue-900/50 border-blue-600/50 text-blue-300";

  const statusDot: Record<ReachStatus, string> = {
    checking: "bg-yellow-400 animate-pulse",
    reachable: "bg-green-400",
    unreachable: "bg-red-400",
  };
  const statusLabel: Record<ReachStatus, string> = {
    checking: "Checking…",
    reachable: "Contract reachable",
    unreachable: "RPC unreachable",
  };

  return (
    <div
      aria-label={`Network: ${NETWORK_NAME}. Status: ${statusLabel[status]}`}
      className="flex items-center gap-2 flex-wrap"
    >
      <span aria-hidden="true">{NETWORK_NAME === "Mainnet" ? "🌐" : "🧪"}</span>
      {NETWORK_NAME}
      <span
        className={`h-2 w-2 rounded-full flex-shrink-0 ${statusDot[status]}`}
        aria-hidden="true"
      />
      <span className="text-xs font-normal opacity-80">
        {statusLabel[status]}
      </span>
    </div>
  );
}

// ─── Contract config guard ─────────────────────────────────────────────────────

function ContractConfigError() {
  const config = [
    ['RPC URL', RPC_URL],
    ['Network passphrase', NETWORK_PASSPHRASE],
    ['Contract ID', CONTRACT_ID || 'Not configured'],
  ];

  return (
    <div className="w-full max-w-lg mx-auto p-4 sm:p-6">
      <div
        role="alert"
        className="w-full rounded-2xl bg-gradient-to-br from-yellow-900/40 to-yellow-800/20 border-2 border-yellow-600/50 shadow-lg p-6 sm:p-8 text-white"
      >
        <div className="flex items-start gap-4 mb-6">
          <span className="text-4xl flex-shrink-0" aria-hidden="true">
            ⚠️
          </span>
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-yellow-300 mb-2">
              Contract not configured
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              The app cannot find a valid Soroban contract address. This is an
              environment setup issue, not a wallet problem.
            </p>
          </div>
        </div>

        <div className="bg-gray-900/60 rounded-lg p-4 sm:p-6 mb-6">
          <h3 className="text-yellow-300 font-semibold text-base mb-4">
            Remediation steps:
          </h3>
          <ol className="list-decimal list-inside space-y-3 text-sm text-gray-300">
            <li className="leading-relaxed">
              Deploy the contract:
              <pre className="mt-2 bg-gray-800 rounded-lg p-3 text-xs overflow-x-auto border border-gray-700">
                <code>bash deploy/deploy.sh</code>
              </pre>
            </li>
            <li className="leading-relaxed">
              Copy the printed address into{" "}
              <code className="bg-gray-800 px-2 py-1 rounded text-yellow-300 text-xs font-mono">
                frontend/.env.local
              </code>
              :
              <div className="mt-2 flex items-center gap-2">
                <pre className="flex-1 bg-gray-800 rounded-lg p-3 text-xs overflow-x-auto border border-gray-700">
                  <code>NEXT_PUBLIC_CONTRACT_ID=C…your_address…</code>
                </pre>
                <CopyButton
                  text="NEXT_PUBLIC_CONTRACT_ID=C…your_address…"
                  label="Copy"
                />
              </div>
            </li>
            <li className="leading-relaxed">
              Restart the dev server:
              <pre className="mt-2 bg-gray-800 rounded-lg p-3 text-xs overflow-x-auto border border-gray-700">
                <code>npm run dev</code>
              </pre>
            </li>
          </ol>
        </div>

        <dl className="bg-gray-900/60 rounded-lg p-4 mb-6 space-y-3 text-xs">
          {config.map(([label, value]) => (
            <div key={label}>
              <dt className="text-yellow-300 font-semibold">{label}</dt>
              <dd className="mt-1 break-all font-mono text-gray-300">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="border-t border-yellow-600/30 pt-4">
          <p className="text-xs text-gray-300">
            📖 For full details, see{" "}
            <code className="bg-gray-800/60 px-1.5 py-0.5 rounded text-yellow-300">
              README.md → Frontend → Environment variables
            </code>
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Progress bar ──────────────────────────────────────────────────────────────

function ProgressBar({ phase = 'submitting', explorerUrl }: { phase?: 'submitting' | 'confirming'; explorerUrl?: string | null }) {
  const label = phase === 'confirming' ? 'Confirming on-chain…' : 'Submitting transaction…';
  const ariaLabel =
    phase === 'confirming'
      ? 'Transaction submitted. Waiting for on-chain confirmation.'
      : 'Transaction in progress. Submitting to the Soroban network.';
  const subtext =
    phase === 'confirming'
      ? 'Polling for confirmation. This usually takes 5–15 seconds.'
      : 'This may take 10-30 seconds. Keep the window open.';

  return (
    <div
      className="w-full mb-6 p-4 sm:p-5 bg-blue-900/20 border border-blue-600/40 rounded-lg"
      role="status"
      aria-live="polite"
      aria-label={ariaLabel}
    >
      <div className="flex justify-between items-center mb-3">
        <div className="flex items-center gap-2">
          <svg
            className="animate-spin h-5 w-5 text-blue-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            role="img"
            aria-label="Loading spinner"
          >
            <title>Loading spinner</title>
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          <span className="text-sm font-medium text-blue-300">
            {label}
          </span>
        </div>
        <span className="text-xs text-blue-200 animate-pulse" aria-hidden="true">
          {phase === 'confirming' ? 'On-chain verification' : 'Processing on blockchain'}
        </span>
      </div>
      <div
        className="h-2 w-full bg-gray-700 rounded-full overflow-hidden shadow-inner"
        role="progressbar"
        aria-label="Transaction progress"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={50}
        aria-valuetext="Transaction in progress"
      >
        <div className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 rounded-full animate-progress" aria-hidden="true" />
      </div>
      <p className="mt-2 text-xs text-gray-300 text-center" aria-live="off">
        {subtext}
      </p>
      {phase === 'confirming' && explorerUrl && (
        <p className="mt-2 text-xs text-center">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
          >
            View on Stellar Expert ↗
          </a>
        </p>
      )}
    </div>
  );
}

// ─── Success card ──────────────────────────────────────────────────────────────

function SuccessCard({
  data,
  onReset,
  onCancelSubscription,
  isCancelling,
  getLabel,
  isPaused,
  pausedUntil,
  onPauseClick,
  onResumeClick,
  isPauseResumeSubmitting,
}: {
  data: SuccessData;
  onReset: () => void;
  onCancelSubscription: () => void;
  /** True while the cancel transaction is being submitted (Issue #791) */
  isCancelling: boolean;
  getLabel: (address: string) => string | null;
  /** True once pause_subscription has been confirmed on-chain (Issue #795) */
  isPaused: boolean;
  /** Unix timestamp (seconds) the pause auto-resumes at, or null for an indefinite pause */
  pausedUntil: number | null;
  onPauseClick: () => void;
  onResumeClick: () => void;
  isPauseResumeSubmitting: boolean;
}) {
  const days = Math.round(Number(data.interval) / 86400);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const handleDownloadReceipt = useCallback(async () => {
    setIsDownloading(true);
    setDownloadError(null);
    try {
      const receiptData: ReceiptData = {
        txHash: data.txHash,
        merchant: data.merchant,
        subscriber: data.subscriber,
        token: data.token,
        amount: data.amount,
        interval: data.interval,
        issuedAt: data.issuedAt,
      };
      await downloadReceipt(receiptData);
    } catch (err) {
      setDownloadError(
        err instanceof Error ? err.message : "Failed to generate receipt PDF.",
      );
    } finally {
      setIsDownloading(false);
    }
  }, [data]);

  return (
    <div
      role="alert"
      className="mb-6 rounded-xl bg-gradient-to-br from-green-900/60 to-green-800/30 border-2 border-green-600/60 p-5 sm:p-6 text-sm space-y-4 shadow-lg"
    >
      {/* Cancel confirmation modal */}
      {showCancelConfirm && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="cancel-confirm-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
        >
          <div className="w-full max-w-sm bg-gray-900 border border-red-700/60 rounded-2xl shadow-2xl p-6 space-y-5 text-white">
            <h3 id="cancel-confirm-title" className="text-lg font-bold text-red-300">
              Cancel subscription?
            </h3>
            <p className="text-sm text-gray-300">
              This will permanently remove your subscription with{" "}
              <span className="font-mono text-xs break-all text-gray-100">{data.merchant}</span>.
              Future payments will no longer be collectible.
            </p>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setShowCancelConfirm(false)}
                className="flex-1 rounded-lg border border-gray-600 bg-gray-800/50 text-gray-300 hover:bg-gray-700
                           py-3 text-sm font-semibold transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
              >
                Keep it
              </button>
              <button
                onClick={handleConfirmCancel}
                className="flex-1 rounded-lg bg-red-700 hover:bg-red-600 active:bg-red-800
                           py-3 text-sm font-semibold text-white transition-colors
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
              >
                Yes, cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">
          {isPaused ? "⏸" : "✓"}
        </span>
        <p className="font-semibold text-green-300 text-base sm:text-lg">
          Subscription created successfully!
        </p>
      </div>

      {/* Paused status banner — Issue #795 */}
      {isPaused && (
        <div
          role="status"
          className="flex flex-wrap items-center gap-2 rounded-lg bg-yellow-900/30 border border-yellow-600/50 px-3 py-2.5"
        >
          <span className="text-xs font-bold uppercase tracking-wide text-yellow-300">
            Paused
          </span>
          <span className="text-xs text-yellow-200/80">
            {pausedUntil
              ? `Resumes automatically on ${new Date(pausedUntil * 1000).toLocaleString()}`
              : "Payments are on hold until you resume."}
          </span>
        </div>
      )}

      {/* Tx hash */}
      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
        <p className="text-gray-400 text-xs mb-1.5 font-medium">
          Transaction hash
        </p>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="text-gray-200 break-all font-mono text-xs leading-relaxed flex-1">
            {data.txHash}
          </p>
          <a
            href={`${explorerBase}/${data.txHash}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-blue-400 hover:text-blue-300 underline shrink-0"
            aria-label="View transaction on Stellar Expert"
          >
            View ↗
          </a>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-gray-300 bg-gray-800/30 rounded-lg p-3">
        <span className="text-gray-300 font-medium">Amount</span>
        <span className="font-medium">{data.amount} tokens</span>
        <span className="text-gray-300 font-medium">Interval</span>
        <span className="font-medium">
          every {days} day{days !== 1 ? "s" : ""}
        </span>
        <span className="text-gray-300 font-medium break-all">Merchant</span>
        <span className="break-all font-mono text-xs">
          <AddressDisplay address={data.merchant} getLabel={getLabel} truncateLen={8} />
        </span>
      </div>

      {/* Cancel success state */}
      {cancelTxHash && (
        <div
          role="status"
          className="rounded-lg bg-orange-900/30 border border-orange-600/50 p-3 space-y-1"
        >
          <p className="text-orange-300 font-semibold text-xs">
            Subscription cancelled on-chain ✓
          </p>
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-gray-400 break-all font-mono text-xs flex-1">{cancelTxHash}</p>
            <a
              href={`${explorerBase}/${cancelTxHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 underline shrink-0"
              aria-label="View cancellation transaction on Stellar Expert"
            >
              View ↗
            </a>
          </div>
        </div>
      )}

      {/* Cancel error state */}
      {cancelError && (
        <div
          role="alert"
          className="rounded-lg bg-red-900/30 border border-red-600/50 p-3"
        >
          <p className="text-red-300 font-semibold text-xs mb-1">Cancel failed</p>
          <p className="text-gray-300 text-xs break-all">{cancelError}</p>
        </div>
      )}

      {/* Next steps */}
      <div className="border-t border-green-800/60 pt-4 space-y-2.5">
        <p className="text-green-300 font-semibold text-xs uppercase tracking-widest">
          What happens next
        </p>
        <ul className="list-disc list-inside space-y-2 text-gray-300 text-xs leading-relaxed">
          <li>The merchant can collect the first payment immediately.</li>
          <li>
            Subsequent payments are collectible every {days} day
            {days !== 1 ? "s" : ""}.
          </li>
          <li>
            Your wallet remains non-custodial — the contract never holds your
            funds.
          </li>
        </ul>
      </div>

      {/* Download receipt error */}
      {downloadError && (
        <div role="alert" className="rounded-lg bg-red-900/40 border border-red-600/50 px-3 py-2 text-xs text-red-300">
          Receipt generation failed: {downloadError}
        </div>
      )}

      {/* Cancel subscription — Issue #791 */}
      <div className="flex flex-col sm:flex-row gap-3">
        <button
          type="button"
          onClick={onCancelSubscription}
          disabled={isCancelling}
          aria-label="Cancel subscription"
          className="flex-1 flex items-center justify-center gap-2 rounded-lg
                     border-2 border-red-600/70 text-red-300 hover:bg-red-900/40 active:bg-red-900/60
                     disabled:opacity-50 disabled:cursor-not-allowed
                     py-3 text-sm font-semibold transition-all duration-150 min-h-[48px] hover:shadow-lg
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400
                     focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          {isCancelling ? "Cancelling…" : "Cancel Subscription"}
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Download Receipt button — Issue #379 */}
        <button
          type="button"
          onClick={handleDownloadReceipt}
          disabled={isDownloading}
          aria-label="Download subscription receipt as PDF"
          className="flex-1 flex items-center justify-center gap-2 rounded-lg
                     bg-green-700 hover:bg-green-600 active:bg-green-800
                     disabled:opacity-50 disabled:cursor-not-allowed
                     py-3 text-sm font-semibold text-white transition-all duration-150
                     min-h-[48px] hover:shadow-lg
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400
                     focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          {isDownloading ? (
            <>
              <svg
                className="animate-spin h-4 w-4 text-white"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8v8H4z"
                />
              </svg>
              Generating PDF…
            </>
          ) : (
            <>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              Download Receipt
            </>
          )}
        </button>

        <button
          onClick={onReset}
          className="flex-1 rounded-lg border-2 border-green-600/70 text-green-300 hover:bg-green-900/40 active:bg-green-900/60
                     py-3 text-sm font-semibold transition-all duration-150 min-h-[48px] hover:shadow-lg
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
        >
          Create Another Subscription
        </button>
      </div>

      {/* Cancel subscription (#765) */}
      {onCancelSubscription && (
        <div className="pt-2 border-t border-green-800/40">
          <button
            type="button"
            onClick={onCancelSubscription}
            disabled={isCancelling}
            aria-label="Cancel this subscription on-chain"
            className="w-full rounded-lg border border-red-700/60 text-red-400 hover:bg-red-900/30 active:bg-red-900/50
                       disabled:opacity-50 disabled:cursor-not-allowed
                       py-3 text-sm font-semibold transition-all duration-150 min-h-[48px]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            {isCancelling ? "Cancelling…" : "Cancel Subscription"}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Allowance warning banner ──────────────────────────────────────────────────

/**
 * Shown when the subscriber's current token allowance is below the requested
 * payment amount. This is a soft warning — the user can still submit, and the
 * on-chain contract will emit a `low_allowance` event.
 */
function AllowanceWarning({
  allowance,
  shortfall,
}: {
  allowance: bigint;
  shortfall: bigint;
}) {
  return (
    <div
      role="alert"
      aria-live="polite"
      className="mb-4 rounded-lg bg-yellow-900/40 border border-yellow-600/60 px-4 py-3 text-sm"
    >
      <div className="flex items-start gap-2">
        <span className="text-yellow-400 text-base flex-shrink-0 mt-0.5" aria-hidden="true">
          ⚠
        </span>
        <div className="space-y-1">
          <p className="font-semibold text-yellow-300">Low token allowance</p>
          <p className="text-gray-300 text-xs leading-relaxed">
            Your current allowance ({allowance.toString()} token units) is{" "}
            <strong>{shortfall.toString()} units short</strong> of the payment
            amount. You can still submit, but the merchant won&apos;t be able to
            collect until you approve more tokens.
          </p>
          <p className="text-gray-400 text-xs leading-relaxed">
            To fix: use your wallet to call{" "}
            <code className="bg-gray-800 px-1.5 py-0.5 rounded text-yellow-300 font-mono">
              approve(contract, amount)
            </code>{" "}
            on the token contract before the first payment is due.
          </p>
        </div>
      </div>
    </div>
  );
}

// ─── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmModal({
  merchantAddress,
  tokenAddress,
  amount,
  interval,
  allowanceResult,
  onConfirm,
  onCancel,
}: {
  merchantAddress: string;
  tokenAddress: string;
  amount: string;
  interval: string;
  allowanceResult: AllowanceResult | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  // Issue #21 — truncate long addresses for mobile-friendly display
  const truncate = (addr: string) =>
    addr.length > 16 ? `${addr.slice(0, 8)}…${addr.slice(-6)}` : addr;

  const days = Math.round(Number(interval) / 86400);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-subtitle"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white">
        {/* Issue #21 — header with icon for clarity */}
        <div className="flex items-center gap-3">
          <span className="text-2xl flex-shrink-0" aria-hidden="true">📋</span>
          <div>
            {/* autoFocus moves keyboard focus into the dialog on open */}
            <h3
              id="confirm-title"
              className="text-lg font-bold leading-tight"
              // eslint-disable-next-line jsx-a11y/no-autofocus
              autoFocus
              tabIndex={-1}
            >
              Review your subscription
            </h3>
            <p id="confirm-subtitle" className="text-sm text-gray-400 mt-0.5">
              Confirm the details below before calling Freighter.
            </p>
          </div>
        </div>
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white">
        <h3 id="confirm-title" className="text-lg font-bold">
          Confirm subscription
        </h3>
        <p className="text-sm text-gray-400">
          Review the details before authorizing the on-chain transaction.
        </p>

        {/* Low-allowance warning inside the confirmation dialog */}
        {allowanceResult && !allowanceResult.sufficient && (
          <AllowanceWarning
            allowance={allowanceResult.allowance}
            shortfall={allowanceResult.shortfall}
          />
        )}

        {/* Issue #21 — full summary: merchant, token, amount, interval */}
        <dl className="bg-gray-800/60 rounded-lg divide-y divide-gray-700 text-sm">
          {[
            { label: "Merchant address", value: merchantAddress, truncated: truncate(merchantAddress), full: merchantAddress },
            { label: "Token address",    value: tokenAddress,    truncated: truncate(tokenAddress),    full: tokenAddress },
            { label: "Amount",           value: `${amount} tokens`, truncated: `${amount} tokens`,       full: null },
            { label: "Interval",         value: `Every ${days} day${days !== 1 ? "s" : ""}`, truncated: `Every ${days} day${days !== 1 ? "s" : ""} (${Number(interval).toLocaleString()} s)`, full: null },
          ].map(({ label, truncated, full }) => (
            <div key={label} className="flex flex-col gap-0.5 px-4 py-3">
              <dt className="text-xs text-gray-400 font-medium">{label}</dt>
              <dd
                className="font-mono text-xs text-gray-100 break-all"
                title={full ?? undefined}
              >
                {truncated}
        <dl className="bg-gray-800/60 rounded-lg divide-y divide-gray-700 text-sm">
          {[
            ["Merchant", merchantAddress],
            ["Token", tokenAddress],
            ["Amount", `${amount} tokens`],
            ["Interval", `${days} day${days !== 1 ? "s" : ""} (${interval} s)`],
          ].map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5 px-4 py-3">
              <dt className="text-xs text-gray-400 font-medium">{label}</dt>
              <dd className="break-all font-mono text-xs text-gray-100">
                {value}
              </dd>
            </div>
          ))}
        </dl>

        {/* Issue #21 — Go Back first in tab order (logical: cancel before confirm) */}
        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-600 bg-gray-800/50 text-gray-300 hover:bg-gray-700 active:bg-gray-800 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            Go Back
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            Confirm &amp; Authorize
            Confirm & Authorize
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cancel confirmation modal (Issue #791) ────────────────────────────────────

function CancelConfirmModal({
  merchantAddress,
  onConfirm,
  onCancel,
}: {
  merchantAddress: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="cancel-confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white">
        <h3 id="cancel-confirm-title" className="text-lg font-bold">
          Cancel this subscription?
        </h3>
        <p className="text-sm text-gray-400 leading-relaxed">
          This calls{" "}
          <code className="bg-gray-800 px-1.5 py-0.5 rounded text-red-300 text-xs">
            cancel(subscriber, merchant)
          </code>{" "}
          on the contract for{" "}
          <span className="break-all font-mono text-xs text-gray-200">
            {merchantAddress}
          </span>
          . The subscription is removed permanently — you&apos;ll need to
          subscribe again to resume payments.
        </p>

        <div className="flex gap-3 pt-1">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-600 bg-gray-800/50 text-gray-300 hover:bg-gray-700 active:bg-gray-800 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500"
          >
            Keep Subscription
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-red-600 hover:bg-red-500 active:bg-red-700 py-3 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            Cancel Subscription
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Cancelled card (Issue #791) ────────────────────────────────────────────────
// Shown after a successful cancel — replaces SuccessCard with the tx hash and
// a Stellar Expert explorer link, per the acceptance criteria.

function CancelledCard({
  txHash,
  onReset,
}: {
  txHash: string;
  onReset: () => void;
}) {
  const explorerUrl = buildExplorerUrl(txHash);
  return (
    <div
      role="alert"
      className="mb-6 rounded-xl bg-gradient-to-br from-gray-800/60 to-gray-900/40 border-2 border-gray-600/60 p-5 sm:p-6 text-sm space-y-4 shadow-lg"
    >
      <div className="flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">
          🛑
        </span>
        <p className="font-semibold text-gray-200 text-base sm:text-lg">
          Subscription cancelled
        </p>
      </div>

      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
        <p className="text-gray-400 text-xs mb-1.5 font-medium">
          Transaction hash
        </p>
        <p className="text-gray-200 break-all font-mono text-xs leading-relaxed">
          {txHash}
        </p>
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 mt-2 text-xs text-blue-400 hover:text-blue-300 underline focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
        >
          View on Stellar Expert
          <span aria-hidden="true">↗</span>
        </a>
      </div>

      <button
        onClick={onReset}
        className="w-full rounded-lg border-2 border-gray-600/70 text-gray-200 hover:bg-gray-800/60 active:bg-gray-800/80
                   py-3 text-sm font-semibold transition-all duration-150 min-h-[48px] hover:shadow-lg
                   focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
      >
        Create Another Subscription
      </button>
    </div>
  );
}

// ─── Transaction error classifier + card ──────────────────────────────────────

interface TxErrorInfo {
  title: string;
  summary: string;
  fix: string;
  raw: string;
}

/**
 * Classifies a thrown error into a structured `TxErrorInfo` by delegating to
 * `normalizeRpcError` from `rpc_error_normalizer`.
 *
 * All contract error codes, RPC-layer failures, Freighter rejections, and
 * network faults are handled in the normalizer. This wrapper maps the
 * `NormalizedRpcError` shape to the `TxErrorInfo` shape that `ErrorCard`
 * already renders.
 */
function classifyError(err: unknown): TxErrorInfo {
  const normalized = normalizeRpcError(err);
  return {
    title:   normalized.title,
    summary: normalized.summary,
    fix:     normalized.action,
    raw:     normalized.rawMessage,
  };
}

/**
 * Issue #24 — Returns true when the error is a network/RPC/fetch error.
 * Used to decide whether to show the Retry button in ErrorCard.
 */
function isNetworkError(error: TxErrorInfo): boolean {
  return /network|rpc|fetch|failed to fetch|timeout|timed out/i.test(
    `${error.title} ${error.raw}`,
  );
}

function ErrorCard({
  error,
  onDismiss,
  explorerUrl,
  onRetry,
}: {
  error: TxErrorInfo;
  onDismiss: () => void;
  explorerUrl?: string | null;
  /** Issue #24 — optional retry callback. When provided and the error is a
   *  network error a prominent "Try Again" button is rendered. */
  onRetry?: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const showConfig = /network|rpc|contract|passphrase/i.test(`${error.title} ${error.raw}`);

  return (
    <div
      role="alert"
      className="mb-6 rounded-xl bg-red-900/40 border border-red-600/70 p-4 sm:p-5 text-sm shadow-md"
    >
      <div className="flex items-start gap-3 mb-3">
        <span className="text-xl flex-shrink-0 mt-0.5" aria-hidden="true">
          ⚠
        </span>
        <div className="flex-1 min-w-0">
          <p className="font-semibold text-red-300 text-base leading-snug">
            {error.title}
          </p>
          <p className="mt-1 text-gray-300 leading-relaxed">{error.summary}</p>
        </div>
        <button
          onClick={onDismiss}
          aria-label="Dismiss error"
          className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            className="h-4 w-4"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Suggested fix */}
      <div className="flex items-start gap-2 bg-gray-800/60 rounded-lg px-3 py-2.5 mb-3">
        <span className="text-blue-400 shrink-0 mt-0.5" aria-hidden="true">
          →
        </span>
        <p className="text-gray-200 text-xs leading-relaxed">{error.fix}</p>
      </div>

      {showConfig && (
        <dl className="bg-gray-900/70 rounded-lg p-3 mb-3 space-y-2 text-xs">
          {[
            ['RPC URL', RPC_URL],
            ['Network passphrase', NETWORK_PASSPHRASE],
            ['Contract ID', CONTRACT_ID || 'Not configured'],
          ].map(([label, value]) => (
            <div key={label}>
              <dt className="text-red-300 font-semibold">{label}</dt>
              <dd className="mt-0.5 break-all font-mono text-gray-300">{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* Collapsible technical details */}
      {explorerUrl && (
        <div className="mb-3">
          <a
            href={explorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
              <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
            </svg>
            View transaction on Stellar Expert ↗
          </a>
        </div>
      )}
      {/* Collapsible technical details */}
      <button
        type="button"
        onClick={() => setShowDetails((v) => !v)}
        aria-expanded={showDetails}
        className="text-xs text-gray-500 hover:text-gray-300 transition-colors underline underline-offset-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400 rounded"
      >
        {showDetails ? "Hide" : "Show"} technical details
      </button>
      {showDetails && (
        <div className="mt-2 flex items-start gap-2 bg-gray-900/70 rounded-lg p-3 border border-gray-700">
          <pre className="flex-1 text-xs text-gray-400 font-mono whitespace-pre-wrap break-all leading-relaxed overflow-x-auto">
            {error.raw}
          </pre>
          <CopyButton text={error.raw} label="Copy" />
        </div>
      )}
      {/* Issue #24 — Retry button for network errors */}
      {onRetry && isNetworkError(error) && (
        <div className="mt-4 pt-3 border-t border-red-800/40">
          <button
            type="button"
            onClick={() => { onDismiss(); onRetry(); }}
            className="w-full flex items-center justify-center gap-2 rounded-lg
                       bg-blue-600 hover:bg-blue-500 active:bg-blue-700
                       py-3 text-sm font-semibold text-white transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                       focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            aria-label="Retry the transaction"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                clipRule="evenodd"
              />
            </svg>
            Try Again
          </button>
          <p className="mt-2 text-center text-xs text-gray-500">
            Your form data has been preserved — no need to re-enter anything.
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Token info helpers ────────────────────────────────────────────────────────

/** SEP-41 standard: 7 decimal places (10^7 stroops per token unit). */
const STROOPS_PER_TOKEN = 10_000_000n;

/**
 * Format a raw stroop bigint value as a human-readable token amount with 7
 * decimal places (e.g. 1_000_000_000n → "100.0000000").
 */
function formatStroops(stroops: bigint): string {
  const whole = stroops / STROOPS_PER_TOKEN;
  const frac = stroops % STROOPS_PER_TOKEN;
  // Pad fractional part to 7 digits
  const fracStr = frac.toString().padStart(7, "0");
  return `${whole}.${fracStr}`;
}

// ─── TokenInfoPanel ────────────────────────────────────────────────────────────

/**
 * Displays the subscriber's current token balance and approved allowance for
 * the SorobanPay contract, with warnings when either is insufficient for the
 * entered amount.
 *
 * Rendered below the amount field whenever the wallet is connected and a valid
 * token address is present. Warnings are informational — they do not block submission.
 */
function TokenInfoPanel({
  tokenAddress,
  subscriberAddress,
  amountStr,
}: {
  tokenAddress: string;
  subscriberAddress: string;
  amountStr: string;
}) {
  const { status, balance, allowance, error, refresh } = useTokenInfo(
    tokenAddress,
    subscriberAddress,
    CONTRACT_ID,
  );

  // Parse the entered amount into stroops for comparison
  const enteredTokens = amountStr.trim() !== "" ? Number(amountStr) : NaN;
  const enteredStroops =
    !isNaN(enteredTokens) && Number.isInteger(enteredTokens) && enteredTokens > 0
      ? BigInt(enteredTokens) * STROOPS_PER_TOKEN
      : null;

  const balanceTooLow =
    enteredStroops !== null && balance !== null && enteredStroops > balance;
  const allowanceTooLow =
    enteredStroops !== null && allowance !== null && enteredStroops > allowance;

  // Don't render anything when idle (no valid addresses yet)
  if (status === "idle") return null;

  return (
    <div className="mt-3 space-y-2">
      {/* ── Loading skeleton ── */}
      {status === "loading" && (
        <div
          role="status"
          aria-label="Fetching token information"
          className="flex items-center gap-2 text-xs text-gray-400 animate-pulse"
        >
          <svg
            className="h-3.5 w-3.5 animate-spin text-blue-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8v8H4z"
            />
          </svg>
          Fetching balance…
        </div>
      )}

      {/* ── Error state ── */}
      {status === "error" && error && (
        <div
          id="token-info-error"
          role="status"
          className="flex flex-col gap-2 rounded-lg bg-red-900/30 border border-red-700/50 px-3 py-2.5 text-xs text-red-300"
        >
          <p>{error}</p>
          <button
            type="button"
            aria-label="Retry fetching token info"
            onClick={refresh}
            className="self-start inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs font-medium
                       bg-red-800/60 hover:bg-red-700/60 text-red-200 transition-colors
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-3.5 w-3.5"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                clipRule="evenodd"
              />
            </svg>
            Retry
          </button>
        </div>
      )}

      {/* ── Success state: balance + allowance rows ── */}
      {status === "success" && balance !== null && allowance !== null && (
        <div className="rounded-lg bg-gray-800/60 border border-gray-700/60 divide-y divide-gray-700/50 text-xs">
          {/* Header row with refresh button */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-gray-400 font-medium uppercase tracking-wide text-[10px]">
              Token info
            </span>
            <button
              type="button"
              aria-label="Refresh token balance and allowance"
              onClick={refresh}
              className="text-gray-500 hover:text-gray-300 transition-colors rounded
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-3.5 w-3.5"
                viewBox="0 0 20 20"
                fill="currentColor"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </div>

          {/* Balance row */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-gray-400">Your balance</span>
            <span className={`font-mono font-medium ${balanceTooLow ? "text-yellow-400" : "text-gray-200"}`}>
              {formatStroops(balance)}
            </span>
          </div>

          {/* Allowance row */}
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-gray-400">Approved allowance</span>
            <span className={`font-mono font-medium ${allowanceTooLow ? "text-yellow-400" : "text-gray-200"}`}>
              {formatStroops(allowance)}
            </span>
          </div>
        </div>
      )}

      {/* ── Insufficient balance warning ── */}
      {balanceTooLow && balance !== null && (
        <div
          role="status"
          className="rounded-lg bg-yellow-900/30 border border-yellow-600/50 px-3 py-2.5 text-xs text-yellow-300 space-y-1"
        >
          <p className="font-semibold">⚠ Balance too low</p>
          <p>
            Your current balance is{" "}
            <span className="font-mono">{formatStroops(balance)}</span>, which
            is less than the requested amount. The first payment will fail with{" "}
            <strong>TransferFailed (error 7)</strong> unless you top up before the merchant
            collects.
          </p>
        </div>
      )}

      {/* ── Insufficient allowance warning ── */}
      {allowanceTooLow && allowance !== null && (
        <div
          role="status"
          className="rounded-lg bg-yellow-900/30 border border-yellow-600/50 px-3 py-2.5 text-xs text-yellow-300 space-y-2"
        >
          <p className="font-semibold">⚠ Allowance too low</p>
          <p>
            The contract is only approved to transfer{" "}
            <span className="font-mono">{formatStroops(allowance)}</span> tokens,
            which is less than the requested amount. Payment will fail with{" "}
            <strong>TransferFailed (error 7)</strong>. Approve a higher allowance
            before subscribing.
          </p>
          <div className="bg-gray-900/60 rounded p-2 space-y-1">
            <p className="text-gray-400 font-medium">Approve via CLI:</p>
            <pre className="overflow-x-auto whitespace-pre-wrap break-all text-[10px] text-gray-300">
              {`stellar contract invoke \\
  --id ${tokenAddress} --source <your-key> --network testnet \\
  -- approve \\
  --from <subscriber-address> \\
  --spender ${CONTRACT_ID} \\
  --amount <desired-amount> \\
  --expiration-ledger 9999999`}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

// ─── Props ────────────────────────────────────────────────────────────────────

export interface SubscriptionFormInitialValues {
  /** Pre-filled merchant Stellar address (validated before use). */
  merchantAddress?: string;
  /** Pre-filled token contract address (validated before use). */
  tokenAddress?: string;
  /** Pre-filled payment amount. */
  amount?: string;
  /** Pre-filled interval in seconds. */
  interval?: string;
}

export interface SubscriptionFormProps {
  /**
   * Optional initial form values (FE-37 — pre-population from share URL).
   * Each field is only applied when non-empty; invalid values are ignored.
   */
  initialValues?: SubscriptionFormInitialValues;
}

export default function SubscriptionForm({ initialValues }: SubscriptionFormProps = {}) {
  const { publicKey, isCheckingFreighter, freighterInstalled } = useWallet();
  const { showToast } = useToast();

  // All hooks must be declared before any early return (rules-of-hooks)
  const [merchantAddress, setMerchantAddress] = useState(initialValues?.merchantAddress ?? '');
  const [tokenAddress, setTokenAddress]       = useState(initialValues?.tokenAddress ?? '');
  const [amount, setAmount]                   = useState(initialValues?.amount ?? '');
  const [interval, setInterval]               = useState(initialValues?.interval ?? String(DEFAULT_INTERVAL_SECONDS));
  const submitAttemptIdRef = useRef(0);
  const activeSubmitRef = useRef<{ id: number; publicKey: string; controller: AbortController } | null>(null);
  const cancelPollingRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);

  useFormPersist({ merchantAddress, tokenAddress, amount, interval });

  useEffect(() => {
    if (initialValues) return;
    const persisted = getPersistedFormData(String(DEFAULT_INTERVAL_SECONDS));
    setMerchantAddress(persisted.merchantAddress);
    setTokenAddress(persisted.tokenAddress);
    setAmount(persisted.amount);
    setInterval(persisted.interval);
  }, [initialValues]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      submitAttemptIdRef.current += 1;
      activeSubmitRef.current?.controller.abort();
      activeSubmitRef.current = null;
      cancelPollingRef.current?.();
      cancelPollingRef.current = null;
    };
  }, []);

  function beginSubmitAttempt(subscriber: string) {
    activeSubmitRef.current?.controller.abort();
    cancelPollingRef.current?.();
    cancelPollingRef.current = null;
    const attempt = {
      id: ++submitAttemptIdRef.current,
      publicKey: subscriber,
      controller: new AbortController(),
    };
    activeSubmitRef.current = attempt;
    return attempt;
  }

  function isCurrentSubmitAttempt(attempt: { id: number; publicKey: string; controller: AbortController }) {
    return mountedRef.current &&
      activeSubmitRef.current?.id === attempt.id &&
      !attempt.controller.signal.aborted;
  }

  useEffect(() => {
    const attempt = activeSubmitRef.current;
    if (attempt?.publicKey === publicKey) return;
    attempt?.controller.abort();
    if (attempt) activeSubmitRef.current = null;
    cancelPollingRef.current?.();
    cancelPollingRef.current = null;
    setIsSubmitting(false);
    setIsConfirming(false);
    setConfirmingTxHash(null);
  }, [publicKey]);

  // Issue #22 — track which address fields have been blurred so we can show
  // inline validation errors proactively (before the user hits submit).
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [fieldErrors, setFieldErrors]   = useState<FieldErrors>({});
  const [errorSummaryFocusRequest, setErrorSummaryFocusRequest] = useState(0);
  const [txError, setTxError]           = useState<TxErrorInfo | null>(null);
  const [txErrorExplorerUrl, setTxErrorExplorerUrl] = useState<string | null>(null);
  const [successData, setSuccessData]   = useState<SuccessData | null>(null);
  const [showConfirm, setShowConfirm]   = useState(false);
  // Cancel subscription confirmation modal
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelStatus, setCancelStatus] = useState<'idle' | 'pending' | 'done'>('idle');
  const [cancelTxHash, setCancelTxHash] = useState<string | null>(null);

  // ── Transaction poller ──────────────────────────────────────────────────────
  const { state: pollerState, startPolling, refresh: refreshTransactionStatus } = useTransactionPoller({
    onSuccess: (txHash) => {
      setIsConfirming(false);
      setSuccessData({
        txHash,
        merchant: merchantAddress.trim(),
        subscriber: publicKey ?? '',
        token: tokenAddress.trim(),
        amount,
        interval,
        issuedAt: new Date().toISOString(),
      });
    },
    onFailed: (errorMessage, txHash) => {
      setIsConfirming(false);
      const explorerUrl = buildExplorerUrl(txHash);
      setTxErrorExplorerUrl(explorerUrl);
      setTxError(classifyError(new Error(errorMessage)));
      const mapped = mapError(new Error(errorMessage));
      showToast({
        variant: 'error',
        message: mapped.message,
        action: mapped.action,
        docsUrl: mapped.docsUrl,
      });
    },
    onTimeout: (txHash, explorerUrl) => {
      showToast({
        variant: 'error',
        message: `Transaction status is unknown. Check ${txHash} before retrying.`,
      });
    },
  });

  // ── Fee simulation ────────────────────────────────────────────────────────
  // Pre-validate the form to decide whether to run simulation.
  // We compute a lightweight boolean here (without updating state) so the
  // hook's dependency array stays stable and doesn't fire extra simulations.
  const feeFormValid =
    !!publicKey &&
    !!merchantAddress.trim() &&
    !!tokenAddress.trim() &&
    !!amount.trim() &&
    !!interval.trim() &&
    isFormValid(
      validateSubscriptionForm({ merchantAddress, tokenAddress, amount, interval }),
    );

  const {
    status: feeStatus,
    minResourceFee,
    breakdown: feeBreakdown,
    error: feeError,
  } = useSimulateFee({
    subscriber: publicKey ?? '',
    merchant: merchantAddress,
    token: tokenAddress,
    amount: Number(amount) || 0,
    interval: Number(interval) || 0,
    formValid: feeFormValid,
  });

  // Cancel flow state (#765)
  const [showCancelConfirm, setShowCancelConfirm]   = useState(false);
  const [isCancelling, setIsCancelling]             = useState(false);
  const [cancelSuccess, setCancelSuccess]           = useState<CancelSuccessData | null>(null);
  const [cancelError, setCancelError]               = useState<TxErrorInfo | null>(null);

  // Allowance pre-flight state (populated when the confirm modal opens)
  const [allowanceResult, setAllowanceResult]       = useState<AllowanceResult | null>(null);
  const [isCheckingAllowance, setIsCheckingAllowance] = useState(false);

  // Guard: must have a valid contract address before rendering the form
  // (placed after hooks so rules-of-hooks is satisfied)
  if (!CONTRACT_ID) return <ContractConfigError />;

  // FE-47: Defer wallet-state-dependent rendering until after client mount.
  // On the server, publicKey is always null and freighterInstalled is always
  // false. Rendering before mount produces the same output on both sides, so
  // no hydration mismatch occurs. After mount we show the real wallet state.
  if (!mounted) {
    return <SkeletonForm />;
  }
  const intervalNum = Number(interval);

  // ── Cancel subscription state ──────────────────────────────────────────────
  const [cancelMerchant, setCancelMerchant]       = useState('');
  const [cancelToken, setCancelToken]             = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [isCancelling, setIsCancelling]           = useState(false);
  const [cancelSuccess, setCancelSuccess]         = useState<{ txHash: string; merchant: string } | null>(null);
  const [cancelError, setCancelError]             = useState<TxErrorInfo | null>(null);

  const labelCls = 'block text-sm font-semibold text-gray-100 mb-2.5';
  const hintCls = 'text-xs text-gray-300 leading-relaxed';
  const requiredMark = (
    <span aria-hidden="true" className="text-red-400 ml-1">
      *
    </span>
  );
  const fieldClass = (hasError: boolean) =>
    `${inputCls} ${hasError ? 'border-red-500 ring-1 ring-red-400/30 focus-visible:ring-red-400' : ''}`;
  const liveIntervalError =
    interval.trim() && Number.isInteger(intervalNum) &&
    (intervalNum < MIN_INTERVAL_SECONDS || intervalNum > MAX_INTERVAL_SECONDS)
      ? `Interval must be between ${MIN_INTERVAL_SECONDS.toLocaleString()} and ${MAX_INTERVAL_SECONDS.toLocaleString()} seconds.`
      : '';
  const intervalError = fieldErrors.interval || liveIntervalError;

  function resetForm() {
    setSuccessData(null);
    setTxError(null);
    setTxErrorExplorerUrl(null);
    setIsConfirming(false);
    setFieldErrors({});
    setShowConfirm(false);
    setAllowanceResult(null);
    setTouchedFields({});
    setMerchantAddress("");
    setTokenAddress("");
    setAmount("");
    setInterval(String(DEFAULT_INTERVAL_SECONDS));
    setShowPauseConfirm(false);
    setIsPaused(false);
    setPausedUntil(null);
    clearPersistedFormData(); // Clear persisted data on success (Issue #115)
  }

  /** Trigger the ConfirmationModal for cancel subscription */
  function handleCancelSubscriptionClick() {
    setShowCancelConfirm(true);
  }

  /** Called when user confirms cancellation inside CancelConfirmModal (Issue #791) */
  async function handleConfirmCancel() {
    setShowCancelConfirm(false);
    if (!publicKey || !successData) return;

    setCancelStatus('pending');
    try {
      const { txHash } = await buildAndSubmitCancel(
        { subscriber: publicKey, merchant: successData.merchant },
        CONTRACT_ID,
        publicKey,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );
      setCancelTxHash(txHash);
      setCancelStatus('done');
    } catch (err) {
      setTxError(classifyError(err));
      setCancelStatus('idle');
    }
  }

  /**
   * Issue #24 — Retry handler for network errors.
   * Clears the current error and re-submits using existing form values.
   * Form data is preserved so the user doesn't need to re-enter anything.
   */
  async function handleRetry() {
    if (!publicKey) return;
    const attempt = beginSubmitAttempt(publicKey);
    setTxError(null);
    setTxErrorExplorerUrl(null);
    setIsSubmitting(true);
    try {
      const { txHash, server } = await buildSignAndSubmitSubscribe(
        {
          subscriber: publicKey,
          merchant: merchantAddress.trim(),
          token: tokenAddress.trim(),
          amount: Number(amount),
          interval: Number(interval),
        },
        CONTRACT_ID,
        publicKey,
        NETWORK_PASSPHRASE,
        RPC_URL,
        attempt.controller.signal,
      );
      if (!isCurrentSubmitAttempt(attempt)) return;
      activeSubmitRef.current = null;
      setIsSubmitting(false);
      setIsConfirming(true);
      setConfirmingTxHash(txHash);
      cancelPollingRef.current = startPolling(txHash, server);
    } catch (err) {
      if (!isCurrentSubmitAttempt(attempt)) return;
      activeSubmitRef.current = null;
      const mapped = mapError(err);
      setTxError(classifyError(err));
      showToast({ variant: 'error', message: mapped.message, action: mapped.action, docsUrl: mapped.docsUrl });
      setIsSubmitting(false);
    }
   * Issue #22 — Proactive blur validation for address fields.
   * When a user leaves a field (onBlur) we mark it as touched and
   * immediately validate just that field, giving faster feedback than
   * waiting for form submission.
   */
  function handleFieldBlur(field: keyof FieldErrors) {
    setTouchedFields((prev) => ({ ...prev, [field]: true }));
    const errors = validateSubscriptionForm({
      merchantAddress,
      tokenAddress,
      amount,
      interval,
    });
    // Only surface errors for fields the user has already interacted with.
    setFieldErrors((prev) => ({
      ...prev,
      [field]: errors[field],
    }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setTxError(null);
    setSuccessData(null);

    const errors = validateSubscriptionForm({
      merchantAddress,
      tokenAddress,
      amount,
      interval,
    });
    setFieldErrors(errors);
    if (!isFormValid(errors)) {
      setErrorSummaryFocusRequest((request) => request + 1);
      return;
    }
    if (!publicKey) return;

    // Run the allowance check in the background while opening the confirm
    // modal. The check is non-blocking — the modal renders immediately and
    // the warning appears once the check completes.
    setAllowanceResult(null);
    setIsCheckingAllowance(true);
    checkAllowance({
      subscriberAddress: publicKey,
      tokenContractId: tokenAddress.trim(),
      contractId: CONTRACT_ID,
      requiredAmount: BigInt(Number(amount)),
      rpcUrl: RPC_URL,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .then((result) => setAllowanceResult(result))
      .catch(() => setAllowanceResult(null))
      .finally(() => setIsCheckingAllowance(false));

    setShowConfirm(true);
  }

  async function confirmAndSubmit() {
    setShowConfirm(false);
    if (!publicKey) return;

    const attempt = beginSubmitAttempt(publicKey);
    setIsSubmitting(true);
    setTxError(null);
    setTxErrorExplorerUrl(null);

    try {
      // Phase 1: build, sign, and submit — returns as soon as the RPC accepts the tx
      const { txHash, server } = await buildSignAndSubmitSubscribe(
        {
          subscriber: publicKey,
          merchant: merchantAddress.trim(),
          token: tokenAddress.trim(),
          amount: Number(amount),
          interval: Number(interval),
        },
        CONTRACT_ID,
        publicKey,
        NETWORK_PASSPHRASE,
        RPC_URL,
        attempt.controller.signal,
      );
      if (!isCurrentSubmitAttempt(attempt)) return;
      activeSubmitRef.current = null;

      // Transition to confirming state — show spinner with explorer link
      setIsSubmitting(false);
      setIsConfirming(true);

      // Phase 2: poll for confirmation (handled by useTransactionPoller callbacks above)
      cancelPollingRef.current = startPolling(txHash, server);
    } catch (err) {
      if (!isCurrentSubmitAttempt(attempt)) return;
      activeSubmitRef.current = null;
      // Submission itself failed (signing rejected, RPC error, etc.)
      const mapped = mapError(err);
      setTxError(classifyError(err));
      showToast({
        variant: 'error',
        message: mapped.message,
        action: mapped.action,
        docsUrl: mapped.docsUrl,
      });
      setIsSubmitting(false);
    }
  }

  // ── Cancel handlers ──────────────────────────────────────────────────────

  /**
   * Triggered when the user clicks "Cancel Subscription".
   * Validates the merchant address and shows the confirmation modal.
   */
  function handleCancelRequest(e: FormEvent) {
    e.preventDefault();
    setCancelError(null);
    if (!cancelMerchant.trim()) {
      setCancelError(classifyError(new Error('Merchant address is required to cancel a subscription.')));
      return;
    }
    if (!cancelToken.trim()) {
      setCancelError(classifyError(new Error('Token contract address is required to cancel a subscription.')));
      return;
    }
    if (!isValidGAddress(cancelMerchant.trim())) {
      setCancelError(classifyError(new Error('Invalid merchant address. Must be a 56-character Stellar G-address.')));
      return;
    }
    if (!/^(C)[A-Z2-7]{55}$/.test(cancelToken.trim())) {
      setCancelError(classifyError(new Error('Invalid token contract address. Must be a 56-character Stellar C-address.')));
      return;
    }
    setShowCancelConfirm(true);
  }

  /**
   * Confirmed by the user in the cancel confirmation modal.
   * Calls the real on-chain cancel() entry point via buildAndSubmitCancel().
   * Shows the transaction hash with a Stellar explorer link on success.
   */
  async function handleConfirmCancel() {
    setShowCancelConfirm(false);
    if (!publicKey) return;

    setIsCancelling(true);
    setCancelError(null);
    try {
      const result = await buildAndSubmitCancel(
        {
          subscriber: publicKey,
          merchant: cancelMerchant.trim(),
          token: cancelToken.trim(),
        },
        CONTRACT_ID,
        publicKey,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );

      setCancelSuccess({
        txHash: result.txHash,
        merchant: cancelMerchant.trim(),
      });
      setCancelMerchant('');
      setCancelToken('');
    } catch (err) {
      setCancelError(classifyError(err));
    } finally {
      setIsCancelling(false);
    }
  }

  /**
   * handleConfirmCancel — execute the on-chain cancel() call.
   *
   * #765: Previously this was a setTimeout(resolve, 300) placeholder.
   * Now calls buildAndSubmitCancel() from cancel_builder.ts which
   * builds, signs (via Freighter), and submits the real cancel transaction.
   */
  async function handleConfirmCancel() {
    setShowCancelConfirm(false);
    if (!publicKey || !successData) return;

    setIsCancelling(true);
    setCancelError(null);
    try {
      const result = await buildAndSubmitCancel(
        {
          subscriber: publicKey,
          merchant: successData.merchant,
        },
        CONTRACT_ID,
        publicKey,
        NETWORK_PASSPHRASE,
        RPC_URL,
      );

      setCancelSuccess({
        txHash: result.txHash,
        merchant: successData.merchant,
        subscriber: publicKey,
      });
      // Clear the subscription success state since it has now been cancelled
      setSuccessData(null);
    } catch (err) {
      setCancelError(classifyError(err));
    } finally {
      setIsCancelling(false);
    }
  }

  return (
    <ErrorBoundary name="SubscriptionForm">
    <div className="w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 text-white">
      {showConfirm && (
        <ConfirmModal
          merchantAddress={merchantAddress}
          tokenAddress={tokenAddress}
          amount={amount}
          interval={interval}
          allowanceResult={isCheckingAllowance ? null : allowanceResult}
          onConfirm={confirmAndSubmit}
          onCancel={() => setShowConfirm(false)}
        />
      )}
      {/* Cancel confirmation modal — Issue #791 */}
      {showCancelConfirm && successData && (
        <CancelConfirmModal
          merchantAddress={successData.merchant}
          onConfirm={handleConfirmCancel}
          onCancel={() => setShowCancelConfirm(false)}
        />
      )}
      {/* Address book modal */}
      <AddressBookModal
        isOpen={isAddressBookOpen}
        onClose={() => setIsAddressBookOpen(false)}
        entries={abEntries}
        entryList={abEntryList}
        addEntry={abAddEntry}
        updateEntry={abUpdateEntry}
        deleteEntry={abDeleteEntry}
        importBook={abImportBook}
        exportBook={abExportBook}
        prefilledAddress={merchantAddress || undefined}
      />
      <div className="flex items-start justify-between mb-1 gap-3">
        <h2 className="text-xl sm:text-2xl font-bold leading-tight">Create Subscription</h2>
        <div className="flex items-center gap-2 shrink-0">
          {/* Address book trigger */}
          {publicKey && (
            <button
              type="button"
              onClick={() => setIsAddressBookOpen(true)}
              aria-label="Open address book"
              title="Address book"
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300 hover:text-white hover:bg-gray-700 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
            >
              <span aria-hidden="true">📒</span>
              {abEntryList.length > 0 && (
                <span className="font-mono">{abEntryList.length}</span>
              )}
            </button>
          )}
          <span
            aria-label={publicKey ? "Wallet connected" : "Wallet disconnected"}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${
              publicKey
                ? "bg-green-900/60 text-green-300 border border-green-600/50"
                : "bg-gray-700/60 text-gray-400 border border-gray-600/50"
            }`}
          >
            <span
              className={`h-2 w-2 rounded-full ${publicKey ? "bg-green-400" : "bg-gray-500"}`}
              aria-hidden="true"
            />
            {publicKey ? "Connected" : "Disconnected"}
          </span>
        </div>
      </div>
      <p className="text-gray-400 text-sm mt-1 mb-4 leading-relaxed">
        Authorize a recurring on-chain payment using your Freighter wallet.{" "}
        <span className="text-gray-500">Fields marked <span className="text-red-400">*</span> are required.</span>
      </p>

      {/* Freighter not installed warning (Issue #110) */}
      {!isCheckingFreighter && !freighterInstalled && (
        <div
          role="alert"
          className="mb-5 rounded-lg bg-yellow-900/30 border border-yellow-600/50 p-4"
        >
          <div className="flex items-start gap-3">
            <span className="text-2xl flex-shrink-0" aria-hidden="true">
              ⚠️
            </span>
            <div className="flex-1">
              <p className="font-semibold text-yellow-300 mb-2">
                Freighter wallet not detected
              </p>
              <p className="text-sm text-gray-300 mb-3">
                Install the Freighter browser extension to create subscriptions.
              </p>
              <a
                href="https://www.freighter.app"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block px-4 py-2 bg-yellow-600 hover:bg-yellow-500 text-white text-xs font-semibold rounded-lg transition-colors"
              >
                Install Freighter
              </a>
            </div>
          </div>
        </div>
      )}

      {/* Contract ID with copy button */}
      <div className="flex items-center gap-2 mb-5 bg-gray-800/50 border border-gray-700/60 rounded-lg px-3 py-2">
        <span className="text-xs text-gray-500 font-medium shrink-0">
          Contract
        </span>
        <code
          className="flex-1 text-xs text-gray-300 font-mono truncate"
          title={CONTRACT_ID}
        >
          {CONTRACT_ID}
        </code>
        <CopyButton text={CONTRACT_ID} label="Copy" />
      </div>

      {/* Progress indicator — Phase 1: awaiting Freighter signature */}
      {isSubmitting && (
        <motion.div
          key="progress"
          variants={prefersReducedMotion ? reducedMotionVariants : fadeInVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <ProgressBar phase="submitting" />
        </motion.div>
      )}

      {/* Progress indicator — Phase 2: confirming on-chain */}
      {isConfirming && (
        <motion.div
          key="confirming"
          variants={prefersReducedMotion ? reducedMotionVariants : fadeInVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          <TransactionProgressIndicator
            title="Confirming transaction"
            description="Your transaction was submitted and is awaiting on-chain confirmation."
            steps={[
              { id: "submitted", label: "Transaction submitted", status: "completed" },
              {
                id: "confirmation",
                label: "On-chain confirmation",
                status: pollerState.status === "timeout" ? "pending" : "in-progress",
              },
            ]}
            currentStepIndex={1}
            showExplorerLink={Boolean(pollerState.explorerUrl)}
            explorerUrl={pollerState.explorerUrl ?? undefined}
            status={pollerState.status === "timeout" ? "unknown" : "loading"}
            onRefresh={pollerState.status === "timeout" ? refreshTransactionStatus : undefined}
          />
        </motion.div>
      )}

      {/* Transaction error */}
      {txError && (
        <ErrorCard
          error={txError}
          onDismiss={() => { setTxError(null); setTxErrorExplorerUrl(null); }}
          explorerUrl={txErrorExplorerUrl}
          onRetry={handleRetry}
        />
      )}

      {/* Cancelled card — shown after a successful cancel (Issue #791) */}
      {successData && cancelStatus === 'done' && cancelTxHash && (
        <CancelledCard txHash={cancelTxHash} onReset={resetForm} />
      )}

      {/* Success card — shown after successful subscription, until cancelled */}
      {successData && !(cancelStatus === 'done' && cancelTxHash) && (
        <SuccessCard
          data={successData}
          onReset={resetForm}
          onCancelSubscription={handleCancelSubscriptionClick}
          isCancelling={cancelStatus === 'pending'}
          getLabel={abGetLabel}
          isPaused={isPaused}
          pausedUntil={pausedUntil}
          onPauseClick={handlePauseClick}
          onResumeClick={handleResume}
          isPauseResumeSubmitting={isPauseResumeSubmitting}
        />
      )}

      {/* Hide the form after success */}
      {!successData && (
        <form
          onSubmit={handleSubmit}
          noValidate
          aria-busy={isSubmitting || isConfirming}
          aria-labelledby="form-heading"
          className="space-y-4"
        >
          <SubscriptionFormErrorSummary
            fieldErrors={fieldErrors}
            focusRequest={errorSummaryFocusRequest}
          />

          {/* Merchant address */}
          <div>
            <label
              htmlFor="merchantAddress"
              className={labelCls}
            >
              Merchant address{requiredMark}
              <span className="sr-only">(required)</span>
              {" "}<HelpTooltip
                content="The Stellar G-address of whoever will receive your recurring payments. Must be 56 characters starting with G."
                articleId="merchant-address"
              />
            </label>
            <input
              id="merchantAddress"
              type="text"
              placeholder="e.g. GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              autoComplete="off"
              value={merchantAddress}
              onChange={(e) => setMerchantAddress(e.target.value)}
              onChange={(e) => { setMerchantAddress(e.target.value); if (touchedFields.merchantAddress) handleFieldBlur('merchantAddress'); }}
              onBlur={() => handleFieldBlur('merchantAddress')}
              disabled={isSubmitting || isConfirming}
              required
              aria-required="true"
              aria-describedby={`help-merchant${fieldErrors.merchantAddress ? " err-merchant" : ""}`}
              aria-invalid={!!fieldErrors.merchantAddress}
              className={fieldClass(!!fieldErrors.merchantAddress)}
            />
            <p id="help-merchant" className={hintCls}>
              The merchant&apos;s Stellar account public key — starts with{" "}
              <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">G</code>,
              56 characters. Example:{" "}
              <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs font-mono">
                GABC…WXYZ
              </code>
            </p>
            {fieldErrors.merchantAddress && (
              <p
                id="err-merchant"
                className="mt-2 text-xs text-red-400 font-medium"
              >
                {fieldErrors.merchantAddress}
              </p>
            )}
          </div>

          {/* Token contract address — combobox with known-token autocomplete */}
          <div>
            <label
              htmlFor="tokenAddress"
              className={labelCls}
            >
              Token contract address{requiredMark}
              {" "}<HelpTooltip
                content="The SEP-41 token contract address (C-address) to use for payments. Must not be the SorobanPay contract itself."
                articleId="token-contract"
              />
              <span className="sr-only"> (required)</span>
            </label>
            <TokenCombobox
              id="tokenAddress"
              value={tokenAddress}
              onChange={setTokenAddress}
              onChange={(v) => { setTokenAddress(v); if (touchedFields.tokenAddress) handleFieldBlur('tokenAddress'); }}
              onBlur={() => handleFieldBlur('tokenAddress')}
              disabled={isSubmitting || isConfirming}
              hasError={!!fieldErrors.tokenAddress}
              tokens={getKnownTokens(NETWORK_NAME)}
              ariaDescribedBy={`help-token${fieldErrors.tokenAddress ? " err-token" : ""}`}
            />
            <p id="help-token" className={hintCls}>
              Search by symbol (e.g. <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">USDC</code>)
              or paste a full SEP-41 contract address (starts with{" "}
              <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">C</code>,
              56 characters). Token list is network-aware ({NETWORK_NAME}).
            </p>
            {fieldErrors.tokenAddress && (
              <p
                id="err-token"
                className="mt-2 text-xs text-red-400 font-medium"
              >
                {fieldErrors.tokenAddress}
              </p>
            )}
          </div>

          {/* Amount */}
          <div>
            <label
              htmlFor="amount"
              className={labelCls}
            >
              Amount{requiredMark}
              <span className="sr-only"> (required)</span>
              {" "}<HelpTooltip
                content="Token units to transfer per interval. Must be positive and at most 10¹⁸. The first payment is collectable immediately after subscribing."
                articleId="create-subscription"
              />
            </label>
            <input
              id="amount"
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min="1"
              step="1"
              placeholder="100"
              autoComplete="off"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              disabled={isSubmitting || isConfirming}
              required
              aria-required="true"
              aria-describedby={`help-amount${fieldErrors.amount ? " err-amount" : ""}`}
              aria-invalid={!!fieldErrors.amount}
              className={fieldClass(!!fieldErrors.amount)}
            />
            <p id="help-amount" className={hintCls}>
              Required. Enter the recurring payment amount in token units.
            </p>
            {fieldErrors.amount && (
              <p
                id="err-amount"
                className="mt-2 text-xs text-red-400 font-medium"
              >
                {fieldErrors.amount}
              </p>
            )}
            {/* Inline low-allowance hint — shown when we have a result and the
                confirm modal is closed (avoids duplicate warning) */}
            {!showConfirm && allowanceResult && !allowanceResult.sufficient && (
              <div className="mt-2">
                <AllowanceWarning
                  allowance={allowanceResult.allowance}
                  shortfall={allowanceResult.shortfall}
                />
              </div>
            )}
          </div>

          {/* Interval */}
          <div>
            <label
              htmlFor="interval"
              className={labelCls}
            >
              Interval{requiredMark}
              <span className="sr-only"> (required)</span>
              {" "}<HelpTooltip
                content="How often payments recur in seconds. Min 86,400 (1 day), max 31,536,000 (365 days). E.g. 2,592,000 ≈ monthly."
                articleId="payment-interval"
              />
            </label>
            <input
              id="interval"
              type="number"
              inputMode="numeric"
              pattern="[0-9]*"
              min="86400"
              max="31536000"
              step="1"
              autoComplete="off"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              disabled={isSubmitting || isConfirming}
              required
              aria-required="true"
              aria-describedby={`help-interval${intervalError ? ' err-interval' : ''}`}
              aria-invalid={!!intervalError}
              className={fieldClass(!!intervalError)}
            />
            <p id="help-interval" className={hintCls}>
              Required. The recurrence cadence for the subscription. Default is 30 days.
            </p>
            {intervalError && (
              <p id="err-interval" className="mt-2 text-xs text-red-400 font-medium">
                {intervalError}
              </p>
            )}
          </div>

          {/* Share / QR code (FE-37) — merchant portal share button */}
          <ShareQRCode
            merchant={merchantAddress}
            token={tokenAddress}
            amount={amount}
            interval={interval}
          />

          {/* Fee estimate (shown when all fields are valid, before submission) */}
          <FeeEstimate
            status={feeStatus}
            minResourceFee={minResourceFee}
            breakdown={feeBreakdown}
            error={feeError}
          />

          {/* Submit */}
          <div>
            {!publicKey && (
              <p
                id="hint-wallet"
                className="mb-3 text-xs text-yellow-400 font-medium"
                role="status"
              >
                Connect your Freighter wallet to enable submission.
              </p>
            )}
            <button
              type="submit"
              disabled={isSubmitting || isConfirming || !publicKey}
              aria-describedby={!publicKey ? "hint-wallet" : undefined}
              aria-busy={isSubmitting || isConfirming}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600
                         hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50
                         disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold
                         transition-all duration-150 min-h-[48px] hover:shadow-lg active:shadow-md
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                         focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              {(isSubmitting || isConfirming) && (
                <svg
                  className="animate-spin h-5 w-5 text-white"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  role="img"
                  aria-label={isConfirming ? "Confirming" : "Submitting"}
                >
                  <title>{isConfirming ? "Confirming" : "Submitting"}</title>
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8v8H4z"
                  />
                </svg>
              )}
              {isConfirming ? "Confirming…" : isSubmitting ? "Submitting…" : "Authorize Subscription"}
            </button>
          </div>
        </form>
      )}

      {/* ── Cancel subscription section ─────────────────────────────────────── */}
      <div className="mt-8 pt-6 border-t border-gray-700/60">
        <h3 className="text-base font-semibold text-gray-200 mb-1">
          Cancel a subscription
        </h3>
        <p className="text-xs text-gray-400 mb-4 leading-relaxed">
          Permanently remove an active subscription. The merchant will no longer
          be able to collect payments. This submits a real on-chain{" "}
          <code className="bg-gray-800 px-1 rounded text-gray-200 text-xs">cancel()</code>{" "}
          transaction.
        </p>

        {/* Cancel success */}
        {cancelSuccess && (
          <div
            role="alert"
            className="mb-4 rounded-xl bg-gradient-to-br from-green-900/60 to-green-800/30 border-2 border-green-600/60 p-4 text-sm space-y-3"
          >
            <div className="flex items-center gap-3">
              <span className="text-2xl flex-shrink-0" aria-hidden="true">✓</span>
              <p className="font-semibold text-green-300">Subscription cancelled successfully!</p>
            </div>
            <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
              <p className="text-gray-400 text-xs mb-1 font-medium">Transaction hash</p>
              <div className="flex items-start gap-2">
                <p className="flex-1 text-gray-200 break-all font-mono text-xs leading-relaxed">
                  {cancelSuccess.txHash}
                </p>
                <CopyButton text={cancelSuccess.txHash} label="Copy" />
              </div>
            </div>
            <a
              href={`https://stellar.expert/explorer/testnet/tx/${cancelSuccess.txHash}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-green-300 underline underline-offset-2 hover:text-green-200 transition-colors"
            >
              View on Stellar Expert ↗
            </a>
            <button
              onClick={() => { setCancelSuccess(null); setCancelMerchant(''); }}
              className="w-full rounded-lg border border-green-600/70 text-green-300 hover:bg-green-900/40 py-2.5 text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-green-400"
            >
              Cancel another subscription
            </button>
          </div>
        )}

        {/* Cancel error */}
        {cancelError && (
          <ErrorCard error={cancelError} onDismiss={() => setCancelError(null)} />
        )}

        {/* Cancel progress */}
        {isCancelling && (
          <div
            className="mb-4 p-4 bg-red-900/20 border border-red-600/40 rounded-lg"
            role="status"
            aria-label="Cancellation in progress"
          >
            <div className="flex items-center gap-2">
              <svg
                className="animate-spin h-4 w-4 text-red-400"
                xmlns="http://www.w3.org/2000/svg"
                fill="none"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <span className="text-sm text-red-300">Submitting cancellation…</span>
            </div>
          </div>
        )}

        {!cancelSuccess && (
          <form onSubmit={handleCancelRequest} noValidate aria-busy={isCancelling} className="space-y-3">
            <div>
              <label htmlFor="cancelMerchant" className="block text-sm font-semibold text-gray-100 mb-2">
                Merchant address
                <span aria-hidden="true" className="text-red-400 ml-1">*</span>
              </label>
              <input
                id="cancelMerchant"
                type="text"
                placeholder="e.g. GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                autoComplete="off"
                value={cancelMerchant}
                onChange={(e) => setCancelMerchant(e.target.value)}
                disabled={isCancelling}
                required
                aria-required="true"
                className={inputCls}
              />
              <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
                The merchant&apos;s Stellar G-address for the subscription you want to cancel.
              </p>
            </div>
            <div>
              <label htmlFor="cancelToken" className="block text-sm font-semibold text-gray-100 mb-2">
                Token contract address
                <span aria-hidden="true" className="text-red-400 ml-1">*</span>
              </label>
              <input
                id="cancelToken"
                type="text"
                placeholder="e.g. CXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
                autoComplete="off"
                value={cancelToken}
                onChange={(e) => setCancelToken(e.target.value)}
                disabled={isCancelling}
                required
                aria-required="true"
                className={inputCls}
              />
              <p className="mt-1.5 text-xs text-gray-400 leading-relaxed">
                The token contract tied to the active subscription being cancelled.
              </p>
            </div>
            {!publicKey && (
              <p className="text-xs text-yellow-400 font-medium" role="status">
                Connect your Freighter wallet to cancel a subscription.
              </p>
            )}
            <button
              type="submit"
              disabled={isCancelling || !publicKey}
              className="w-full flex items-center justify-center gap-2 rounded-lg bg-red-700
                         hover:bg-red-600 active:bg-red-800 disabled:opacity-50
                         disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold
                         transition-all duration-150 min-h-[48px]
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400
                         focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
            >
              {isCancelling ? "Cancelling…" : "Cancel Subscription"}
            </button>
          </form>
        )}
      </div>
    </div>
    </ErrorBoundary>
  );
}
