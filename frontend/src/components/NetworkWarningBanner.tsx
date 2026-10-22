"use client";

/**
 * NetworkWarningBanner.tsx
 *
 * Displays a prominent warning banner when connected to mainnet to prevent
 * accidental live transactions. Shows network environment status clearly.
 * Dismissible on testnet, persistent on mainnet for safety.
 */

import { useState } from "react";
import { getNetworkInfo } from "@/lib/runtime_config";

export function NetworkWarningBanner() {
  const [isDismissed, setIsDismissed] = useState(false);
  const { name: networkName, isProduction } = getNetworkInfo();

  // Only show banner if not dismissed
  if (isDismissed && !isProduction) {
    return null;
  }

  // Mainnet: red critical warning
  if (isProduction) {
    return (
      <div
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="w-full border-b-2 border-red-600 bg-gradient-to-r from-red-900 to-red-800 px-4 py-3 text-white shadow-lg"
      >
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span className="shrink-0 text-2xl" aria-hidden="true">🚨</span>
            <div className="min-w-0 break-words">
              <p className="font-bold text-red-100">{networkName.toUpperCase()} - LIVE TRANSACTIONS</p>
              <p id="network-warning-description" className="text-sm text-red-200">
                You are connected to Stellar {networkName.toLowerCase()}. All transactions are real and irreversible.
              </p>
            </div>
          </div>
          <div className="flex-shrink-0">
            <span className="inline-block bg-red-700 text-white px-3 py-1 rounded-full text-xs font-semibold">
              PRODUCTION
            </span>
          </div>
        </div>
      </div>
    );
  }

  // Testnet: yellow warning (dismissible)
  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      className="w-full border-b-2 border-yellow-600 bg-gradient-to-r from-yellow-900 to-yellow-800 px-4 py-3 text-white shadow-md"
    >
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="shrink-0 text-xl" aria-hidden="true">⚠️</span>
          <div className="min-w-0 break-words">
            <p className="font-semibold text-yellow-100">
              {networkName.toUpperCase()} - DEVELOPMENT ONLY
            </p>
            <p id="network-warning-description" className="text-sm text-yellow-200">
              You are connected to Stellar {networkName.toLowerCase()}. Transactions use test assets (no real value).
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setIsDismissed(true)}
          className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center self-start rounded-md p-2 text-yellow-100 transition-colors hover:bg-yellow-700/50 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-yellow-900 motion-reduce:transition-none sm:self-center"
          aria-label={`Dismiss ${networkName.toLowerCase()} warning`}
          aria-describedby="network-warning-description"
          title="Dismiss testnet warning"
        >
          <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
            <path
              fillRule="evenodd"
              d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
