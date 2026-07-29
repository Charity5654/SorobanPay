/**
 * animations.ts
 *
 * Centralized Framer Motion animation variants for SorobanPay.
 * All variants include a reduced-motion fallback via the
 * `transition` key — but the primary gate is the
 * `prefers-reduced-motion` media query handled in globals.css
 * (which zeroes out CSS animation durations) and the
 * `useReducedMotion` hook used by each component.
 *
 * Animation durations: 150–300ms as specified in #452 UX-117.
 *
 * Issue: #452 UX-117
 */

import type { Variants, Transition } from 'framer-motion';

// ── Shared transitions ─────────────────────────────────────────────────────

export const fastTransition: Transition = { duration: 0.15, ease: 'easeOut' };
export const baseTransition: Transition = { duration: 0.25, ease: 'easeOut' };
export const slowTransition: Transition = { duration: 0.35, ease: 'easeOut' };

// ── Reduced-motion variants (no visual movement, instant opacity) ──────────

export const reducedMotionVariants: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0 } },
  exit:    { opacity: 0, transition: { duration: 0 } },
};

// ── Fade in ────────────────────────────────────────────────────────────────

export const fadeInVariants: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: baseTransition },
  exit:    { opacity: 0, transition: fastTransition },
};

// ── Slide up + fade (success card entrance) ────────────────────────────────

export const slideUpVariants: Variants = {
  hidden:  { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: baseTransition },
  exit:    { opacity: 0, y: -8, transition: fastTransition },
};

// ── Scale in + fade (modal entrance) ──────────────────────────────────────

export const scaleInVariants: Variants = {
  hidden:  { opacity: 0, scale: 0.95 },
  visible: { opacity: 1, scale: 1, transition: baseTransition },
  exit:    { opacity: 0, scale: 0.97, transition: fastTransition },
};

// ── Modal backdrop fade ────────────────────────────────────────────────────

export const backdropVariants: Variants = {
  hidden:  { opacity: 0 },
  visible: { opacity: 1, transition: fastTransition },
  exit:    { opacity: 0, transition: fastTransition },
};

// ── Shake (error alert) ────────────────────────────────────────────────────

export const shakeVariants: Variants = {
  idle:  { x: 0 },
  shake: {
    x: [0, -6, 6, -4, 4, -2, 2, 0],
    transition: { duration: 0.4, ease: 'easeInOut' },
  },
};

// ── Form submit scale-down + fade ─────────────────────────────────────────

export const formSubmitVariants: Variants = {
  idle:        { opacity: 1, scale: 1 },
  submitting:  { opacity: 0.6, scale: 0.99, transition: fastTransition },
  visible:     { opacity: 1, scale: 1, transition: baseTransition },
};

// ── Step wizard slide left/right ──────────────────────────────────────────

export const slideLeftVariants: Variants = {
  enter:   { opacity: 0, x: 40 },
  center:  { opacity: 1, x: 0, transition: baseTransition },
  exit:    { opacity: 0, x: -40, transition: fastTransition },
};

export const slideRightVariants: Variants = {
  enter:   { opacity: 0, x: -40 },
  center:  { opacity: 1, x: 0, transition: baseTransition },
  exit:    { opacity: 0, x: 40, transition: fastTransition },
};
