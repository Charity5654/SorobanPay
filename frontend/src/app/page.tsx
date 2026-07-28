'use client';

/**
 * page.tsx — Home page (Dashboard)
 *
 * Renders the wallet connect/disconnect button and the subscription form.
 * Includes an onboarding guide for first-time users and global keyboard
 * shortcut support (react-hotkeys-hook).
 *
 * Requirements: 9.1, 9.5, 9.6, 10.1
 * Keyboard shortcuts:
 *   ?  — open shortcut help modal
 *   N  — focus subscription form
 *   H  — jump to payment history
 *   M  — jump to merchant portal section
 *   D  — jump to dashboard section
 *   Esc — close modal
 */

import { useState, useEffect, useRef } from 'react';
import Link from 'next/link';
import SubscriptionForm from '@/components/SubscriptionForm';
import OnboardingGuide from '@/components/OnboardingGuide';
import ShortcutsHelpModal from '@/components/ShortcutsHelpModal';
import { useWallet } from '@/hooks/useWallet';
import { useKeyboardShortcuts, SECTION_IDS } from '@/hooks/useKeyboardShortcuts';
import { useAccountBalance } from '@/hooks/useAccountBalance';
import { useFriendbot } from '@/hooks/useFriendbot';
import { NETWORK_NAME } from '@/constants/network';

// ─── Live-region for screen-reader announcements ──────────────────────────────

/**
 * Renders a visually hidden aria-live region that other components can post
 * announcements to. Import and call `announceToScreenReader(msg)` from anywhere.
 */
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
      // Brief reset so the same message can be re-announced
      timerRef.current = setTimeout(() => setMessage(msg), 50);
    };
    return () => {
      _announce = null;
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      role="status"
    >
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
        fixed bottom-5 right-5 z-40
        flex items-center justify-center
        h-10 w-10 rounded-full
        border border-gray-600 bg-gray-800 text-gray-300
        hover:bg-gray-700 hover:text-white
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
        transition-colors shadow-lg
      "
    >
      <span aria-hidden="true" className="text-base font-bold leading-none select-none">?</span>
    </button>
  );
}

// ─── Onboarding card ──────────────────────────────────────────────────────────

function OnboardingCard({ freighterInstalled }: { freighterInstalled: boolean }) {
  return (
    <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-gradient-to-br from-slate-950/80 via-slate-900/90 to-slate-950/95 p-6 shadow-xl mb-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.28em] text-blue-300 font-semibold">
            First-time onboarding
          </p>
          <h2 className="mt-3 text-2xl font-bold text-white">Launch your first recurring payment</h2>
        </div>
        <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-200 border border-blue-500/20">
          3 steps
        </span>
      </div>

      <ol className="mt-6 space-y-4 text-sm text-gray-300">
        <li className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-blue-600 text-xs font-semibold text-white">
              1
            </span>
            <span className="text-xs text-blue-200 uppercase tracking-[0.18em] font-semibold">
              Wallet setup
            </span>
          </div>
          <p className="text-gray-300">
            Install Freighter and switch it to Testnet. Then connect your wallet with the button below.
          </p>
          {!freighterInstalled && (
            <a
              href="https://www.freighter.app"
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white hover:bg-blue-500"
            >
              Install Freighter
            </a>
          )}
        </li>

        <li className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-100">
              2
            </span>
            <span className="text-xs text-blue-200 uppercase tracking-[0.18em] font-semibold">
              Environment config
            </span>
          </div>
          <p className="text-gray-300">
            Add <code className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">NEXT_PUBLIC_CONTRACT_ID</code> to{' '}
            <code className="rounded bg-slate-800 px-2 py-0.5 text-xs text-slate-200">frontend/.env.local</code> and restart the app.
          </p>
        </li>

        <li className="rounded-2xl border border-gray-800 bg-gray-900/70 p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-slate-700 text-xs font-semibold text-slate-100">
              3
            </span>
            <span className="text-xs text-blue-200 uppercase tracking-[0.18em] font-semibold">
              Create a subscription
            </span>
          </div>
          <p className="text-gray-300">
            Fill in the merchant, token, amount, and interval fields. Then authorize the subscription with Freighter.
          </p>
        </li>
      </ol>
    </div>
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

  // Keyboard shortcuts & help modal state
  const { isHelpOpen, openHelp, closeHelp } = useKeyboardShortcuts();

  // XLM balance — re-fetched whenever refreshTrigger increments
  const [balanceRefreshTrigger, setBalanceRefreshTrigger] = useState(0);
  const { balance, isLoading: isLoadingBalance } = useAccountBalance({
    publicKey,
    refreshTrigger: balanceRefreshTrigger,
  });

  // Friendbot — only used on testnet
  const { fund, isFunding, success: fundSuccess, error: fundError } = useFriendbot({
    publicKey,
    onSuccess: () => setBalanceRefreshTrigger((c) => c + 1),
  });

  const isTestnet = NETWORK_NAME === 'Testnet';
  // Show Fund button when: testnet, connected, balance is exactly "0.0000000"
  const showFundButton = isTestnet && !!publicKey && balance === '0.0000000';

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
      {/* Accessible live region for screen-reader announcements */}
      <LiveRegion />

      {/* Fixed ? trigger button */}
      <ShortcutsTriggerButton onClick={openHelp} />

      {/* Shortcuts help modal */}
      <ShortcutsHelpModal isOpen={isHelpOpen} onClose={closeHelp} />

      <main className="min-h-screen flex flex-col items-center px-4 py-12">
        {/* Onboarding guide */}
        <OnboardingGuide isConnected={!!publicKey} />

        {/* Header */}
        <div className="w-full max-w-lg mb-8 text-center">
          <h1 className="text-4xl font-extrabold tracking-tight mb-2">SorobanPay</h1>
          <p className="text-gray-400 text-sm">
            Decentralized recurring payments on Stellar
          </p>
          {/* Keyboard shortcut hint below tagline */}
          <p className="text-gray-600 text-xs mt-1">
            Press{' '}
            <kbd className="inline-flex items-center rounded border border-gray-600 bg-gray-800 px-1.5 py-0.5 font-mono text-[11px] text-gray-400 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.4)]">
              ?
            </kbd>{' '}
            for keyboard shortcuts
          </p>
        </div>

        {/* ── Wallet section ──────────────────────────────────────────────── */}
        <div className="w-full max-w-lg mb-6">
          <OnboardingCard freighterInstalled={freighterInstalled} />

          {!publicKey ? (
            <div className="bg-gray-900 rounded-2xl p-6 shadow-lg">
              {/* Req 9.1 — Freighter install prompt */}
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

              {/* Req 9.4 — access denied error */}
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
                className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50
                           disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold
                           transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {isConnecting ? 'Connecting…' : 'Connect Freighter Wallet'}
              </button>
            </div>
          ) : (
            /* Connected: balance + copy key + Friendbot (testnet) + disconnect */
            <div className="bg-gray-900 rounded-2xl p-4 shadow-lg space-y-3">
              {/* Top row: dot + key + copy + disconnect */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-green-400 flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm text-gray-300 flex-shrink-0">Connected:</span>
                  <button
                    onClick={copyKey}
                    title={publicKey}
                    aria-label={`Copy full public key: ${publicKey}`}
                    className="font-mono text-white text-sm truncate hover:text-blue-300 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
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
                {/* Req 9.6 — disconnect clears key */}
                <button
                  onClick={disconnect}
                  className="text-xs text-gray-400 hover:text-red-400 transition-colors flex-shrink-0
                             focus:outline-none focus:ring-1 focus:ring-red-400 rounded px-2 py-1"
                >
                  Disconnect
                </button>
              </div>

              {/* Balance row */}
              <div className="flex items-center gap-2 pl-4">
                <span className="text-xs text-gray-500">Balance:</span>
                {isLoadingBalance ? (
                  <span className="h-3 w-20 animate-pulse rounded bg-gray-700" aria-label="Loading balance" />
                ) : (
                  <span
                    className="font-mono text-xs text-gray-300"
                    aria-label={`XLM balance: ${balance ?? '—'}`}
                  >
                    {balance !== null ? `${balance} XLM` : '—'}
                  </span>
                )}
              </div>

              {/* Friendbot section — testnet only, zero balance only */}
              {showFundButton && (
                <div className="pl-4 space-y-2">
                  <button
                    type="button"
                    onClick={fund}
                    disabled={isFunding}
                    aria-label="Fund this testnet wallet with 10,000 XLM via Friendbot"
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed px-3 py-1.5 text-xs font-semibold text-white transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
                  >
                    {isFunding ? (
                      <>
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" aria-hidden="true" />
                        Funding…
                      </>
                    ) : (
                      <>
                        <span aria-hidden="true">💧</span>
                        Fund wallet (testnet)
                      </>
                    )}
                  </button>

                  {fundError && (
                    <p role="alert" className="text-xs text-red-400">
                      {fundError}
                    </p>
                  )}
                </div>
              )}

              {/* Success feedback — shown after Friendbot completes */}
              {fundSuccess && (
                <div
                  role="status"
                  aria-live="polite"
                  className="pl-4 flex items-center gap-1.5 text-xs text-green-400"
                >
                  <span aria-hidden="true">✓</span>
                  Funded! Balance will update in ~5 seconds.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Subscription form section ───────────────────────────────────── */}
        {/* id is referenced by the N shortcut in useKeyboardShortcuts */}
        <section
          id={SECTION_IDS.subscriptionForm}
          aria-label="New subscription"
          className="w-full max-w-lg"
          tabIndex={-1}
        >
          {publicKey ? (
            <SubscriptionForm />
          ) : (
            <div className="rounded-2xl border border-gray-800 bg-gray-900/40 p-8 text-center space-y-3">
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
                in <code className="bg-gray-800 px-1 rounded text-gray-300 text-xs">frontend/.env.local</code> if you
                haven&apos;t deployed yet. See the{' '}
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

        {/* ── Payment history section ─────────────────────────────────────── */}
        {/* id is referenced by the H shortcut in useKeyboardShortcuts */}
        <section
          id={SECTION_IDS.paymentHistory}
          aria-label="Payment history"
          className="w-full max-w-lg mt-6"
          tabIndex={-1}
        >
          <div className="rounded-2xl border border-gray-700 bg-gray-900/30 p-6 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">📋</span>
                <p className="text-gray-300 font-semibold text-sm">Payment History</p>
              </div>
              {publicKey && (
                <Link
                  href="/history"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-700 bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-300 hover:bg-gray-700 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  aria-label="View full payment history"
                >
                  View all <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
          </section>
        )}

      {/* Subscription form — only rendered when wallet is connected */}
      {publicKey ? (
        <SubscriptionForm />
      ) : (
        <div className="w-full max-w-lg rounded-2xl border border-gray-800 bg-gray-900/40 p-8 text-center space-y-3">
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
            Then set <code className="bg-gray-800 px-1 rounded text-yellow-300 text-xs">NEXT_PUBLIC_CONTRACT_ID</code> in{' '}
            <code className="bg-gray-800 px-1 rounded text-gray-300 text-xs">frontend/.env.local</code> if you haven&apos;t deployed yet.
            See the <a href="https://github.com/Chrisland58/SorobanPay#quick-start-testnet-demo--5-minutes" target="_blank" rel="noopener noreferrer" className="underline text-blue-400 hover:text-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded">Quick Start guide</a>.
          </p>
        </div>
      )}

      {/* Subscription history placeholder */}
      {publicKey && (
        <div className="w-full max-w-lg mt-6">
          <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/30 p-6 text-center space-y-3">
            <p className="text-2xl" aria-hidden="true">📋</p>
            <p className="text-gray-300 font-semibold text-sm">Payment History</p>
            <p className="text-gray-500 text-xs leading-relaxed max-w-xs mx-auto">
              Trigger{' '}
              <code className="bg-gray-800 px-1 rounded text-gray-400 text-xs">execute_payment</code>,
              view active subscriptions, and review revenue analytics.
            </p>
            <span className="inline-block mt-1 px-3 py-1 rounded-full bg-gray-800 text-gray-600 text-xs font-medium border border-gray-700">
              Coming soon
            </span>
          </div>
        </section>

        {/* ── Dashboard section (coming soon) ─────────────────────────────── */}
        {/* id is referenced by the D shortcut in useKeyboardShortcuts */}
        <section
          id={SECTION_IDS.dashboard}
          aria-label="Dashboard"
          className="w-full max-w-lg mt-6 mb-16"
          tabIndex={-1}
        >
          <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-900/20 p-6 text-center space-y-3">
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
      </main>
    </>
  );
}
