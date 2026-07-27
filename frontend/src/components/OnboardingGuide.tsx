'use client';

/**
 * OnboardingGuide.tsx
 *
 * First-time onboarding walkthrough for new users.
 * Guides users through:
 * 1. Installing Freighter wallet
 * 2. Connecting wallet
 * 3. Setting up environment variables (.env.local)
 * 4. Creating their first subscription
 *
 * State is persisted in localStorage to show only on first visit.
 */

import { useState, useEffect } from 'react';

interface OnboardingStep {
  id: number;
  title: string;
  description: string;
  icon: string;
  action?: {
    label: string;
    href?: string;
    external?: boolean;
  };
}

const STEPS: OnboardingStep[] = [
  {
    id: 1,
    title: 'Install Freighter Wallet',
    description:
      'Freighter is a non-custodial browser extension for Stellar that securely manages your cryptographic keys. You\'ll use it to authorize subscription transactions.',
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
      'Once Freighter is installed, return here and click "Connect Freighter Wallet" to authorize the application. You\'ll see your public key displayed at the top.',
    icon: '🔗',
  },
  {
    id: 3,
    title: 'Configure Environment',
    description:
      'Create a file named .env.local in the frontend/ directory. Add your contract ID: NEXT_PUBLIC_CONTRACT_ID=CABC... (get this from deploying the contract)',
    icon: '⚙️',
    action: {
      label: 'View Quick Start',
      href: 'https://github.com/Chrisland58/SorobanPay#quick-start-testnet-demo--5-minutes',
      external: true,
    },
  },
  {
    id: 4,
    title: 'Create Your First Subscription',
    description:
      'Fill in the subscription form with merchant address, token contract, amount, and interval. Review the confirmation, then authorize in Freighter. Your subscription is now on-chain!',
    icon: '✨',
  },
];

interface OnboardingGuideProps {
  isConnected?: boolean;
  onClose?: () => void;
}

export default function OnboardingGuide({
  isConnected = false,
  onClose,
}: OnboardingGuideProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [currentStep, setCurrentStep] = useState(1);
  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(false);

  useEffect(() => {
    const seen = localStorage.getItem('sorobanpay-onboarding-seen');
    setHasSeenOnboarding(!!seen);

    // Show onboarding on first visit
    if (!seen) {
      setIsVisible(true);
      localStorage.setItem('sorobanpay-onboarding-seen', 'true');
    }
  }, []);

  const currentStepData = STEPS.find((s) => s.id === currentStep);

  const handleClose = () => {
    setIsVisible(false);
    onClose?.();
  };

  const handleNext = () => {
    if (currentStep < STEPS.length) {
      setCurrentStep(currentStep + 1);
    } else {
      handleClose();
    }
  };

  const handlePrevious = () => {
    if (currentStep > 1) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleSkip = () => {
    handleClose();
  };

  const showToggle = hasSeenOnboarding && !isVisible;

  return (
    <>
      {/* Onboarding modal */}
      {isVisible && currentStepData && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-lg bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 sm:p-8 space-y-6">
            {/* Header */}
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span
                    className="text-4xl flex-shrink-0"
                    aria-hidden="true"
                  >
                    {currentStepData.icon}
                  </span>
                  <h2 className="text-2xl font-bold text-white">
                    {currentStepData.title}
                  </h2>
                </div>
                <p className="text-xs text-gray-400 font-medium">
                  Step {currentStep} of {STEPS.length}
                </p>
              </div>
              <button
                onClick={handleClose}
                aria-label="Close onboarding"
                className="flex-shrink-0 text-gray-500 hover:text-gray-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  className="h-5 w-5"
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

            {/* Description */}
            <p className="text-gray-300 leading-relaxed">{currentStepData.description}</p>

            {/* Progress bar */}
            <div className="w-full h-1.5 bg-gray-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-blue-500 to-blue-400 rounded-full transition-all duration-300"
                style={{
                  width: `${(currentStep / STEPS.length) * 100}%`,
                }}
              />
            </div>

            {/* Action button */}
            {currentStepData.action && (
              <a
                href={currentStepData.action.href}
                target={currentStepData.action.external ? '_blank' : undefined}
                rel={currentStepData.action.external ? 'noopener noreferrer' : undefined}
                className="block w-full rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 px-4 py-3 text-center text-sm font-semibold text-white transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
              >
                {currentStepData.action.label}
              </a>
            )}

            {/* Navigation */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <button
                onClick={handlePrevious}
                disabled={currentStep === 1}
                className="px-4 py-2 text-sm font-semibold text-gray-300 hover:text-white disabled:opacity-50 disabled:cursor-not-allowed transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
              >
                ← Previous
              </button>

              <div className="flex items-center gap-1">
                {STEPS.map((step) => (
                  <button
                    key={step.id}
                    onClick={() => setCurrentStep(step.id)}
                    aria-label={`Go to step ${step.id}`}
                    className={`h-2 rounded-full transition-all duration-300 ${
                      step.id === currentStep
                        ? 'bg-blue-400 w-6'
                        : 'bg-gray-600 w-2 hover:bg-gray-500'
                    }`}
                  />
                ))}
              </div>

              <button
                onClick={handleNext}
                className="px-4 py-2 text-sm font-semibold text-white hover:text-blue-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
              >
                {currentStep === STEPS.length ? 'Get Started →' : 'Next →'}
              </button>
            </div>

            {/* Skip button */}
            <button
              onClick={handleSkip}
              className="w-full text-xs text-gray-500 hover:text-gray-400 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded py-1"
            >
              I understand, close this guide
            </button>
          </div>
        </div>
      )}

      {/* Onboarding toggle button (shown after first close) */}
      {showToggle && (
        <div className="fixed bottom-6 right-6 z-40">
          <button
            onClick={() => setIsVisible(true)}
            aria-label="Open onboarding guide"
            title="Open the onboarding guide"
            className="flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 px-4 py-2 text-xs font-semibold text-white shadow-lg transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400"
          >
            <span aria-hidden="true">?</span>
            Guide
          </button>
        </div>
      )}
    </>
  );
}
