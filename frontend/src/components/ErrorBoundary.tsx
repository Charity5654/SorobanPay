"use client";

/**
 * ErrorBoundary.tsx
 *
 * React class-based error boundary that catches render-time and lifecycle
 * errors in the component subtree. Prevents the full app from crashing on
 * unhandled exceptions and renders a graceful fallback UI instead.
 *
 * Features:
 *  - Configurable fallback UI (defaults to a full-page recovery card)
 *  - Optional Sentry integration, gated behind NEXT_PUBLIC_SENTRY_DSN
 *  - Structured console.error with component name, wallet, and error details
 *  - Per-component boundary support via the `name` prop
 *
 * Issue: FE-38
 */

import React, { Component, type ErrorInfo, type ReactNode } from "react";

// ─── Sentry (optional, loaded lazily) ─────────────────────────────────────────

/**
 * Sends the error to Sentry only when NEXT_PUBLIC_SENTRY_DSN is set.
 * Uses a fully dynamic import so @sentry/nextjs is an optional dependency —
 * the bundle is unaffected when the env variable is absent.
 *
 * The import is typed loosely (unknown) so TypeScript does not require the
 * @sentry/nextjs package to be installed for type-checking to pass.
 */
async function reportToSentry(
  error: Error,
  info: ErrorInfo,
  context: Record<string, unknown>,
): Promise<void> {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return;

  try {
    /* eslint-disable */
    const Sentry = (await import("@sentry/nextjs" as string)) as any;
    Sentry.withScope((scope: unknown) => {
      const s = scope as any;
      s.setExtras(context);
      s.setExtra("componentStack", info.componentStack ?? "");
      Sentry.captureException(error);
    });
    /* eslint-enable */
  } catch {
    // Sentry unavailable — already logged to console below
  }
}

// ─── Props & State ────────────────────────────────────────────────────────────

export interface ErrorBoundaryProps {
  /** Child component tree to protect. */
  children: ReactNode;
  /**
   * Optional custom fallback. Receives the error and a reset callback.
   * When omitted, the default recovery card is rendered.
   */
  fallback?: (error: Error, reset: () => void) => ReactNode;
  /**
   * Human-readable name for the boundary (used in error logs and Sentry context).
   * E.g. "SubscriptionForm", "PaymentHistory".
   */
  name?: string;
  /**
   * Connected wallet public key — included in error context for support.
   * Pass from WalletContext when available.
   */
  walletPublicKey?: string | null;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

// ─── Default fallback UI ──────────────────────────────────────────────────────

function DefaultFallback({
  error,
  onReset,
  name,
}: {
  error: Error;
  onReset: () => void;
  name?: string;
}) {
  return (
    <div
      role="alert"
      aria-live="assertive"
      className="flex min-h-[200px] w-full flex-col items-center justify-center rounded-2xl
                 border border-red-700/60 bg-red-950/40 p-8 text-center"
    >
      <p className="text-3xl mb-3" aria-hidden="true">
        ⚠️
      </p>
      <h2 className="text-lg font-bold text-red-200 mb-2">
        {name ? `${name} encountered an error` : "Something went wrong"}
      </h2>
      <p className="text-sm text-red-300/80 mb-6 max-w-sm">
        Something went wrong. Refresh the page or contact support.
      </p>
      {process.env.NODE_ENV !== "production" && (
        <details className="mb-4 w-full max-w-sm text-left">
          <summary className="cursor-pointer text-xs text-red-400/70 hover:text-red-300 select-none">
            Error details (dev only)
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-red-950/60 p-3 text-xs text-red-300/80 border border-red-800/40">
            {error.message}
          </pre>
        </details>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={onReset}
          className="rounded-lg bg-red-700 hover:bg-red-600 px-4 py-2 text-sm font-semibold
                     text-white transition-colors focus:outline-none focus:ring-2 focus:ring-red-400"
        >
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg bg-gray-700 hover:bg-gray-600 px-4 py-2 text-sm font-semibold
                     text-white transition-colors focus:outline-none focus:ring-2 focus:ring-gray-400"
        >
          Refresh page
        </button>
      </div>
    </div>
  );
}

// ─── ErrorBoundary class ──────────────────────────────────────────────────────

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
    this.reset = this.reset.bind(this);
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    const context: Record<string, unknown> = {
      boundaryName: this.props.name ?? "unknown",
      walletPublicKey: this.props.walletPublicKey ?? null,
      errorMessage: error.message,
      componentStack: info.componentStack ?? "",
    };

    // Structured console log for all environments
    console.error("[ErrorBoundary] Caught error:", context, error);

    // Optional Sentry report (fire-and-forget, non-blocking)
    void reportToSentry(error, info, context);
  }

  reset(): void {
    this.setState({ hasError: false, error: null });
  }

  render(): ReactNode {
    if (!this.state.hasError || !this.state.error) {
      return this.props.children;
    }

    const { fallback, name } = this.props;
    const error = this.state.error;

    if (fallback) {
      return fallback(error, this.reset);
    }

    return (
      <DefaultFallback error={error} onReset={this.reset} name={name} />
    );
  }
}

// ─── Convenience wrapper for async errors via useEffect ───────────────────────

/**
 * useErrorBoundaryTrigger
 *
 * Returns a `throwError` callback that re-throws an error inside a React
 * state update, which causes the nearest ErrorBoundary to catch it.
 *
 * Usage (inside a functional component):
 *   const throwError = useErrorBoundaryTrigger();
 *   // inside an async handler:
 *   throwError(new Error("async failure"));
 */
import { useState, useCallback } from "react";

export function useErrorBoundaryTrigger(): (error: Error) => void {
  const [, setError] = useState<Error | null>(null);

  return useCallback((error: Error) => {
    // Storing the error in state triggers a re-render; returning a throw from
    // setState causes React to propagate it to the nearest error boundary.
    setError(() => {
      throw error;
    });
  }, []);
}

export default ErrorBoundary;
