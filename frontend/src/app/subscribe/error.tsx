'use client';

/**
 * app/subscribe/error.tsx — /subscribe route error boundary
 *
 * Catches unhandled render errors on the subscription form route.
 * Provides correlation ID, retry, and home navigation.
 *
 * Issue #1051 — Add route-level error boundaries
 */

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

export default function SubscribeError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} routeName="Subscribe" />;
}
