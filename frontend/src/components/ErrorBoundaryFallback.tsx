'use client';

/**
 * ErrorBoundaryFallback.tsx
 *
 * Fallback UI rendered by React Error Boundaries when an unhandled error
 * occurs in the component tree. Provides a reset button and a concise
 * error message.
 */

export interface ErrorBoundaryFallbackProps {
  /** The error that was thrown */
  error?: Error;
  /** Callback to reset the error boundary and re-render children */
  resetErrorBoundary?: () => void;
  /** Optional heading override */
  heading?: string;
}

export function ErrorBoundaryFallback({
  error,
  resetErrorBoundary,
  heading = 'Something went wrong',
}: ErrorBoundaryFallbackProps) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="w-full max-w-lg mx-auto p-4 sm:p-6"
    >
      <div className="rounded-2xl bg-gradient-to-br from-red-900/40 to-red-800/20 border-2 border-red-600/50 shadow-lg p-6 sm:p-8 text-white">
        {/* Icon + heading */}
        <div className="flex items-start gap-4 mb-6">
          <span className="text-4xl flex-shrink-0" aria-hidden="true">⚠️</span>
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold text-red-300 mb-2">
              {heading}
            </h2>
            <p className="text-gray-300 text-sm leading-relaxed">
              An unexpected error occurred. You can try refreshing the page or
              resetting the component below.
            </p>
          </div>
        </div>

        {/* Error detail (collapsed in production — shown for debugging) */}
        {error && (
          <div className="bg-gray-900/60 rounded-lg p-4 sm:p-5 mb-6 border border-red-800/40">
            <p className="text-red-300 font-semibold text-sm mb-2">Error detail</p>
            <pre className="text-xs text-gray-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {error.message}
            </pre>
            {error.stack && (
              <details className="mt-3">
                <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-400">
                  Stack trace
                </summary>
                <pre className="mt-2 text-xs text-gray-500 overflow-x-auto whitespace-pre-wrap">
                  {error.stack}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          {resetErrorBoundary && (
            <button
              onClick={resetErrorBoundary}
              className="flex-1 rounded-lg bg-red-700 hover:bg-red-600 active:bg-red-800
                         px-4 py-3 text-sm font-semibold transition-all duration-150
                         focus:outline-none focus:ring-2 focus:ring-red-400 min-h-[48px]"
            >
              Try again
            </button>
          )}
          <button
            onClick={() => window.location.reload()}
            className="flex-1 rounded-lg border-2 border-red-600/70 text-red-300
                       hover:bg-red-900/40 active:bg-red-900/60
                       px-4 py-3 text-sm font-semibold transition-all duration-150
                       focus:outline-none focus:ring-2 focus:ring-red-500 min-h-[48px]"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}

export default ErrorBoundaryFallback;
