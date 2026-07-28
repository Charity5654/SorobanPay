'use client';

/**
 * OfflineBanner
 *
 * Displays a fixed banner at the top of the page when the device loses
 * network connectivity, and hides it automatically when connectivity is
 * restored. Uses the browser's `online` / `offline` events.
 *
 * The banner is purely informational — it does not block interaction.
 * Freighter signing will still be accessible; the banner simply warns
 * the user that transactions cannot be submitted without connectivity.
 */

import { useState, useEffect } from 'react';

export function OfflineBanner() {
  const [isOffline, setIsOffline] = useState(false);

  useEffect(() => {
    // Read initial state (navigator.onLine is true by default in SSR, so we
    // only run this on the client after hydration)
    setIsOffline(!navigator.onLine);

    const handleOffline = () => setIsOffline(true);
    const handleOnline = () => setIsOffline(false);

    window.addEventListener('offline', handleOffline);
    window.addEventListener('online', handleOnline);

    return () => {
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="You are offline"
      className="fixed top-0 left-0 right-0 z-50 flex items-center justify-center gap-2 bg-yellow-500/90 backdrop-blur-sm px-4 py-2 text-sm font-medium text-gray-900 shadow-lg"
    >
      {/* Offline icon */}
      <svg
        className="h-4 w-4 shrink-0"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
        strokeWidth={2}
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M3 3l18 18M8.111 8.111A7.5 7.5 0 0 1 19.5 12M4.929 4.929A10.5 10.5 0 0 0 19.071 19.07M12 12h.01M9.75 9.75A3 3 0 0 1 15 12"
        />
      </svg>
      <span>
        You are offline — read-only mode. Transactions cannot be submitted until you reconnect.
      </span>
    </div>
  );
}
