'use client';

/**
 * InstallPrompt — Add-to-Home-Screen (A2HS) install banner.
 *
 * Shows the native PWA install prompt after the user has visited the app at
 * least twice. This avoids interrupting first-time visitors who may not yet
 * understand the app.
 *
 * Strategy:
 *  - On each page load, increment a visit counter in localStorage.
 *  - If the counter reaches the threshold (default: 2 visits) and the browser
 *    fires `beforeinstallprompt`, display the in-app install card.
 *  - Clicking "Install" calls `prompt()` on the deferred event.
 *  - Clicking "Not now" dismisses the card and sets a flag to suppress it
 *    for the rest of the session.
 *  - Once installed, the card is permanently hidden.
 *
 * Freighter compatibility:
 *  The `beforeinstallprompt` event is fired only by the browser, not by
 *  Freighter. The install prompt UI does not interact with the wallet API in
 *  any way, so there is no risk of interference with signing flows.
 */

import { useState, useEffect, useCallback } from 'react';

const VISIT_COUNT_KEY = 'sorobanpay:pwa:visits';
const DISMISSED_KEY = 'sorobanpay:pwa:dismissed';
const INSTALL_THRESHOLD = 2;

// The BeforeInstallPromptEvent is not in the standard TypeScript DOM types yet
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [showBanner, setShowBanner] = useState(false);

  useEffect(() => {
    // Don't show if the user has already dismissed it this session or installed
    if (localStorage.getItem(DISMISSED_KEY) === 'true') return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    // Increment visit counter
    const raw = localStorage.getItem(VISIT_COUNT_KEY);
    const count = raw ? parseInt(raw, 10) : 0;
    const newCount = count + 1;
    localStorage.setItem(VISIT_COUNT_KEY, String(newCount));

    const handleBeforeInstall = (e: Event) => {
      e.preventDefault();
      const promptEvent = e as BeforeInstallPromptEvent;
      setDeferredPrompt(promptEvent);

      // Only show the banner once the threshold is reached
      if (newCount >= INSTALL_THRESHOLD) {
        setShowBanner(true);
      }
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstall);

    // If the prompt was already captured before this component mounted
    // (e.g., from a previous event listener), check the threshold
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstall);
    };
  }, []);

  const handleInstall = useCallback(async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;
    if (choice.outcome === 'accepted') {
      localStorage.setItem(DISMISSED_KEY, 'true');
    }
    setDeferredPrompt(null);
    setShowBanner(false);
  }, [deferredPrompt]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(DISMISSED_KEY, 'true');
    setShowBanner(false);
  }, []);

  if (!showBanner || !deferredPrompt) return null;

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label="Install SorobanPay"
      className="fixed bottom-4 left-4 right-4 z-40 max-w-sm mx-auto rounded-xl border border-violet-500/20 bg-gray-900 p-4 shadow-2xl sm:left-auto sm:right-4 sm:mx-0"
    >
      <div className="flex items-start gap-3">
        {/* App icon */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/icons/icon-72x72.png"
          alt="SorobanPay app icon"
          className="w-12 h-12 rounded-xl shrink-0"
          width={48}
          height={48}
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-white">Install SorobanPay</p>
          <p className="text-xs text-gray-400 mt-0.5">
            Add to your home screen for quick access and offline support.
          </p>
        </div>
        {/* Close button */}
        <button
          onClick={handleDismiss}
          aria-label="Dismiss install prompt"
          className="shrink-0 text-gray-500 hover:text-gray-300 transition-colors"
        >
          <svg
            className="w-4 h-4"
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M6.28 5.22a.75.75 0 0 0-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 1 0 1.06 1.06L10 11.06l3.72 3.72a.75.75 0 1 0 1.06-1.06L11.06 10l3.72-3.72a.75.75 0 0 0-1.06-1.06L10 8.94 6.28 5.22Z" />
          </svg>
        </button>
      </div>

      {/* Action buttons */}
      <div className="mt-3 flex gap-2">
        <button
          onClick={handleInstall}
          className="flex-1 rounded-lg bg-violet-600 hover:bg-violet-500 transition-colors px-3 py-1.5 text-xs font-medium text-white focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-1 focus:ring-offset-gray-900"
        >
          Install
        </button>
        <button
          onClick={handleDismiss}
          className="flex-1 rounded-lg border border-gray-700 hover:border-gray-500 transition-colors px-3 py-1.5 text-xs font-medium text-gray-400 hover:text-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-1 focus:ring-offset-gray-900"
        >
          Not now
        </button>
      </div>
    </div>
  );
}
