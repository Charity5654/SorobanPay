'use client';

/**
 * WalletBadge.tsx
 *
 * Displays the wallet connection state as a compact badge / button row.
 * Extracted as a standalone component to allow isolated Storybook documentation.
 *
 * States:
 *  - disconnected: shows "Connect Freighter Wallet" button
 *  - connecting:   shows loading spinner
 *  - connected:    shows truncated public key + Disconnect button
 *  - no_extension: shows install Freighter prompt
 *  - error:        shows error message + retry button
 */

import type { ReactNode } from 'react';

export type WalletState =
  | 'disconnected'
  | 'connecting'
  | 'connected'
  | 'no_extension'
  | 'error';

export interface WalletBadgeProps {
  /** Current wallet connection state */
  state: WalletState;
  /** Connected public key (required when state === 'connected') */
  publicKey?: string;
  /** Error message (required when state === 'error') */
  errorMessage?: string;
  /** Callback to trigger wallet connection */
  onConnect?: () => void;
  /** Callback to disconnect the wallet */
  onDisconnect?: () => void;
}

function Wrapper({ children }: { children: ReactNode }) {
  return (
    <div className="w-full max-w-lg bg-gray-900 rounded-2xl p-4 sm:p-6 shadow-lg">
      {children}
    </div>
  );
}

export function WalletBadge({
  state,
  publicKey,
  errorMessage,
  onConnect,
  onDisconnect,
}: WalletBadgeProps) {
  if (state === 'no_extension') {
    return (
      <Wrapper>
        <div
          role="alert"
          className="mb-4 rounded-lg bg-yellow-900/60 border border-yellow-600 p-3 text-sm text-yellow-200"
        >
          Freighter wallet is not installed.{' '}
          <a
            href="https://www.freighter.app"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-yellow-100"
          >
            Install Freighter
          </a>{' '}
          to continue.
        </div>
        <button
          disabled
          className="w-full rounded-lg bg-blue-600 opacity-50 cursor-not-allowed px-4 py-3 text-sm font-semibold"
        >
          Connect Freighter Wallet
        </button>
      </Wrapper>
    );
  }

  if (state === 'error') {
    return (
      <Wrapper>
        <div
          role="alert"
          className="mb-4 rounded-lg bg-red-900/60 border border-red-600 p-3 text-sm text-red-200"
        >
          {errorMessage ?? 'Wallet connection failed.'}
        </div>
        <button
          onClick={onConnect}
          className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-3 text-sm font-semibold
                     transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
        >
          Retry Connection
        </button>
      </Wrapper>
    );
  }

  if (state === 'connecting') {
    return (
      <Wrapper>
        <button
          disabled
          aria-busy="true"
          className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600
                     opacity-75 cursor-not-allowed px-4 py-3 text-sm font-semibold"
        >
          <svg
            className="animate-spin h-4 w-4 text-white"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
          </svg>
          Connecting…
        </button>
      </Wrapper>
    );
  }

  if (state === 'connected' && publicKey) {
    const short = `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`;
    return (
      <Wrapper>
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-300">
            Connected:{' '}
            <span className="font-mono text-white" title={publicKey}>
              {short}
            </span>
          </span>
          <button
            onClick={onDisconnect}
            className="text-xs text-gray-400 hover:text-red-400 transition-colors
                       focus:outline-none focus:ring-1 focus:ring-red-400 rounded px-2 py-1"
          >
            Disconnect
          </button>
        </div>
      </Wrapper>
    );
  }

  // Default: disconnected
  return (
    <Wrapper>
      <button
        onClick={onConnect}
        className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-3 text-sm font-semibold
                   transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
      >
        Connect Freighter Wallet
      </button>
    </Wrapper>
  );
}

export default WalletBadge;
