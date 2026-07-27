'use client';

/**
 * page.tsx — Home page
 *
 * Mobile-first responsive layout (UX-114).
 * - Single-column on mobile, max-w-lg centred on desktop
 * - Bottom nav bar on mobile (BottomNavBar component)
 * - Touch targets >= 44px (WCAG 2.5.5)
 * - No horizontal overflow at 375px
 * - pb-20 on mobile to clear the bottom nav bar
 *
 * Keyboard shortcuts:
 *   ?  — open shortcut help modal
 *   N  — focus subscription form
 *   H  — jump to payment history
 *   M  — jump to merchant portal section
 *   D  — jump to dashboard section
 *   Esc — close modal
 */

import { useState, useEffect, useRef } from 'react';
import SubscriptionWizard from '@/components/SubscriptionWizard';
import OnboardingGuide from '@/components/OnboardingGuide';
import ShortcutsHelpModal from '@/components/ShortcutsHelpModal';
import BottomNavBar from '@/components/BottomNavBar';
import { useWallet } from '@/hooks/useWallet';
import { useKeyboardShortcuts, SECTION_IDS } from '@/hooks/useKeyboardShortcuts';

// ─── Live-region for screen-reader announcements ──────────────────────────────

let _announce: ((msg: string) => void) | null = null;

export function announceToScreenReader(msg: string) {
  _announce?.(msg);
}

function LiveRegion() {
  const [message, setMessage] = useState('');
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    _announce = (msg: string) => {
      setMessage('');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setMessage(msg), 50);
    };
    return () => {
      _announce = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" role="status">
      {message}
    </div>
  );
}

// ─── Keyboard shortcut trigger button ─────────────────────────────────────────

function ShortcutsTriggerButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show keyboard shortcuts (press ? to toggle)"
      aria-keyshortcuts="?"
      title="Keyboard shortcuts (?)"
      className="
        fixed bottom-20 right-4 z-40
        sm:bottom-6 sm:right-6
        flex items-center justify-center
        h-11 w-11 rounded-full
        border border-gray-600 bg-gray-800 text-gray-300
        hover:bg-gray-700 hover:text-white
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
        transition-colors shadow-lg
        md:bottom-5 md:right-5
      "
    >
      <span aria-hidden="true" className="text-base font-bold leading-none select-none">?</span>
    </button>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const {
    publicKey,
    isConnecting,
    connectError,
    freighterInstalled,
    connect,
    disconnect,
  } = useWallet();

  const [copied, setCopied] = useState(false);
  const { isHelpOpen, openHelp, closeHelp } = useKeyboardShortcuts();

  const shortKey = publicKey
    ? `${publicKey.slice(0, 6)}…${publicKey.slice(-4)}`
    : null;

  async function copyKey() {
    if (!publicKey) return;
    await navigator.clipboard.writeText(publicKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <LiveRegion />

      {/* Fixed ? trigger button — above bottom nav on mobile */}
      <ShortcutsTriggerButton onClick={openHelp} />

      {/* Shortcuts modal */}
      <ShortcutsHelpModal isOpen={isHelpOpen} onClose={closeHelp} />

      {/* Onboarding guide — full-screen modal on first visit */}
      <OnboardingGuide isConnected={!!publicKey} />

      {/* Mobile bottom nav bar */}
      <BottomNavBar />

      <main
        id="top"
        className="
          min-h-screen
          flex flex-col items-center
          px-4 pt-6 pb-24
          sm:px-6 sm:pt-8 sm:pb-10
          md:pb-12
        "
      >
        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="w-full max-w-lg mb-6 text-center">
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight mb-2">
            SorobanPay
          </h1>
          <p className="text-gray-400 text-sm">
            Decentralized recurring payments on Stellar
          </p>
          <p className="text-gray-600 text-xs mt-1 hidden sm:block">
            Press{' '}
            <kbd className="inline-flex items-center rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 font-mono text-[11px] text-gray-400 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.4)]">
              ?
            </kbd>{' '}
            for keyboard shortcuts
          </p>
        </div>

        {/* ── Wallet section ───────────────────────────────────────────────── */}
        <section
          aria-label="Wallet connection"
          className="w-full max-w-lg mb-6"
        >
          {!publicKey ? (
            <div className="bg-gray-900 rounded-2xl p-5 sm:p-6 shadow-lg">
              {/* Freighter install prompt */}
              {!freighterInstalled && (
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
              )}

              {connectError && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg bg-red-900/60 border border-red-600 p-3 text-sm text-red-200"
                >
                  {connectError}
                </div>
              )}

              <button
                onClick={connect}
                disabled={isConnecting}
                aria-keyshortcuts="n"
                title="Connect Freighter Wallet (press N to focus this area)"
                className="
                  w-full rounded-lg bg-blue-600 hover:bg-blue-500
                  disabled:opacity-50 disabled:cursor-not-allowed
                  px-4 py-3 text-sm font-semibold
                  min-h-[48px]
                  transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400
                "
              >
                {isConnecting ? 'Connecting…' : 'Connect Freighter Wallet'}
              </button>
            </div>
          ) : (
            /* Connected wallet bar */
            <div className="bg-gray-900 rounded-2xl p-4 shadow-lg flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 rounded-full bg-green-400 flex-shrink-0" aria-hidden="true" />
                <span className="text-sm text-gray-300 flex-shrink-0 hidden xs:inline">Connected:</span>
                <button
                  onClick={copyKey}
                  title={publicKey}
                  aria-label={`Copy full public key: ${publicKey}`}
                  className="font-mono text-white text-sm truncate hover:text-blue-300 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 rounded min-h-[44px] flex items-center"
                >
                  {shortKey}
                </button>
                <span
                  aria-live="polite"
                  className={`text-xs transition-opacity duration-300 flex-shrink-0 ${copied ? 'text-green-400 opacity-100' : 'opacity-0'}`}
                >
                  Copied!
                </span>
              </div>
              <button
                onClick={disconnect}
                className="
                  text-xs text-gray-400 hover:text-red-400 transition-colors flex-shrink-0
                  focus:outline-none focus:ring-1 focus:ring-red-400 rounded px-3 py-2
                  min-h-[44px] min-w-[44px] flex items-center
                "
              >
                Disconnect
              </button>
            </div>
          )}
        </section>

        {/* ── Subscription form section ────────────────────────────────────── */}
        <section
          id={SECTION_IDS.subscriptionForm}
          aria-label="New subscription"
          className="w-full max-w-lg"
          tabIndex={-1}
        >
          {publicKey ? (
            <SubscriptionWizard />
          ) : (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-6 sm:p-8 text-center space-y-3">
              <p className="text-2xl" aria-hidden="true">🔒</p>
              <p className="text-gray-300 font-semibold text-sm">Connect your wallet to get started</p>
              <p className="text-gray-500 text-xs leading-relaxed">
                Install{' '}
                <a
                  href="https://www.freighter.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-blue-400 hover:text-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                >
                  Freighter
                </a>{' '}
                and click <strong className="text-gray-300">Connect Freighter Wallet</strong> above.
                Then set{' '}
                <code className="bg-gray-800 px-1 rounded text-yellow-300 text-xs">NEXT_PUBLIC_CONTRACT_ID</code>{' '}
                in <code className="bg-gray-800 px-1 rounded text-gray-300 text-xs">frontend/.env.local</code>.
                See the{' '}
                <a
                  href="https://github.com/Chrisland58/SorobanPay#quick-start-testnet-demo--5-minutes"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-blue-400 hover:text-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                >
                  Quick Start guide
                </a>
                .
              </p>
            </div>
          )}
        </section>

        {/* ── Payment history section ──────────────────────────────────────── */}
        {publicKey && (
          <section
            id={SECTION_IDS.paymentHistory}
            aria-label="Payment history"
            className="w-full max-w-lg mt-6"
            tabIndex={-1}
          >
            {/* Mobile card layout instead of table (UX-114) */}
            <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-5 sm:p-6 text-center space-y-3">
              <p className="text-2xl" aria-hidden="true">📋</p>
              <p className="text-gray-300 font-semibold text-sm">Payment History</p>
              <p className="text-gray-500 text-xs leading-relaxed max-w-xs mx-auto">
                Executed payments and subscription activity will appear here once
                on-chain event indexing is available.{' '}
                <code className="bg-gray-800 px-1 rounded text-gray-400 text-xs">executed</code>{' '}
                events on the Soroban ledger.
              </p>
              <span className="inline-block mt-1 px-3 py-1 rounded-full bg-gray-800 text-gray-600 text-xs font-medium border border-gray-700">
                Coming soon
              </span>
            </div>
          </section>
        )}

        {/* ── Dashboard section ────────────────────────────────────────────── */}
        {publicKey && (
          <section
            id={SECTION_IDS.dashboard}
            aria-label="Dashboard"
            className="w-full max-w-lg mt-6"
            tabIndex={-1}
          >
            <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/20 p-5 sm:p-6 text-center space-y-3">
              <p className="text-2xl" aria-hidden="true">📊</p>
              <p className="text-gray-300 font-semibold text-sm">Dashboard</p>
              <p className="text-gray-500 text-xs leading-relaxed max-w-xs mx-auto">
                Overview of your subscription portfolio, payment timelines, and
                account health metrics.
              </p>
              <span className="inline-block mt-1 px-3 py-1 rounded-full bg-gray-800 text-gray-600 text-xs font-medium border border-gray-700">
                Coming soon
              </span>
            </div>
          </section>
        )}
      </main>
    </>
  );
}
