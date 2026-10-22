'use client';

/**
 * StatusBadge.tsx
 *
 * Accessible status indicator that uses BOTH an icon and colour.
 * This satisfies WCAG 1.4.1 (Use of Color) — information is never
 * conveyed by colour alone.
 *
 * All colour combinations are WCAG AA certified (4.5:1 minimum on
 * the surface-base / gray-950 background). See tailwind.config.ts.
 *
 * Issue: #451 UX-116
 */

import type { ReactNode } from 'react';

// ─── Types ────────────────────────────────────────────────────────────────────

export type StatusVariant = 'success' | 'error' | 'warning' | 'info' | 'neutral';

export interface StatusBadgeProps {
  /** Semantic intent of the status */
  variant: StatusVariant;
  /** Visible label text */
  children: ReactNode;
  /** Optional override for screen-reader announcement */
  srLabel?: string;
  /** Render as a pill badge (default) or inline text */
  display?: 'badge' | 'inline';
  /** Show or hide the icon (default: true) */
  showIcon?: boolean;
}

// ─── Icon definitions ─────────────────────────────────────────────────────────

const ICONS: Record<StatusVariant, ReactNode> = {
  success: (
    // Checkmark circle
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-3.5 w-3.5 flex-shrink-0"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
        clipRule="evenodd"
      />
    </svg>
  ),
  error: (
    // X circle
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-3.5 w-3.5 flex-shrink-0"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
        clipRule="evenodd"
      />
    </svg>
  ),
  warning: (
    // Exclamation triangle
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-3.5 w-3.5 flex-shrink-0"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
        clipRule="evenodd"
      />
    </svg>
  ),
  info: (
    // Information circle
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-3.5 w-3.5 flex-shrink-0"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
        clipRule="evenodd"
      />
    </svg>
  ),
  neutral: (
    // Minus / dash
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-3.5 w-3.5 flex-shrink-0"
      viewBox="0 0 20 20"
      fill="currentColor"
      aria-hidden="true"
    >
      <path
        fillRule="evenodd"
        d="M3 10a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z"
        clipRule="evenodd"
      />
    </svg>
  ),
};

// ─── Style maps ───────────────────────────────────────────────────────────────

const BADGE_CLS: Record<StatusVariant, string> = {
  success: 'bg-status-success-surface border-status-success-border text-status-success-text',
  error:   'bg-status-error-surface   border-status-error-border   text-status-error-text',
  warning: 'bg-status-warning-surface border-status-warning-border text-status-warning-text',
  info:    'bg-status-info-surface    border-status-info-border    text-status-info-text',
  neutral: 'bg-surface-overlay        border-surface-border         text-content-secondary',
};

// ─── Component ────────────────────────────────────────────────────────────────

export function StatusBadge({
  variant,
  children,
  srLabel,
  display = 'badge',
  showIcon = true,
}: StatusBadgeProps) {
  const isBadge = display === 'badge';

  return (
    <span
      className={
        isBadge
          ? `inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${BADGE_CLS[variant]}`
          : `inline-flex items-center gap-1.5 text-xs font-medium ${BADGE_CLS[variant].split(' ').filter(c => c.startsWith('text-')).join(' ')}`
      }
      aria-label={srLabel}
    >
      {showIcon && ICONS[variant]}
      {children}
    </span>
  );
}
