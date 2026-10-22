'use client';

/**
 * useMounted.ts
 *
 * Returns `true` only after the component has been mounted on the client.
 * Use this to guard any render that depends on browser-only APIs (e.g. wallet
 * state, window.freighter) so that the SSR-rendered HTML and the first
 * client-side render match exactly — preventing React hydration mismatches.
 *
 * FE-47: Hydration mismatch fix
 *
 * Usage:
 *   const mounted = useMounted();
 *   if (!mounted) return <ServerSafeFallback />;
 *   // safe to use client-only state here
 */

import { useState, useEffect } from 'react';

export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  return mounted;
}
