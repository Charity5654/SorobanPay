"use client";

/**
 * useReducedMotion.ts
 *
 * Issue #1144 – Add reduced-motion transaction states
 *
 * Returns true when the user has enabled the OS-level
 * "Reduce motion" accessibility preference, which maps to the
 * CSS media query `prefers-reduced-motion: reduce`.
 *
 * Components should replace animated spinners / progress bars
 * with static equivalents when this hook returns true.
 *
 * SSR-safe: defaults to false on the server (window not available).
 *
 * Usage:
 *   const prefersReducedMotion = useReducedMotion();
 *   // prefersReducedMotion === true → show static indicator
 *   // prefersReducedMotion === false → show animated spinner
 */

import { useEffect, useState } from "react";

/** Media query string for the reduced-motion preference. */
const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  // Default to false (motion allowed) for SSR compatibility
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Guard: window.matchMedia is not available in Node/SSR
    if (typeof window === "undefined" || !window.matchMedia) return;

    const mql = window.matchMedia(QUERY);
    // Set initial value from current preference
    setPrefersReducedMotion(mql.matches);

    // Listen for preference changes (user toggles setting while page is open)
    const handleChange = (e: MediaQueryListEvent) => {
      setPrefersReducedMotion(e.matches);
    };

    mql.addEventListener("change", handleChange);
    return () => mql.removeEventListener("change", handleChange);
  }, []);

  return prefersReducedMotion;
}
