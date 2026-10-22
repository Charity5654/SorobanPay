'use client';

/**
 * RouteErrorBoundary.tsx
 *
 * Reusable fallback UI for Next.js App Router `error.tsx` segments.
 *
 * Features:
 *  - Correlation ID generated per error occurrence (stable across re-renders)
 *  - One-click retry via the Next.js `reset` callback
 *  - Back-to-home navigation preserved via Next.js `useRouter`
 *  - Accessible: role="alert", aria-live="assertive", focus management
 *  - Wallet/network/tenant-safe: renders no wallet state, no sensitive env vars
 *  - Error message sanitised — raw stack traces hidden in production
 *
 * Usage (in app/<route>/error.tsx):
 *
 * ```tsx
 * 'use client';
 * import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';
 *
 * export default function RouteError({
 *   error,
 *   reset,
 * }: {
 *   error: Error & { digest?: string };
 *   reset: () => void;
 * }) {
 *   return <RouteErrorBoundary error={error} reset={reset} routeName="Subscribe" />;
 * }
 * ```
 *
 * Issue #1051 — Add route-level error boundaries
 */

import { useEffect, useId, useRef } from 'react';
import Link from 'next/link';

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface RouteErrorBoundaryProps {
  /** The error surfaced by Next.js App Router */
  error: Error & { digest?: string };
  /** Callback that re-renders the route segment (provided by Next.js) */
  reset: () => void;
  /** Human-readable name of the failing route shown in the heading */
  routeName?: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Generate a short, URL-safe correlation ID from the current timestamp and a
 * random suffix.  Stable across re-renders because it is created once outside
 * the component or stored in a ref.
 */
function makeCorrelationId(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ERR-${ts}-${rand}`;
}

/**
 * Return a sanitised user-facing message.
 * - In production we never surface raw error messages (may contain paths,
 *   secrets, or internal identifiers).
 * - In development the raw message is shown to speed up debugging.
 */
function sanitiseMessage(error: Error): string {
  if (process.env.NODE_ENV === 'development') {
    return error.message || 'An unexpected error occurred.';
  }
  return 'An unexpected error occurred. Please try again or return to the home page.';
}

// ─── Component ─────────────────────────────────────────────────────────────────

export function RouteErrorBoundary({
  error,
  reset,
  routeName,
}: RouteErrorBoundaryProps) {
  // Stable correlation ID — created once per error instance using a ref.
  const correlationRef = useRef<string | null>(null);
  if (correlationRef.current === null) {
    correlationRef.current = makeCorrelationId();
  }
  const correlationId = correlationRef.current;

  // Unique IDs for accessibility relationships
  const headingId = useId();
  const descId = useId();

  // Focus the alert region on mount so screen readers announce it immediately.
  const regionRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    regionRef.current?.focus();
  }, []);

  // Log to console (replace with your observability pipeline).
  useEffect(() => {
    const entry = {
      correlationId,
      routeName: routeName ?? 'unknown',
      digest: error.digest,
      message: error.message,
      // Stack only in dev to avoid leaking paths in production logs shipped
      // to external services.
      ...(process.env.NODE_ENV === 'development' ? { stack: error.stack } : {}),
    };
    console.error('[RouteErrorBoundary]', entry);
  }, [correlationId, error, routeName]);

  const heading = routeName
    ? `Something went wrong on the ${routeName} page`
    : 'Something went wrong';

  const userMessage = sanitiseMessage(error);

  return (
    <main
      className="min-h-screen flex items-center justify-center px-4 py-12"
      aria-label={`Error on ${routeName ?? 'this'} page`}
    >
      <div
        ref={regionRef}
        role="alert"
        aria-live="assertive"
        aria-labelledby={headingId}
        aria-describedby={descId}
        tabIndex={-1}
        className="w-full max-w-lg rounded-2xl border-2 border-red-600/50 bg-gradient-to-br from-red-900/40 to-red-800/20 shadow-lg p-6 sm:p-8 text-white outline-none"
      >
        {/* Icon + heading */}
        <div className="flex items-start gap-4 mb-6">
          <span className="text-4xl flex-shrink-0" aria-hidden="true">⚠️</span>
          <div className="min-w-0">
            <h1
              id={headingId}
              className="text-xl sm:text-2xl font-bold text-red-300 leading-snug mb-2"
            >
              {heading}
            </h1>
            <p id={descId} className="text-gray-300 text-sm leading-relaxed">
              {userMessage}
            </p>
          </div>
        </div>

        {/* Dev-only error detail */}
        {process.env.NODE_ENV === 'development' && (
          <div className="bg-gray-900/60 rounded-lg p-4 mb-6 border border-red-800/40 text-xs">
            <p className="text-red-300 font-semibold mb-1">Error detail (dev only)</p>
            <pre className="text-gray-300 overflow-x-auto whitespace-pre-wrap leading-relaxed">
              {error.message}
            </pre>
            {error.stack && (
              <details className="mt-2">
                <summary className="text-gray-500 cursor-pointer hover:text-gray-400">
                  Stack trace
                </summary>
                <pre className="mt-2 text-gray-500 overflow-x-auto whitespace-pre-wrap">
                  {error.stack}
                </pre>
              </details>
            )}
          </div>
        )}

        {/* Correlation ID — always visible for support conversations */}
        <div className="rounded-lg bg-gray-900/40 border border-gray-700/40 px-3 py-2 mb-6">
          <p className="text-xs text-gray-500">
            Reference ID:{' '}
            <span
              className="font-mono text-gray-300 select-all"
              aria-label={`Error reference ID: ${correlationId}`}
            >
              {correlationId}
            </span>
            {error.digest && (
              <span className="ml-2 text-gray-600">
                · digest:{' '}
                <span className="font-mono text-gray-500">{error.digest}</span>
              </span>
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            type="button"
            onClick={reset}
            className="flex-1 rounded-lg bg-red-700 hover:bg-red-600 active:bg-red-800
                       px-4 py-3 text-sm font-semibold transition-all duration-150
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-red-400
                       min-h-[48px]"
            aria-label="Try again — reload this route"
          >
            Try again
          </button>

          <Link
            href="/"
            className="flex-1 rounded-lg border-2 border-red-600/70 text-red-300 text-center
                       hover:bg-red-900/40 active:bg-red-900/60
                       px-4 py-3 text-sm font-semibold transition-all duration-150
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500
                       min-h-[48px] flex items-center justify-center"
            aria-label="Navigate back to the home page"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

export default RouteErrorBoundary;
