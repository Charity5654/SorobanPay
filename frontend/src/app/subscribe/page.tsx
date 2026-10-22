"use client";

/**
 * /subscribe page (FE-37)
 *
 * Handles the URL scheme: /subscribe?merchant=G...&token=C...&amount=100&interval=2592000
 *
 * Reads query parameters, validates them, and passes valid values to the
 * SubscriptionForm as initialValues. Invalid parameters are silently ignored
 * and the form shows blank for those fields per the acceptance criteria.
 */

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import SubscriptionForm from "@/components/SubscriptionForm";
import ContractFooter from "@/components/ContractFooter";
import { useWallet } from "@/hooks/useWallet";

// ─── Stellar address patterns ─────────────────────────────────────────────────
// G... for accounts (56 chars), C... for contracts (56 chars)
const RE_STELLAR_ADDRESS = /^[GC][A-Z2-7]{55}$/;
const RE_POSITIVE_INTEGER = /^[1-9]\d*$/;
// Interval must be between 86400 (1 day) and 31536000 (1 year)
const MIN_INTERVAL = 86400;
const MAX_INTERVAL = 31536000;

function isValidStellarAddress(value: string | null): value is string {
  return !!value && RE_STELLAR_ADDRESS.test(value.trim());
}

function isValidAmount(value: string | null): value is string {
  return !!value && RE_POSITIVE_INTEGER.test(value.trim());
}

function isValidInterval(value: string | null): value is string {
  if (!value || !RE_POSITIVE_INTEGER.test(value.trim())) return false;
  const n = Number(value.trim());
  return n >= MIN_INTERVAL && n <= MAX_INTERVAL;
}

// ─── Inner component (needs Suspense for useSearchParams) ─────────────────────

function SubscribePageInner() {
  const searchParams = useSearchParams();
  const { publicKey, isConnecting, connectError, freighterInstalled, connect, disconnect } =
    useWallet();

  // Parse and validate query params — invalid ones become undefined (form shows blank)
  const rawMerchant = searchParams.get("merchant");
  const rawToken = searchParams.get("token");
  const rawAmount = searchParams.get("amount");
  const rawInterval = searchParams.get("interval");

  const initialValues = {
    merchantAddress: isValidStellarAddress(rawMerchant) ? rawMerchant.trim() : "",
    tokenAddress: isValidStellarAddress(rawToken) ? rawToken.trim() : "",
    amount: isValidAmount(rawAmount) ? rawAmount.trim() : "",
    interval: isValidInterval(rawInterval) ? rawInterval.trim() : "",
  };

  const hasPrefilledParams = Object.values(initialValues).some((v) => v !== "");
  const shortKey = publicKey
    ? `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
    : null;

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12">
      {/* Header */}
      <div className="w-full max-w-lg mb-8 text-center">
        <h1 className="text-4xl font-extrabold tracking-tight mb-2">SorobanPay</h1>
        <p className="text-gray-400 text-sm">Decentralized recurring payments on Stellar</p>
      </div>

      {/* Pre-filled banner */}
      {hasPrefilledParams && (
        <div
          role="status"
          className="w-full max-w-lg mb-4 rounded-xl border border-blue-700/50 bg-blue-950/40 px-4 py-3 text-sm text-blue-200"
        >
          <span className="font-semibold">Pre-filled via share link.</span>{" "}
          Review the values below before authorizing.
        </div>
      )}

      {/* Wallet section */}
      <div className="w-full max-w-lg mb-6">
        {!publicKey ? (
          <div className="bg-gray-900 rounded-2xl p-6 shadow-lg">
            {!freighterInstalled && (
              <div role="alert" className="mb-4 rounded-lg bg-yellow-900/60 border border-yellow-600 p-3 text-sm text-yellow-200">
                Freighter wallet is not installed.{" "}
                <a href="https://www.freighter.app" target="_blank" rel="noopener noreferrer" className="underline hover:text-yellow-100">
                  Install Freighter
                </a>{" "}
                to continue.
              </div>
            )}
            {connectError && (
              <div role="alert" className="mb-4 rounded-lg bg-red-900/60 border border-red-600 p-3 text-sm text-red-200">
                {connectError}
              </div>
            )}
            <button
              onClick={connect}
              disabled={isConnecting}
              className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                         disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold
                         transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
            >
              {isConnecting ? "Connecting…" : "Connect Freighter Wallet"}
            </button>
          </div>
        ) : (
          <div className="bg-gray-900 rounded-2xl p-4 shadow-lg flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 min-w-0">
              <span className="h-2 w-2 rounded-full bg-green-400 flex-shrink-0" aria-hidden="true" />
              <span className="text-sm text-gray-300 flex-shrink-0">Connected:</span>
              <span className="font-mono text-white text-sm truncate">{shortKey}</span>
            </div>
            <button
              onClick={disconnect}
              className="text-xs text-gray-400 hover:text-red-400 transition-colors flex-shrink-0
                         focus:outline-none focus:ring-1 focus:ring-red-400 rounded px-2 py-1"
            >
              Disconnect
            </button>
          </div>
        )}
      </div>

      {/* Subscription form with pre-populated values */}
      {publicKey ? (
        <SubscriptionForm initialValues={initialValues} />
      ) : (
        <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-gray-900/40 p-8 text-center space-y-3">
          <p className="text-2xl" aria-hidden="true">🔒</p>
          <p className="text-gray-300 font-semibold text-sm">Connect your wallet to continue</p>
          <p className="text-gray-500 text-xs leading-relaxed">
            Connect Freighter above to authorize this subscription.
          </p>
        </div>
      )}

      {/* Contract footer — links to deployed contract explorer */}
      <ContractFooter />
    </main>
  );
}

// ─── Page (with Suspense boundary for useSearchParams) ────────────────────────

export default function SubscribePage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen flex items-center justify-center">
          <p className="text-gray-400 text-sm">Loading…</p>
        </main>
      }
    >
      <SubscribePageInner />
    </Suspense>
  );
}
