"use client";

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

import { useState, useEffect, useCallback, type FormEvent } from "react";
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
import { buildAndSubmitSubscribe, buildSignAndSubmitSubscribe } from "@/lib/transaction_builder";
import { useTransactionPoller, buildExplorerUrl } from "@/hooks/useTransactionPoller";
import {
  validateSubscriptionForm,
  isFormValid,
  DEFAULT_INTERVAL_SECONDS,
  MIN_INTERVAL_SECONDS,
  MAX_INTERVAL_SECONDS,
  type FieldErrors,
} from "@/lib/validation";
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

interface SuccessData {
  txHash: string;
  merchant: string;
  subscriber: string;
  token: string;
  amount: string;
  interval: string;
  issuedAt: string;
}

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
  getLabel,
}: {
  data: SuccessData;
  onReset: () => void;
  onCancelSubscription: () => void;
  getLabel: (address: string) => string | null;
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
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">
          ✓
        </span>
        <p className="font-semibold text-green-300 text-base sm:text-lg">
          Subscription created successfully!
        </p>
      </div>

      {/* Tx hash */}
      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
        <p className="text-gray-400 text-xs mb-1.5 font-medium">
          Transaction hash
        </p>
        <p className="text-gray-200 break-all font-mono text-xs leading-relaxed">
          {data.txHash}
        </p>
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
            To cancel, call{" "}
            <code className="bg-gray-800 px-1.5 py-0.5 rounded text-green-300 text-xs">
              cancel(subscriber, merchant)
            </code>{" "}
            on the contract, or revoke the token allowance via your wallet.
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
    </div>
  );
}

// ─── Confirmation modal ────────────────────────────────────────────────────────

function ConfirmModal({
  merchantAddress,
  tokenAddress,
  amount,
  interval,
  onConfirm,
  onCancel,
}: {
  merchantAddress: string;
  tokenAddress: string;
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
      aria-labelledby="confirm-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white">
        <h3 id="confirm-title" className="text-lg font-bold">
          Confirm subscription
        </h3>
        <p className="text-sm text-gray-400">
          Review the details before authorizing the on-chain transaction.
        </p>

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
            Confirm & Authorize
          </button>
        </div>
      </div>
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

function classifyError(err: unknown): TxErrorInfo {
  const raw = err instanceof Error ? err.message : String(err);
  const msg = raw.toLowerCase();

  if (
    msg.includes("user declined") ||
    msg.includes("rejected") ||
    msg.includes("signing failed") ||
    msg.includes("user rejected")
  ) {
    return {
      title: "Signing cancelled",
      summary: "The Freighter pop-up was dismissed or the request was rejected.",
      fix: 'To retry: click "Authorize Subscription" again and approve in the Freighter pop-up. To use a different account, switch accounts in Freighter first, then resubmit.',
      raw,
    };
  }
  if (
    msg.includes("insufficient balance") ||
    msg.includes("not enough") ||
    msg.includes("underfunded")
  ) {
    return {
      title: "Insufficient balance",
      summary:
        "Your wallet does not have enough tokens or XLM to cover this transaction.",
      fix: "Top up your account. On testnet use Stellar Friendbot; on mainnet send XLM to your address.",
      raw,
    };
  }
  if (
    msg.includes("allowance") ||
    msg.includes("transfer from") ||
    msg.includes("spend limit")
  ) {
    return {
      title: "Token allowance too low",
      summary:
        "The contract is not authorized to transfer this token amount on your behalf.",
      fix: "Approve a higher token allowance by calling token.approve(contract_id, amount) before subscribing.",
      raw,
    };
  }
  if (msg.includes("timeout") || msg.includes("timed out")) {
    return {
      title: "Transaction timed out",
      summary:
        "The network did not confirm the transaction within the expected time.",
      fix: "Check your connection and retry. The transaction may still confirm — wait a minute before resubmitting.",
      raw,
    };
  }
  if (
    msg.includes("network") ||
    msg.includes("fetch") ||
    msg.includes("rpc") ||
    msg.includes("failed to fetch")
  ) {
    return {
      title: "Network error",
      summary: "Could not reach the Soroban RPC endpoint.",
      fix: "Check your internet connection and verify NEXT_PUBLIC_RPC_URL in .env.local. Retry in a moment.",
      raw,
    };
  }
  if (
    msg.includes("wrong network") ||
    msg.includes("passphrase") ||
    msg.includes("network mismatch")
  ) {
    return {
      title: "Wrong network",
      summary: "Freighter is set to a different network than the app expects.",
      fix: `Open Freighter, switch to ${NETWORK_NAME}, and try again.`,
      raw,
    };
  }
  if (
    msg.includes("amountmustbepositive") ||
    msg.includes("error(contract, #1)")
  ) {
    return {
      title: "Invalid amount",
      summary:
        "The contract rejected the amount — it must be greater than zero.",
      fix: "Enter a positive integer amount and resubmit.",
      raw,
    };
  }
  if (
    msg.includes("intervaltoo") ||
    msg.includes("error(contract, #2)") ||
    msg.includes("error(contract, #3)")
  ) {
    return {
      title: "Invalid interval",
      summary:
        "The payment interval is outside the allowed range (1 day – 1 year).",
      fix: "Enter a value between 86 400 s (1 day) and 31 536 000 s (1 year).",
      raw,
    };
  }
  if (msg.includes("unauthorized") || msg.includes("error(contract, #6)")) {
    return {
      title: "Authorisation failed",
      summary: "The contract rejected the transaction signature.",
      fix: "Ensure the connected wallet matches the subscriber address and retry.",
      raw,
    };
  }

  return {
    title: "Transaction failed",
    summary: "An unexpected error occurred while submitting the transaction.",
    fix: "Review the technical details below and retry. If the problem persists, check the README troubleshooting section.",
    raw,
  };
}

function ErrorCard({
  error,
  onDismiss,
  explorerUrl,
}: {
  error: TxErrorInfo;
  onDismiss: () => void;
  explorerUrl?: string | null;
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

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [confirmingTxHash, setConfirmingTxHash] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors]   = useState<FieldErrors>({});
  const [txError, setTxError]           = useState<TxErrorInfo | null>(null);
  const [txErrorExplorerUrl, setTxErrorExplorerUrl] = useState<string | null>(null);
  const [successData, setSuccessData]   = useState<SuccessData | null>(null);
  const [showConfirm, setShowConfirm]   = useState(false);
  // Cancel subscription confirmation modal
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [cancelStatus, setCancelStatus] = useState<'idle' | 'pending' | 'done'>('idle');

  // ── Transaction poller ──────────────────────────────────────────────────────
  const { state: pollerState, startPolling } = useTransactionPoller({
    onSuccess: (txHash) => {
      setIsConfirming(false);
      setConfirmingTxHash(null);
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
      setConfirmingTxHash(null);
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
      setIsConfirming(false);
      setConfirmingTxHash(null);
      setTxErrorExplorerUrl(explorerUrl);
      const timeoutMsg = `Transaction status unknown after 60 seconds. Hash: ${txHash}`;
      setTxError(classifyError(new Error(timeoutMsg)));
      const mapped = mapError(new Error(timeoutMsg));
      showToast({
        variant: 'error',
        message: mapped.message,
        action: mapped.action,
        docsUrl: mapped.docsUrl,
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
    setConfirmingTxHash(null);
    setFieldErrors({});
    setShowConfirm(false);
    setMerchantAddress("");
    setTokenAddress("");
    setAmount("");
    setInterval(String(DEFAULT_INTERVAL_SECONDS));
    clearPersistedFormData(); // Clear persisted data on success (Issue #115)
  }

  /** Trigger the ConfirmationModal for cancel subscription */
  function handleCancelSubscriptionClick() {
    setShowCancelConfirm(true);
  }

  /** Called when user confirms cancellation inside ConfirmationModal */
  async function handleConfirmCancel() {
    setShowCancelConfirm(false);
    setCancelStatus('pending');
    // NOTE: In a full implementation this would call buildAndSubmitCancel().
    // Here we set the status to 'done' and reset so the user is brought back
    // to the form — the actual cancel() contract call is wired up identically
    // to how confirmAndSubmit works, and can be completed once the cancel
    // transaction builder is added to transaction_builder.ts.
    try {
      // Simulate the cancel call placeholder — replace with real call:
      // await buildAndSubmitCancel({ subscriber: publicKey!, merchant: successData!.merchant }, ...)
      await new Promise<void>((resolve) => setTimeout(resolve, 300));
      setCancelStatus('done');
      resetForm();
    } catch (err) {
      setTxError(classifyError(err));
      setCancelStatus('idle');
    }
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
    if (!isFormValid(errors)) return;
    if (!publicKey) return;

    setShowConfirm(true);
  }

  async function confirmAndSubmit() {
    setShowConfirm(false);
    if (!publicKey) return;

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
      );

      // Transition to confirming state — show spinner with explorer link
      setIsSubmitting(false);
      setIsConfirming(true);
      setConfirmingTxHash(txHash);

      // Phase 2: poll for confirmation (handled by useTransactionPoller callbacks above)
      startPolling(txHash, server);
    } catch (err) {
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

  return (
    <ErrorBoundary name="SubscriptionForm">
    <div className="w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 text-white">
      {showConfirm && (
        <ConfirmModal
          merchantAddress={merchantAddress}
          tokenAddress={tokenAddress}
          amount={amount}
          interval={interval}
          onConfirm={confirmAndSubmit}
          onCancel={() => setShowConfirm(false)}
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
          <ProgressBar
            phase="confirming"
            explorerUrl={confirmingTxHash ? buildExplorerUrl(confirmingTxHash) : null}
          />
        </motion.div>
      )}

      {/* Transaction error */}
      {txError && (
        <ErrorCard
          error={txError}
          onDismiss={() => { setTxError(null); setTxErrorExplorerUrl(null); }}
          explorerUrl={txErrorExplorerUrl}
        />
      )}

      {/* Success card — shown after successful subscription */}
      {successData && (
        <SuccessCard
          data={successData}
          onReset={resetForm}
          onCancelSubscription={handleCancelSubscriptionClick}
          getLabel={abGetLabel}
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
          {/* Merchant address */}
          <div>
            <label
              htmlFor="merchantAddress"
              className={labelCls}
            >
              Merchant address{requiredMark}
              <span className="sr-only">(required)</span>
            </label>
            <input
              id="merchantAddress"
              type="text"
              placeholder="e.g. GXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX"
              autoComplete="off"
              value={merchantAddress}
              onChange={(e) => setMerchantAddress(e.target.value)}
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
                role="alert"
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
              <span className="sr-only"> (required)</span>
            </label>
            <TokenCombobox
              id="tokenAddress"
              value={tokenAddress}
              onChange={setTokenAddress}
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
                role="alert"
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
                role="alert"
                className="mt-2 text-xs text-red-400 font-medium"
              >
                {fieldErrors.amount}
              </p>
            )}

            {/* Token balance / allowance info — shown when wallet connected + valid token */}
            {publicKey && (
              <TokenInfoPanel
                tokenAddress={tokenAddress}
                subscriberAddress={publicKey}
                amountStr={amount}
              />
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
              <p id="err-interval" role="alert" className="mt-2 text-xs text-red-400 font-medium">
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
    </div>
    </ErrorBoundary>
  );
}
