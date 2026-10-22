'use client';

/**
 * ConfirmationModal.tsx
 *
 * Reusable confirmation dialog for destructive actions.
 *
 * Features:
 * - 3-second delay before the destructive button becomes clickable
 *   (prevents double-tap / accidental confirmation)
 * - Focus trapped inside the modal while open
 * - Escape key dismisses (calls onCancel)
 * - role="dialog" + aria-modal="true" + aria-labelledby for screen readers
 * - Countdown indicator communicates the delay visually
 * - Framer Motion scale + fade entrance (#452 UX-117)
 * - prefers-reduced-motion respected via useReducedMotion()
 *
 * Issue: #450 UX-115
 * WCAG: 3.3.4 (Error Prevention)
 */

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import {
  backdropVariants,
  scaleInVariants,
  reducedMotionVariants,
} from '@/lib/animations';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ConfirmationModalProps {
  /** Unique id used for aria-labelledby — must be unique per page */
  titleId?: string;
  /** Modal heading, e.g. "Cancel subscription?" */
  title: string;
  /** Descriptive body content */
  children: ReactNode;
  /** Label for the safe / dismiss button (default: "Keep Subscription") */
  cancelLabel?: string;
  /** Label for the destructive confirm button (default: "Yes, Cancel") */
  confirmLabel?: string;
  /** Seconds to wait before destructive button is enabled (default: 3) */
  delaySeconds?: number;
  /** Called when the user confirms the destructive action */
  onConfirm: () => void;
  /** Called when the user dismisses (Keep / Escape) */
  onCancel: () => void;
}

// ─── Focusable elements selector ─────────────────────────────────────────────

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// ─── Component ────────────────────────────────────────────────────────────────

export function ConfirmationModal({
  titleId = 'confirmation-modal-title',
  title,
  children,
  cancelLabel = 'Keep Subscription',
  confirmLabel = 'Yes, Cancel',
  delaySeconds = 3,
  onConfirm,
  onCancel,
}: ConfirmationModalProps) {
  const [countdown, setCountdown] = useState(delaySeconds);
  const dialogRef = useRef<HTMLDivElement>(null);
  // Remember element that had focus before modal opened so we can restore it
  const priorFocusRef = useRef<HTMLElement | null>(null);
  const prefersReducedMotion = useReducedMotion();

  // ── Countdown timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (countdown <= 0) return;
    const id = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(id);
  }, [countdown]);

  // ── Focus management — trap focus on mount, restore on unmount ───────────
  useEffect(() => {
    priorFocusRef.current = document.activeElement as HTMLElement;

    // Move focus into modal on open
    const firstFocusable = dialogRef.current?.querySelector<HTMLElement>(FOCUSABLE);
    firstFocusable?.focus();

    return () => {
      priorFocusRef.current?.focus();
    };
  }, []);

  // ── Keyboard handling ────────────────────────────────────────────────────
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key === 'Escape') {
        onCancel();
        return;
      }

      if (e.key === 'Tab') {
        const dialog = dialogRef.current;
        if (!dialog) return;
        const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE));
        if (focusables.length === 0) return;

        const first = focusables[0];
        const last = focusables[focusables.length - 1];

        if (e.shiftKey) {
          // Shift+Tab — wrap backward
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          // Tab — wrap forward
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    },
    [onCancel],
  );

  const isDestructiveEnabled = countdown <= 0;
  const panelVariants = prefersReducedMotion ? reducedMotionVariants : scaleInVariants;
  const bgVariants    = prefersReducedMotion ? reducedMotionVariants : backdropVariants;

  return (
    /* Backdrop */
    <AnimatePresence>
      <motion.div
        key="modal-backdrop"
        variants={bgVariants}
        initial="hidden"
        animate="visible"
        exit="exit"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
        aria-hidden="false"
        onClick={(e) => {
          if (e.target === e.currentTarget) onCancel();
        }}
      >
        {/* Dialog panel */}
        <motion.div
          ref={dialogRef}
          key="modal-panel"
          variants={panelVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          onKeyDown={handleKeyDown}
          className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl p-6 space-y-5 text-white focus:outline-none"
          tabIndex={-1}
        >
        {/* Header */}
        <div className="flex items-start gap-3">
          {/* Destructive action warning icon */}
          <span
            className="flex-shrink-0 flex h-10 w-10 items-center justify-center rounded-full bg-red-900/50 border border-red-700/50 mt-0.5"
            aria-hidden="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5 text-red-400"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <div className="flex-1 min-w-0">
            <h2
              id={titleId}
              className="text-lg font-bold text-white leading-snug"
            >
              {title}
            </h2>
          </div>
        </div>

        {/* Body */}
        <div className="text-sm text-gray-300 leading-relaxed pl-[52px]">
          {children}
        </div>

        {/* Countdown indicator */}
        {!isDestructiveEnabled && (
          <div
            className="flex items-center gap-2 bg-gray-800/60 border border-gray-700 rounded-lg px-4 py-2.5 text-xs text-gray-400"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-4 w-4 text-yellow-400 flex-shrink-0"
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z"
                clipRule="evenodd"
              />
            </svg>
            <span>
              Please wait&nbsp;
              <strong className="text-yellow-300">{countdown}s</strong>
              &nbsp;before confirming
            </span>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-col-reverse sm:flex-row gap-3 pt-1">
          {/* Safe / keep button — always enabled, receives initial focus */}
          <button
            type="button"
            onClick={onCancel}
            className="flex-1 rounded-lg border border-gray-600 bg-gray-800/50 text-gray-200
                       hover:bg-gray-700 active:bg-gray-800 py-3 text-sm font-semibold
                       transition-colors duration-150 min-h-[48px]
                       focus:outline-none focus-visible:ring-2 focus-visible:ring-gray-400
                       focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900"
          >
            {cancelLabel}
          </button>

          {/* Destructive confirm button — disabled during countdown */}
          <button
            type="button"
            onClick={isDestructiveEnabled ? onConfirm : undefined}
            disabled={!isDestructiveEnabled}
            aria-disabled={!isDestructiveEnabled}
            aria-describedby={!isDestructiveEnabled ? 'confirm-countdown' : undefined}
            className={`flex-1 rounded-lg py-3 text-sm font-semibold transition-all duration-150 min-h-[48px]
                        focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-gray-900
                        ${
                          isDestructiveEnabled
                            ? 'bg-red-700 hover:bg-red-600 active:bg-red-800 text-white focus-visible:ring-red-400 cursor-pointer'
                            : 'bg-red-900/40 text-red-400/60 border border-red-800/40 cursor-not-allowed'
                        }`}
          >
            {!isDestructiveEnabled ? `${confirmLabel} (${countdown}s)` : confirmLabel}
          </button>
        </div>

        {/* SR-only countdown description */}
        <span id="confirm-countdown" className="sr-only">
          {!isDestructiveEnabled
            ? `This button will be available in ${countdown} seconds.`
            : 'Ready to confirm.'}
        </span>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
