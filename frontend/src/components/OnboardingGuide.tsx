'use client';

/**
 * OnboardingGuide.tsx (UX-112)
 *
 * First-time onboarding flow with:
 *   1. Welcome modal — shown once on first visit, with "Don't show again" option
 *   2. Guided tooltip tour — 4-step walkthrough with keyboard navigation
 *   3. Progress checklist — tracks real wallet + env state
 *   4. Re-trigger button — accessible from anywhere after first close
 *
 * Persistence: localStorage key "sorobanpay-onboarding-v2"
 * Accessibility: keyboard navigable, role="dialog", aria-modal, focus trap
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
} from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface TourStep {
  id: number;
  title: string;
  description: string;
  icon: string;
  /** HTML element ID to highlight (optional) */
  targetId?: string;
  action?: {
    label: string;
    href: string;
    external?: boolean;
  };
}

interface OnboardingState {
  /** Whether the user has completed / dismissed the welcome modal */
  welcomeSeen: boolean;
  /** Whether the user clicked "Don't show again" */
  dontShowAgain: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sorobanpay-onboarding-v2';

const TOUR_STEPS: TourStep[] = [
  {
    id: 1,
    title: 'Install Freighter Wallet',
    description:
      'Freighter is a non-custodial Stellar wallet extension. You\'ll use it to sign subscription transactions securely — no server ever touches your keys.',
    icon: '🔐',
    action: {
      label: 'Install Freighter',
      href: 'https://www.freighter.app',
      external: true,
    },
  },
  {
    id: 2,
    title: 'Connect Your Wallet',
    description:
      'Click "Connect Freighter Wallet" on the page to authorize the app. Once connected, you\'ll see your public key displayed at the top.',
    icon: '🔗',
  },
  {
    id: 3,
    title: 'Fund Your Wallet (Testnet)',
    description:
      'On testnet, you can get free XLM from Stellar Friendbot. On mainnet, send at least 2 XLM to cover the base reserve and transaction fees.',
    icon: '💰',
    action: {
      label: 'Open Friendbot',
      href: 'https://laboratory.stellar.org/#account-creator?network=test',
      external: true,
    },
  },
  {
    id: 4,
    title: 'Create Your First Subscription',
    description:
      'Fill in the merchant address, token contract, amount, and payment interval. Then confirm in the wizard and approve the transaction in Freighter. Your subscription is now on-chain!',
    icon: '✨',
    action: {
      label: 'Quick Start guide',
      href: 'https://github.com/Chrisland58/SorobanPay#quick-start-testnet-demo--5-minutes',
      external: true,
    },
  },
];

// ─── Storage helpers ──────────────────────────────────────────────────────────

function loadState(): OnboardingState {
  if (typeof window === 'undefined') return { welcomeSeen: false, dontShowAgain: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { welcomeSeen: false, dontShowAgain: false };
    return JSON.parse(raw) as OnboardingState;
  } catch {
    return { welcomeSeen: false, dontShowAgain: false };
  }
}

function saveState(state: OnboardingState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // localStorage unavailable (e.g. private browsing with strict settings)
  }
}

// ─── Focus trap hook ──────────────────────────────────────────────────────────

function useFocusTrap(isActive: boolean) {
  const containerRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isActive) return;

    // Save current focus
    previousFocusRef.current = document.activeElement as HTMLElement;

    const container = containerRef.current;
    if (!container) return;

    // Focus the first focusable element
    const focusable = container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (focusable.length > 0) focusable[0].focus();

    function handleKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key !== 'Tab') return;
      if (!container) return;

      const focusableList = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => el.offsetParent !== null); // visible only

      const first = focusableList[0];
      const last = focusableList[focusableList.length - 1];

      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      // Restore focus on unmount
      previousFocusRef.current?.focus();
    };
  }, [isActive]);

  return containerRef;
}

// ─── Progress checklist ───────────────────────────────────────────────────────

interface ChecklistItem {
  id: string;
  label: string;
  done: boolean;
}

function ProgressChecklist({
  isWalletConnected,
  isContractConfigured,
}: {
  isWalletConnected: boolean;
  isContractConfigured: boolean;
}) {
  const [freighterInstalled, setFreighterInstalled] = useState(false);

  useEffect(() => {
    // Detect Freighter: @stellar/freighter-api exposes window.freighter or similar
    const check = () => {
      const w = window as unknown as Record<string, unknown>;
      setFreighterInstalled(!!(w.freighter || w.rabet));
    };
    check();
    // Re-check after a short delay (extension may inject late)
    const t = setTimeout(check, 500);
    return () => clearTimeout(t);
  }, []);

  const items: ChecklistItem[] = [
    { id: 'install', label: 'Install Freighter', done: freighterInstalled || isWalletConnected },
    { id: 'connect', label: 'Connect wallet', done: isWalletConnected },
    { id: 'fund', label: 'Fund wallet (testnet)', done: isWalletConnected }, // best effort
    { id: 'contract', label: 'Configure contract ID', done: isContractConfigured },
    { id: 'subscribe', label: 'Create first subscription', done: false },
  ];

  const completedCount = items.filter((i) => i.done).length;
  const progress = Math.round((completedCount / items.length) * 100);

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-300">Setup progress</h3>
        <span className="text-xs text-gray-400">{completedCount}/{items.length}</span>
      </div>
      <div className="w-full h-1.5 bg-gray-700 rounded-full mb-3 overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-blue-500 to-green-500 rounded-full transition-all duration-500"
          style={{ width: `${progress}%` }}
          aria-hidden="true"
        />
      </div>
      <ul className="space-y-2" role="list" aria-label="Onboarding checklist">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2.5">
            <span
              className={`
                h-5 w-5 flex-shrink-0 rounded-full flex items-center justify-center text-xs font-bold
                transition-colors duration-300
                ${item.done
                  ? 'bg-green-600/80 text-green-100 border border-green-500/60'
                  : 'bg-gray-700 text-gray-500 border border-gray-600'}
              `}
              aria-hidden="true"
            >
              {item.done ? '✓' : '○'}
            </span>
            <span className={`text-sm transition-colors duration-300 ${item.done ? 'text-gray-300 line-through decoration-gray-600' : 'text-gray-400'}`}>
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── Welcome modal ────────────────────────────────────────────────────────────

interface WelcomeModalProps {
  isContractConfigured: boolean;
  isWalletConnected: boolean;
  onStartTour: () => void;
  onDontShowAgain: () => void;
  onClose: () => void;
}

function WelcomeModal({
  isContractConfigured,
  isWalletConnected,
  onStartTour,
  onDontShowAgain,
  onClose,
}: WelcomeModalProps) {
  const containerRef = useFocusTrap(true);

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'Escape') onClose();
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="welcome-title"
        aria-describedby="welcome-desc"
        className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6 focus:outline-none"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {/* Close button */}
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-blue-400 font-semibold mb-1">
              Welcome to SorobanPay
            </p>
            <h2
              id="welcome-title"
              className="text-2xl font-extrabold text-white leading-tight"
            >
              Recurring payments on Stellar — no bank required.
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close welcome dialog"
            className="
              flex-shrink-0 ml-3 h-8 w-8 flex items-center justify-center
              rounded text-gray-500 hover:text-gray-300 hover:bg-white/10
              transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
            "
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* 3-step overview */}
        <p id="welcome-desc" className="text-sm text-gray-400 leading-relaxed">
          SorobanPay lets you create non-custodial recurring payments directly on the Stellar blockchain.
        </p>

        <ol className="space-y-3" aria-label="Getting started steps">
          {[
            { n: '1', label: 'Connect wallet', desc: 'Install Freighter and connect your Stellar account.' },
            { n: '2', label: 'Choose a plan', desc: 'Set the merchant, token, amount, and payment interval.' },
            { n: '3', label: 'Payments run automatically', desc: 'The contract handles recurring billing on-chain — no middlemen.' },
          ].map(({ n, label, desc }) => (
            <li key={n} className="flex items-start gap-3 bg-gray-800/50 rounded-xl p-3 border border-gray-700/60">
              <span className="inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-blue-600 text-xs font-bold text-white">
                {n}
              </span>
              <div>
                <p className="text-sm font-semibold text-white">{label}</p>
                <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Progress checklist */}
        <ProgressChecklist
          isWalletConnected={isWalletConnected}
          isContractConfigured={isContractConfigured}
        />

        {/* CTA buttons */}
        <div className="flex flex-col gap-3 pt-1">
          <button
            type="button"
            onClick={onStartTour}
            className="
              w-full rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700
              py-3 text-sm font-semibold text-white
              min-h-[48px]
              transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
            "
          >
            Take the guided tour →
          </button>
          <button
            type="button"
            onClick={onClose}
            className="
              w-full rounded-xl border border-gray-600 bg-gray-800/50
              text-gray-300 hover:bg-gray-700 active:bg-gray-800
              py-3 text-sm font-semibold
              min-h-[48px]
              transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500
            "
          >
            Get Started
          </button>
        </div>

        {/* Don't show again */}
        <button
          type="button"
          onClick={onDontShowAgain}
          className="w-full text-xs text-gray-600 hover:text-gray-400 transition-colors text-center focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-600 rounded py-1"
        >
          Don&apos;t show again
        </button>
      </div>
    </div>
  );
}

// ─── Guided tour modal ────────────────────────────────────────────────────────

interface TourModalProps {
  onClose: () => void;
}

function TourModal({ onClose }: TourModalProps) {
  const [step, setStep] = useState(1);
  const containerRef = useFocusTrap(true);
  const currentStep = TOUR_STEPS.find((s) => s.id === step)!;

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault();
        if (step < TOUR_STEPS.length) setStep((s) => s + 1);
        else onClose();
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (step > 1) setStep((s) => s - 1);
      }
    },
    [step, onClose],
  );

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
      role="presentation"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={containerRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-desc"
        aria-label={`Guided tour step ${step} of ${TOUR_STEPS.length}`}
        className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-5 focus:outline-none"
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="text-3xl" aria-hidden="true">{currentStep.icon}</span>
            <div>
              <p className="text-xs text-blue-400 font-semibold uppercase tracking-widest mb-0.5">
                Step {step} of {TOUR_STEPS.length}
              </p>
              <h2 id="tour-title" className="text-lg font-bold text-white leading-tight">
                {currentStep.title}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close guided tour"
            className="
              flex-shrink-0 h-8 w-8 flex items-center justify-center
              rounded text-gray-500 hover:text-gray-300 hover:bg-white/10
              transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
            "
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Description */}
        <p id="tour-desc" className="text-sm text-gray-300 leading-relaxed">
          {currentStep.description}
        </p>

        {/* Progress bar */}
        <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden" aria-hidden="true">
          <div
            className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300"
            style={{ width: `${(step / TOUR_STEPS.length) * 100}%` }}
          />
        </div>

        {/* Step dots */}
        <div className="flex items-center justify-center gap-1.5" role="tablist" aria-label="Tour steps">
          {TOUR_STEPS.map((s) => (
            <button
              key={s.id}
              type="button"
              role="tab"
              aria-selected={s.id === step}
              aria-label={`Go to step ${s.id}`}
              onClick={() => setStep(s.id)}
              className={`
                h-2 rounded-full transition-all duration-300
                focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                ${s.id === step ? 'bg-blue-400 w-6' : 'bg-gray-600 w-2 hover:bg-gray-500'}
              `}
            />
          ))}
        </div>

        {/* Action link */}
        {currentStep.action && (
          <a
            href={currentStep.action.href}
            target={currentStep.action.external ? '_blank' : undefined}
            rel={currentStep.action.external ? 'noopener noreferrer' : undefined}
            className="
              block w-full rounded-xl border border-blue-600/60 bg-blue-600/20
              text-center text-sm font-semibold text-blue-300
              hover:bg-blue-600/40 active:bg-blue-700/40
              py-3 min-h-[48px] flex items-center justify-center
              transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
            "
          >
            {currentStep.action.label} ↗
          </a>
        )}

        {/* Navigation */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(1, s - 1))}
            disabled={step === 1}
            aria-label="Previous step"
            className="
              flex-1 rounded-xl border border-gray-600 bg-gray-800/50
              text-gray-300 hover:bg-gray-700 active:bg-gray-800
              py-3 text-sm font-semibold
              min-h-[48px]
              disabled:opacity-30 disabled:cursor-not-allowed
              transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-500
            "
          >
            ← Back
          </button>
          <button
            type="button"
            onClick={() => {
              if (step < TOUR_STEPS.length) setStep((s) => s + 1);
              else onClose();
            }}
            className="
              flex-1 rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700
              text-white py-3 text-sm font-semibold
              min-h-[48px]
              transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
            "
          >
            {step === TOUR_STEPS.length ? 'Finish ✓' : 'Next →'}
          </button>
        </div>

        <p className="text-center text-xs text-gray-600">
          Use ← → arrow keys to navigate • Esc to close
        </p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export interface OnboardingGuideProps {
  /** Whether the wallet is currently connected */
  isConnected?: boolean;
  /** Called when the guide is closed */
  onClose?: () => void;
}

export default function OnboardingGuide({
  isConnected = false,
  onClose,
}: OnboardingGuideProps) {
  const [state, setState] = useState<OnboardingState>({ welcomeSeen: false, dontShowAgain: false });
  const [hydrated, setHydrated] = useState(false);

  // Modal visibility state
  const [showWelcome, setShowWelcome] = useState(false);
  const [showTour, setShowTour] = useState(false);

  // Contract configuration check
  const isContractConfigured =
    typeof process !== 'undefined' &&
    !!process.env.NEXT_PUBLIC_CONTRACT_ID?.trim();

  // Hydrate from localStorage on mount
  useEffect(() => {
    const saved = loadState();
    setState(saved);
    setHydrated(true);

    // Show welcome modal on first visit (if not opted out)
    if (!saved.welcomeSeen && !saved.dontShowAgain) {
      setShowWelcome(true);
    }
  }, []);

  const persistState = useCallback((next: OnboardingState) => {
    setState(next);
    saveState(next);
  }, []);

  const handleCloseWelcome = useCallback(() => {
    setShowWelcome(false);
    persistState({ ...state, welcomeSeen: true });
    onClose?.();
  }, [state, persistState, onClose]);

  const handleDontShowAgain = useCallback(() => {
    setShowWelcome(false);
    persistState({ welcomeSeen: true, dontShowAgain: true });
    onClose?.();
  }, [persistState, onClose]);

  const handleStartTour = useCallback(() => {
    setShowWelcome(false);
    persistState({ ...state, welcomeSeen: true });
    setShowTour(true);
  }, [state, persistState]);

  const handleCloseTour = useCallback(() => {
    setShowTour(false);
    onClose?.();
  }, [onClose]);

  const handleOpenGuide = useCallback(() => {
    setShowWelcome(true);
  }, []);

  // Don't render until hydrated (avoids SSR mismatch)
  if (!hydrated) return null;

  const showReopenButton = state.welcomeSeen && !showWelcome && !showTour;

  return (
    <>
      {/* Welcome modal */}
      {showWelcome && (
        <WelcomeModal
          isContractConfigured={isContractConfigured}
          isWalletConnected={isConnected}
          onStartTour={handleStartTour}
          onDontShowAgain={handleDontShowAgain}
          onClose={handleCloseWelcome}
        />
      )}

      {/* Guided tour modal */}
      {showTour && <TourModal onClose={handleCloseTour} />}

      {/* Re-open button (shown after first dismiss, unless "don't show again") */}
      {showReopenButton && !state.dontShowAgain && (
        <div className="fixed bottom-20 left-4 z-40 sm:bottom-6 sm:left-6">
          <button
            type="button"
            onClick={handleOpenGuide}
            aria-label="Open onboarding guide"
            title="Open the getting started guide"
            className="
              flex items-center gap-2 rounded-xl
              bg-blue-600/90 hover:bg-blue-500 active:bg-blue-700
              backdrop-blur-sm
              px-3 py-2 text-xs font-semibold text-white
              min-h-[44px]
              shadow-lg transition-all duration-150
              focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
            "
          >
            <span aria-hidden="true">🧭</span>
            Guide
          </button>
        </div>
      )}
    </>
  );
}
