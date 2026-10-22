'use client';

/**
 * app/error.tsx — root-level route error boundary
 *
 * Catches unhandled render errors that escape nested segment boundaries.
 * Renders a correlation-ID fallback and preserves home navigation.
 *
 * Issue #1051 — Add route-level error boundaries
 */

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} />;
}
