/**
 * #735 — ConsentBanner component.
 *
 * GDPR-compliant cookie/analytics consent banner.
 * Shown once per user until they make an explicit choice.
 * No analytics data is collected until consent is granted.
 */

'use client';

import { useState } from 'react';
import { useAnalytics } from '@/hooks/useAnalytics';

interface ConsentBannerProps {
  userId?: string;
}

export default function ConsentBanner({ userId }: ConsentBannerProps) {
  const { consent, giveConsent } = useAnalytics(userId);
  const [dismissed, setDismissed] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [analyticsChoice, setAnalyticsChoice] = useState(false);
  const [marketingChoice, setMarketingChoice] = useState(false);

  // Hide banner if consent was already recorded or user dismissed it
  if (consent.recorded || dismissed) return null;

  async function acceptAll() {
    await giveConsent({ analytics: true, marketing: true, functional: true });
    setDismissed(true);
  }

  async function rejectAll() {
    await giveConsent({ analytics: false, marketing: false, functional: true });
    setDismissed(true);
  }

  async function saveCustom() {
    await giveConsent({ analytics: analyticsChoice, marketing: marketingChoice, functional: true });
    setDismissed(true);
  }

  return (
    <div
      role="dialog"
      aria-label="Cookie and privacy consent"
      aria-modal="false"
      className="fixed bottom-0 left-0 right-0 z-50 bg-slate-950 border-t border-gray-800 shadow-2xl p-4 md:p-6"
    >
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-start gap-3 mb-3">
          <span className="text-xl" aria-hidden="true">🍪</span>
          <div>
            <h2 className="text-white font-semibold text-sm">Your privacy choices</h2>
            <p className="text-gray-400 text-xs mt-1">
              We use analytics to understand how SorobanPay is used and improve your experience.
              No payment data or wallet keys are ever collected.{' '}
              <button
                onClick={() => setShowDetails(d => !d)}
                className="underline text-blue-400 hover:text-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded"
                aria-expanded={showDetails}
              >
                {showDetails ? 'Hide details' : 'Learn more'}
              </button>
            </p>
          </div>
        </div>

        {/* Details panel */}
        {showDetails && (
          <div className="mb-4 rounded-lg border border-gray-800 bg-gray-900/60 p-4 text-xs text-gray-300 space-y-3">
            <div>
              <p className="font-semibold text-white mb-1">Strictly necessary (always on)</p>
              <p>Session management, security, and core functionality. Cannot be disabled.</p>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-white mb-1">Analytics</p>
                <p>Page views and interaction events. No PII without explicit consent.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={analyticsChoice}
                  onChange={e => setAnalyticsChoice(e.target.checked)}
                  aria-label="Enable analytics cookies"
                />
                <div className="w-10 h-5 bg-gray-700 peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:bg-blue-600 transition-colors" />
                <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-5" />
              </label>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-white mb-1">Marketing</p>
                <p>Used to personalise communications. Opt in only.</p>
              </div>
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  className="sr-only peer"
                  checked={marketingChoice}
                  onChange={e => setMarketingChoice(e.target.checked)}
                  aria-label="Enable marketing cookies"
                />
                <div className="w-10 h-5 bg-gray-700 peer-focus:ring-2 peer-focus:ring-blue-500 rounded-full peer peer-checked:bg-blue-600 transition-colors" />
                <div className="absolute left-0.5 top-0.5 bg-white w-4 h-4 rounded-full transition-transform peer-checked:translate-x-5" />
              </label>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2 justify-end">
          {showDetails && (
            <button
              onClick={saveCustom}
              className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-700 text-white hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
            >
              Save my choices
            </button>
          )}
          <button
            onClick={rejectAll}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-slate-700 text-white hover:bg-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Reject all
          </button>
          <button
            onClick={acceptAll}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-colors"
          >
            Accept all
          </button>
        </div>
      </div>
    </div>
  );
}
