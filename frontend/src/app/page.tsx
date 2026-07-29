'use client';

/**
 * page.tsx — Home page (Dashboard)
 *
 * Renders the wallet connect/disconnect button and the subscription form.
 * Includes an onboarding guide for first-time users and global keyboard
 * shortcut support (react-hotkeys-hook).
 *
 * Requirements: 9.1, 9.5, 9.6, 10.1
 * FE-47: Mounted guard prevents React hydration mismatches from wallet state.
 * FE-46: Skeleton loading states shown before client mount.
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
import Link from 'next/link';
import SubscriptionForm from '@/components/SubscriptionForm';
import OnboardingGuide from '@/components/OnboardingGuide';
import ShortcutsHelpModal from '@/components/ShortcutsHelpModal';
import { SkeletonWallet, SkeletonForm } from '@/components/Skeleton';
import { useWallet } from '@/hooks/useWallet';
import { useKeyboardShortcuts, SECTION_IDS } from '@/hooks/useKeyboardShortcuts';
import { useAccountBalance } from '@/hooks/useAccountBalance';
import { useFriendbot } from '@/hooks/useFriendbot';
import { NETWORK_NAME } from '@/constants/network';
import { useAddressBook } from '@/hooks/useAddressBook';
import { AddressBookModal } from '@/components/AddressBookModal';

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

// ─── Navigation ───────────────────────────────────────────────────────────────
function Nav() {
  return (
    <div aria-live="polite" aria-atomic="true" className="sr-only" role="status">
      {message}
    </div>
  );
}

// ─── Section 1: Hero ──────────────────────────────────────────────────────────
function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden bg-gray-950 px-4 pb-24 pt-20 sm:px-8 sm:pb-32 sm:pt-28"
    >
      {/* Background gradient blobs */}
      <div
        className="pointer-events-none absolute -top-40 left-1/2 h-[600px] w-[600px] -translate-x-1/2 rounded-full bg-blue-600/10 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-0 right-0 h-[400px] w-[400px] rounded-full bg-indigo-600/10 blur-3xl"
        aria-hidden="true"
      />

      <div className={`${CONTAINER} relative text-center`}>
        {/* Badge */}
        <span className="mb-6 inline-flex items-center gap-2 rounded-full border border-blue-500/30 bg-blue-500/10 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-blue-300">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" aria-hidden="true" />
          Built on Stellar Soroban
        </span>

        {/* Headline */}
        <h1
          id="hero-heading"
          className="mx-auto mt-4 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight text-white sm:text-5xl lg:text-6xl"
        >
          Recurring payments on Stellar —{' '}
          <span className="bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            non-custodial, on-chain.
          </span>
        </h1>

        {/* Subheadline */}
        <p className="mx-auto mt-6 max-w-2xl text-lg text-gray-400 leading-relaxed">
          SorobanPay enables SaaS billing, creator subscriptions, and recurring donations
          directly on Stellar. No custodial wallets, no pre-authorized transaction arrays —
          just smart contracts and SEP-41 tokens.
        </p>

        {/* CTAs */}
        <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/app"
            className="w-full rounded-xl bg-blue-600 px-8 py-4 text-sm font-bold text-white shadow-lg shadow-blue-600/20 hover:bg-blue-500 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:w-auto"
          >
            Get Started — Free
          </Link>
          <a
            href="https://github.com/Chrisland58/SorobanPay"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-xl border border-gray-700 px-8 py-4 text-sm font-bold text-gray-300 hover:border-gray-500 hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 sm:w-auto"
          >
            View on GitHub ↗
          </a>
        </div>

        {/* Trust badges */}
        <div className="mt-12 flex flex-wrap items-center justify-center gap-6 text-xs text-gray-600">
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">🔒</span> Non-custodial
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">⚡</span> Permissionless
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">📖</span> Open source · MIT
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden="true">🔗</span> SEP-41 compatible
          </span>
        </div>
      </div>
    </section>
  );
}

// ─── Section 2: How it works ──────────────────────────────────────────────────
function HowItWorks() {
  const steps = [
    {
      number: '01',
      emoji: '✍️',
      title: 'Subscribe',
      description:
        'Set your merchant address, token contract, amount, and interval. Sign once with Freighter — the contract does the rest.',
    },
    {
      number: '02',
      emoji: '⚡',
      title: 'Payments run automatically',
      description:
        'Merchants collect payments on-chain when the interval elapses. Tokens transfer directly subscriber → merchant. No custodians.',
    },
    {
      number: '03',
      emoji: '🔓',
      title: 'Cancel anytime',
      description:
        'Remove your subscription instantly with a single on-chain transaction. You stay in full control — always.',
    },
  ];

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-heading"
      className={`${SECTION} bg-gray-900/50`}
    >
      <div className={CONTAINER}>
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-blue-400 font-semibold mb-3">
            How it works
          </p>
          <h2
            id="how-heading"
            className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl"
          >
            Recurring payments in 3 steps
          </h2>
          <p className="mt-4 text-gray-400 max-w-xl mx-auto">
            From wallet connection to on-chain subscription in under a minute.
          </p>
          <h2 className="mt-3 text-2xl font-bold text-gray-900 dark:text-white">
            Launch your first recurring payment
          </h2>
        </div>

        <div className="relative grid gap-6 sm:grid-cols-3">
          {/* Connector line — desktop only */}
          <div
            className="pointer-events-none absolute top-14 left-[calc(16.67%+1rem)] right-[calc(16.67%+1rem)] hidden h-px bg-gradient-to-r from-blue-600/40 via-blue-400/40 to-blue-600/40 sm:block"
            aria-hidden="true"
          />

          {steps.map((step, i) => (
            <div
              key={i}
              className="relative rounded-2xl border border-gray-800 bg-gray-900 p-6 text-center shadow-lg"
            >
              Install Freighter
            </a>
          )}
        </li>

        <li className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/70 p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-100">
              2
            </span>
            <span className="text-xs text-blue-600 dark:text-blue-200 uppercase tracking-[0.18em] font-semibold">
              Environment config
            </span>
          </div>
          <p className="text-gray-600 dark:text-gray-300">
            Add{' '}
            <code className="rounded bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-200">
              NEXT_PUBLIC_CONTRACT_ID
            </code>{' '}
            to{' '}
            <code className="rounded bg-slate-200 dark:bg-slate-800 px-2 py-0.5 text-xs text-slate-700 dark:text-slate-200">
              frontend/.env.local
            </code>{' '}
            and restart the app.
          </p>
        </li>

        <li className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/70 dark:bg-gray-900/70 p-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="inline-flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700 text-xs font-semibold text-slate-700 dark:text-slate-100">
              3
            </span>
            <span className="text-xs text-blue-600 dark:text-blue-200 uppercase tracking-[0.18em] font-semibold">
              Create a subscription
            </span>
          </div>
          <p className="text-gray-600 dark:text-gray-300">
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
    mounted,
    connect,
    disconnect,
  } = useWallet();

  const [copied, setCopied] = useState(false);
  const { isHelpOpen, openHelp, closeHelp } = useKeyboardShortcuts();

  // Address book
  const {
    entries: abEntries,
    entryList: abEntryList,
    addEntry: abAddEntry,
    updateEntry: abUpdateEntry,
    deleteEntry: abDeleteEntry,
    getLabel: abGetLabel,
    importBook: abImportBook,
    exportBook: abExportBook,
  } = useAddressBook(publicKey);
  const [isAddressBookOpen, setIsAddressBookOpen] = useState(false);

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

  // ── FE-47: Pre-mount skeleton ─────────────────────────────────────────────
  if (!mounted) {
    return (
      <>
        <LiveRegion />
        <ShortcutsTriggerButton onClick={() => {}} />
        <main className="min-h-screen flex flex-col items-center px-4 py-12">
          <div className="w-full max-w-lg mb-8 text-center">
            <h1 className="text-4xl font-extrabold tracking-tight mb-2">SorobanPay</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              Decentralized recurring payments on Stellar
            </p>
            <p className="text-gray-400 dark:text-gray-600 text-xs mt-1">
              Press{' '}
              <kbd className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 font-mono text-[11px] text-gray-500 dark:text-gray-400 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.1)]">
                ?
              </kbd>{' '}
              for keyboard shortcuts
            </p>
          </div>
          <div className="w-full max-w-lg mb-6">
            <SkeletonWallet />
          </div>
          <section
            id={SECTION_IDS.subscriptionForm}
            aria-label="New subscription"
            className="w-full max-w-lg"
            tabIndex={-1}
          >
            <SkeletonForm />
          </section>
        </main>
      </>
    );
  }

  // ── Post-mount: full wallet-aware render ──────────────────────────────────
  return (
    <>
      <LiveRegion />

      {/* Fixed ? trigger button */}
      <ShortcutsTriggerButton onClick={openHelp} />

      {/* Shortcuts help modal */}
      <ShortcutsHelpModal isOpen={isHelpOpen} onClose={closeHelp} />

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
      />

      <main className="min-h-screen flex flex-col items-center px-4 py-12">
        {/* Onboarding guide */}
        <OnboardingGuide isConnected={!!publicKey} />

  return (
    <section
      id="use-cases"
      aria-labelledby="usecases-heading"
      className={`${SECTION} bg-gray-900/40`}
    >
      <div className={CONTAINER}>
        <div className="text-center mb-14">
          <p className="text-xs uppercase tracking-widest text-blue-400 font-semibold mb-3">
            Use cases
          </p>
          <p className="text-gray-400 dark:text-gray-600 text-xs mt-1">
            Press{' '}
            <kbd className="inline-flex items-center rounded border border-gray-300 dark:border-gray-600 bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 font-mono text-[11px] text-gray-500 dark:text-gray-400 shadow-[inset_0_-1px_0_0_rgba(0,0,0,0.1)]">
              ?
            </kbd>{' '}
            for keyboard shortcuts
          </p>
        </div>

        {/* ── Wallet section ──────────────────────────────────────────────── */}
        <div className="w-full max-w-lg mb-6">
          <OnboardingCard freighterInstalled={freighterInstalled} />

          {!publicKey ? (
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-6 shadow-lg border border-gray-200 dark:border-transparent">
              {/* Freighter not installed warning (Req 9.1) */}
              {!freighterInstalled && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg bg-yellow-50 dark:bg-yellow-900/60 border border-yellow-300 dark:border-yellow-600 p-3 text-sm text-yellow-800 dark:text-yellow-200"
                >
                  Freighter wallet is not installed.{' '}
                  <a
                    href="https://www.freighter.app"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline hover:text-yellow-900 dark:hover:text-yellow-100"
                  >
                    Install Freighter
                  </a>{' '}
                  to continue.
                </div>
              )}

              {/* Access denied / connect error (Req 9.4) */}
              {connectError && (
                <div
                  role="alert"
                  className="mb-4 rounded-lg bg-red-50 dark:bg-red-900/60 border border-red-300 dark:border-red-600 p-3 text-sm text-red-800 dark:text-red-200"
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
                           disabled:cursor-not-allowed px-4 py-3 text-sm font-semibold text-white
                           transition-colors focus:outline-none focus:ring-2 focus:ring-blue-400"
              >
                {isConnecting ? 'Connecting…' : 'Connect Freighter Wallet'}
              </button>
            </div>
          ) : (
            /* Connected: balance + copy key + Friendbot (testnet) + disconnect */
            <div className="bg-white dark:bg-gray-900 rounded-2xl p-4 shadow-lg border border-gray-200 dark:border-transparent space-y-3">
              {/* Top row: dot + key + copy + disconnect */}
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="h-2 w-2 rounded-full bg-green-500 dark:bg-green-400 flex-shrink-0" aria-hidden="true" />
                  <span className="text-sm text-gray-500 dark:text-gray-300 flex-shrink-0">Connected:</span>
                  <button
                    onClick={copyKey}
                    title={publicKey}
                    aria-label={`Copy full public key: ${publicKey}`}
                    className="font-mono text-gray-900 dark:text-white text-sm truncate hover:text-blue-600 dark:hover:text-blue-300 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 rounded"
                  >
                    {shortKey}
                  </button>
                  <span
                    aria-live="polite"
                    className={`text-xs transition-opacity duration-300 flex-shrink-0 ${copied ? 'text-green-600 dark:text-green-400 opacity-100' : 'opacity-0'}`}
                  >
                    Copied!
                  </span>
                </div>
                {/* Req 9.6 — disconnect clears key */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => setIsAddressBookOpen(true)}
                    aria-label="Open address book"
                    title="Address book"
                    className="text-xs text-gray-400 hover:text-blue-400 dark:hover:text-blue-300 transition-colors focus:outline-none focus:ring-1 focus:ring-blue-400 rounded px-2 py-1 inline-flex items-center gap-1"
                  >
                    <span aria-hidden="true">📒</span>
                    {abEntryList.length > 0 && (
                      <span className="font-mono">{abEntryList.length}</span>
                    )}
                  </button>
                  <button
                    onClick={disconnect}
                    className="text-xs text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors focus:outline-none focus:ring-1 focus:ring-red-400 rounded px-2 py-1"
                  >
                    Disconnect
                  </button>
                </div>
              </div>

              {/* Balance row */}
              <div className="flex items-center gap-2 pl-4">
                <span className="text-xs text-gray-400 dark:text-gray-500">Balance:</span>
                {isLoadingBalance ? (
                  <span className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" aria-label="Loading balance" />
                ) : (
                  <span
                    className="font-mono text-xs text-gray-600 dark:text-gray-300"
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
                    <p role="alert" className="text-xs text-red-600 dark:text-red-400">
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
                  className="pl-4 flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400"
                >
                  <span aria-hidden="true">✓</span>
                  Funded! Balance will update in ~5 seconds.
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

        {/* ── Subscription form section ───────────────────────────────────── */}
        <section
          id={SECTION_IDS.subscriptionForm}
          aria-label="New subscription"
          className="w-full max-w-lg"
          tabIndex={-1}
        >
          {publicKey ? (
            <SubscriptionForm />
          ) : (
            <div className="rounded-2xl border border-gray-200 dark:border-gray-800 bg-gray-50/40 dark:bg-gray-900/40 p-8 text-center space-y-3">
              <p className="text-2xl" aria-hidden="true">🔒</p>
              <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">
                Connect your wallet to get started
              </p>
              <p className="text-gray-500 text-xs leading-relaxed">
                Install{' '}
                <a
                  href="https://www.freighter.app"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
                >
                  Freighter
                </a>{' '}
                and click <strong className="text-gray-800 dark:text-gray-300">Connect Freighter Wallet</strong> above.
                Then set{' '}
                <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded text-yellow-700 dark:text-yellow-300 text-xs">
                  NEXT_PUBLIC_CONTRACT_ID
                </code>{' '}
                in{' '}
                <code className="bg-gray-200 dark:bg-gray-800 px-1 rounded text-gray-600 dark:text-gray-300 text-xs">
                  frontend/.env.local
                </code>{' '}
                if you haven&apos;t deployed yet. See the{' '}
                <a
                  href="https://github.com/Chrisland58/SorobanPay#quick-start-testnet-demo--5-minutes"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline text-blue-600 dark:text-blue-400 hover:text-blue-500 dark:hover:text-blue-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
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
          <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50/30 dark:bg-gray-900/30 p-6 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <span className="text-2xl" aria-hidden="true">📋</span>
                <p className="text-gray-700 dark:text-gray-300 font-semibold text-sm">Payment History</p>
              </div>
              {publicKey && (
                <Link
                  href="/history"
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 px-3 py-1.5 text-xs font-medium text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 hover:text-gray-900 dark:hover:text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
                  aria-label="View full payment history"
                >
                  View all <span aria-hidden="true">→</span>
                </Link>
              )}
            </div>
            {!publicKey && (
              <p className="text-gray-500 text-xs">
                Connect your wallet to view payment history.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

// ─── Section 6: CTA banner ────────────────────────────────────────────────────
function CTABanner() {
  return (
    <section
      aria-label="Get started call to action"
      className="relative overflow-hidden bg-blue-600 px-4 py-16 sm:px-8"
    >
      <div
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-700"
        aria-hidden="true"
      />
      <div className="relative mx-auto max-w-2xl text-center">
        <h2 className="text-3xl font-extrabold tracking-tight text-white sm:text-4xl">
          Start building today
        </h2>
        <p className="mt-4 text-blue-100 leading-relaxed">
          Deploy to Stellar testnet in under 5 minutes. Free, open source, and non-custodial.
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-4 sm:flex-row">
          <Link
            href="/app"
            className="w-full rounded-xl bg-white px-8 py-4 text-sm font-bold text-blue-700 shadow-lg hover:bg-blue-50 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-auto"
          >
            Launch App →
          </Link>
          <a
            href="https://github.com/Chrisland58/SorobanPay"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full rounded-xl border border-white/40 px-8 py-4 text-sm font-bold text-white hover:bg-white/10 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-white sm:w-auto"
          >
            View Source ↗
          </a>
        </div>
      </div>
    </section>
  );
}

// ─── Section 6: Footer ────────────────────────────────────────────────────────
function Footer() {
  return (
    <footer className="border-t border-gray-800 bg-gray-950 px-4 py-10 sm:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-6 text-sm text-gray-500 sm:flex-row">
        <Link
          href="/"
          className="flex items-center gap-2 font-extrabold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
        >
          <span
            className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600 text-xs font-black text-white"
            aria-hidden="true"
          >
            S
          </span>
          SorobanPay
        </Link>

        <nav aria-label="Footer navigation">
          <ul className="flex flex-wrap items-center justify-center gap-6" role="list">
            <li>
              <a
                href="https://github.com/Chrisland58/SorobanPay"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                GitHub
              </a>
            </li>
            <li>
              <a
                href="https://github.com/Chrisland58/SorobanPay#quick-start-testnet-demo--5-minutes"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                Docs
              </a>
            </li>
            <li>
              <a
                href="https://github.com/Chrisland58/SorobanPay/blob/main/CHANGELOG.md"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-white transition-colors"
              >
                Changelog
              </a>
            </li>
            <li>
              <Link href="/app" className="hover:text-white transition-colors">
                Launch App
              </Link>
            </li>
          </ul>
        </nav>

        <p className="text-xs">© 2024 SorobanPay. MIT License.</p>
      </div>
    </footer>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <>
      <Nav />
      <main>
        <Hero />
        <HowItWorks />
        <Features />
        <UseCases />
        <DeveloperQuickstart />
        <CTABanner />
      </main>
      <Footer />
    </>
  );
}
