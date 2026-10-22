'use client';

/**
 * app/reports/error.tsx — /reports route error boundary
 *
 * Catches unhandled render errors on the reports route.
 * Provides correlation ID, retry, and home navigation.
 *
 * Issue #1051 — Add route-level error boundaries
 */

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

export default function ReportsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} routeName="Reports" />;
}
