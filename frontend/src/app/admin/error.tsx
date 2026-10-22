'use client';

/**
 * app/admin/error.tsx — /admin route error boundary
 *
 * Catches unhandled render errors on the admin dashboard route.
 * Provides correlation ID, retry, and home navigation.
 *
 * Issue #1051 — Add route-level error boundaries
 */

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

export default function AdminError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} routeName="Admin" />;
}
