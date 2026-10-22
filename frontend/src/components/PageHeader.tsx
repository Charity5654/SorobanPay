"use client";

/**
 * PageHeader.tsx
 *
 * Visible page header showing SorobanPay branding, network environment,
 * and wallet connection state. Improves user orientation and provides
 * quick access to wallet status.
 */

import { useWallet } from "@/hooks/useWallet";
import { getNetworkInfo } from "@/lib/runtime_config";
import { AddressDisplay } from "@/components/AddressDisplay";

export function PageHeader() {
  const { publicKey, isConnecting, freighterInstalled } = useWallet();
  const { name: networkName, isProduction } = getNetworkInfo();

  // Network badge styling
  const networkBadgeStyle = isProduction
    ? "bg-red-900/30 border-red-600/50 text-red-300"
    : "bg-yellow-900/30 border-yellow-600/50 text-yellow-300";

  const networkBadgeLabel = isProduction ? "🔴 Mainnet" : "🟡 Testnet";

  // Wallet status
  const walletStatus = isConnecting
    ? "Connecting..."
    : publicKey
      ? `Connected: ${publicKey.slice(0, 8)}...`
      : freighterInstalled
        ? "Click to connect"
        : "Freighter not installed";

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-950 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Branding */}
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-blue-600 to-blue-700">
              <span className="text-white font-bold text-lg">₹</span>
            </div>
            <div className="flex flex-col">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white">
                SorobanPay
              </h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">
                Decentralized Recurring Payments
              </p>
            </div>
          </div>

          {/* Center: Status Info (hidden on mobile, shown on tablet+) */}
          <div className="hidden sm:flex items-center gap-3">
            {/* Network Badge */}
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${networkBadgeStyle}`}
              role="status"
              aria-label={`Network: ${networkName}`}
            >
              <span className="text-sm font-medium">{networkBadgeLabel}</span>
              <span className="text-xs text-gray-400">
                {networkName === "Mainnet" ? "Live" : "Test"}
              </span>
            </div>

            {/* Divider */}
            <div className="h-6 w-px bg-gray-300 dark:bg-gray-700" />

            {/* Wallet Status */}
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg border ${
                publicKey
                  ? "bg-green-900/20 border-green-600/50 text-green-300"
                  : "bg-gray-800 border-gray-700 text-gray-400"
              }`}
              role="status"
              aria-label="Wallet connection status"
            >
              <span
                className={`w-2 h-2 rounded-full ${
                  publicKey ? "bg-green-500" : "bg-gray-500"
                }`}
              />
              <span className="text-sm font-medium truncate">
                {publicKey ? (
                  <AddressDisplay
                    address={publicKey}
                    truncateLen={8}
                  />
                ) : isConnecting ? (
                  "Connecting..."
                ) : freighterInstalled ? (
                  "Ready to connect"
                ) : (
                  "No wallet"
                )}
              </span>
            </div>
          </div>

          {/* Right: Network indicator (mobile view) */}
          <div className="sm:hidden">
            <span
              className={`inline-block w-3 h-3 rounded-full ${
                isProduction ? "bg-red-500" : "bg-yellow-500"
              }`}
              title={networkName}
            />
          </div>
        </div>

        {/* Mobile: Full-width status row */}
        <div className="sm:hidden mt-3 pt-3 border-t border-gray-200 dark:border-gray-800">
          <div className="flex flex-col gap-2 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Network:</span>
              <span className="font-medium text-gray-900 dark:text-white">
                {networkBadgeLabel}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-600 dark:text-gray-400">Wallet:</span>
              <span className="font-medium text-gray-900 dark:text-white">
                {publicKey ? (
                  <AddressDisplay
                    address={publicKey}
                    truncateLen={6}
                  />
                ) : (
                  "Not connected"
                )}
              </span>
            </div>
          </div>
        </div>
      </div>
    </header>
  );
}
