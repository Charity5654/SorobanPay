'use client';

/**
 * app/merchant/error.tsx — /merchant route error boundary
 *
 * Catches unhandled render errors on the merchant portal route.
 * Provides correlation ID, retry, and home navigation.
 *
 * Issue #1051 — Add route-level error boundaries
 */

import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

export default function MerchantError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorBoundary error={error} reset={reset} routeName="Merchant Portal" />;
}
