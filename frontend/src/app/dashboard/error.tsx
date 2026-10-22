'use client';

/**
 * app/dashboard/error.tsx — /dashboard route error boundary
 *
 * Catches unhandled render errors on the subscriber dashboard route.
 * Provides correlation ID, retry, and home navigation.
 *
 * Issue #1051 — Add route-level error boundaries
 */

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} routeName="Dashboard" />;
}
