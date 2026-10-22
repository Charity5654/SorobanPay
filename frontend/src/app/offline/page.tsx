/**
 * Offline fallback page — served by the service worker when a navigation
 * request fails because the device has no network connectivity.
 *
 * This page intentionally has no dynamic data dependencies; it is a static
 * shell that the service worker can always serve from cache.
 */
export default function OfflinePage() {
  return (
    <div className="min-h-screen bg-gray-950 text-white flex items-center justify-center px-4">
      <div className="max-w-md w-full text-center space-y-6">
        {/* Icon */}
        <div className="mx-auto w-16 h-16 rounded-full bg-yellow-500/10 border border-yellow-500/20 flex items-center justify-center">
          <svg
            className="w-8 h-8 text-yellow-400"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            strokeWidth={1.5}
            stroke="currentColor"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126ZM12 15.75h.007v.008H12v-.008Z"
            />
          </svg>
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white">You are offline</h1>
          <p className="text-gray-400 text-sm leading-relaxed">
            SorobanPay requires an internet connection to submit transactions and interact with
            the Stellar blockchain. Please reconnect and try again.
          </p>
        </div>

        {/* Read-only notice */}
        <div className="rounded-lg border border-yellow-500/20 bg-yellow-500/5 px-4 py-3 text-left">
          <p className="text-yellow-300 text-sm font-medium">Read-only mode</p>
          <p className="text-yellow-200/70 text-xs mt-1">
            Cached pages may be available for browsing, but no transactions can be signed or
            submitted until the connection is restored.
          </p>
        </div>

        {/* Retry button */}
        <button
          onClick={() => window.location.reload()}
          className="w-full rounded-lg bg-violet-600 hover:bg-violet-500 transition-colors px-4 py-2.5 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-violet-400 focus:ring-offset-2 focus:ring-offset-gray-950"
        >
          Try again
        </button>

        {/* Freighter note */}
        <p className="text-gray-600 text-xs">
          Note: Freighter wallet signing requires a live network connection to the Stellar RPC.
        </p>
      </div>
    </div>
  );
}
