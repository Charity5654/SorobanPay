'use client';

/**
 * useKeyboardShortcuts.ts
 *
 * Registers global keyboard shortcuts using react-hotkeys-hook.
 *
 * Shortcuts:
 *   ?       — open / toggle keyboard help modal
 *   N       — scroll/focus the subscription form (new subscription)
 *   H       — scroll to payment history section
 *   M       — scroll to merchant portal section (coming soon)
 *   D       — scroll to dashboard section (coming soon)
 *   Escape  — close modal / cancel (handled by the modal itself)
 *
 * All shortcuts are disabled when focus is inside an <input>, <textarea>,
 * or <select> element (enableOnFormTags is false — the default).
 *
 * Usage:
 *   const { isHelpOpen, openHelp, closeHelp } = useKeyboardShortcuts();
 */

import { useState, useCallback, useRef } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';

export interface ShortcutDefinition {
  /** The key(s) to display in the help modal, e.g. "?" or "N" */
  key: string;
  /** Human-readable description */
  description: string;
  /** Optional category for grouping in the help modal */
  category: 'navigation' | 'actions' | 'modal';
}

export const SHORTCUT_DEFINITIONS: ShortcutDefinition[] = [
  { key: '?', description: 'Show keyboard shortcuts', category: 'modal' },
  { key: 'N', description: 'Focus new subscription form', category: 'actions' },
  { key: 'H', description: 'Jump to payment history', category: 'navigation' },
  { key: 'M', description: 'Jump to merchant portal', category: 'navigation' },
  { key: 'D', description: 'Jump to dashboard (coming soon)', category: 'navigation' },
  { key: 'Esc', description: 'Close modal / cancel', category: 'modal' },
];

/** IDs of landmark sections that shortcuts can scroll to */
const SECTION_IDS = {
  subscriptionForm: 'subscription-form-section',
  paymentHistory: 'payment-history-section',
  merchantPortal: 'merchant-portal-section',
  dashboard: 'dashboard-section',
} as const;

export { SECTION_IDS };

/**
 * Smoothly scrolls a section into view and focuses the first focusable child,
 * falling back to focus on the section itself.
 */
function scrollToSection(sectionId: string): void {
  const el = document.getElementById(sectionId);
  if (!el) return;

  el.scrollIntoView({ behavior: 'smooth', block: 'start' });

  // Focus the first interactive element in the section, or the section itself
  const focusable = el.querySelector<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );

  if (focusable) {
    // Delay slightly to allow the scroll animation to start
    setTimeout(() => focusable.focus({ preventScroll: true }), 100);
  } else if (el.tabIndex === -1) {
    el.setAttribute('tabindex', '-1');
    el.focus({ preventScroll: true });
  }
}

export interface UseKeyboardShortcutsReturn {
  isHelpOpen: boolean;
  openHelp: () => void;
  closeHelp: () => void;
  toggleHelp: () => void;
}

/**
 * Registers all keyboard shortcuts and returns modal state + controls.
 * Mount once at the app root (e.g., in page.tsx or layout client wrapper).
 */
export function useKeyboardShortcuts(): UseKeyboardShortcutsReturn {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  // Stable ref so hotkey callbacks are always fresh without re-registering
  const isHelpOpenRef = useRef(isHelpOpen);
  isHelpOpenRef.current = isHelpOpen;

  const openHelp = useCallback(() => setIsHelpOpen(true), []);
  const closeHelp = useCallback(() => setIsHelpOpen(false), []);
  const toggleHelp = useCallback(() => setIsHelpOpen((v) => !v), []);

  // Common options: do NOT fire when typing in form fields
  const hotkeyOptions = {
    enableOnFormTags: false,
    preventDefault: true,
  } as const;

  // ? — toggle help modal
  useHotkeys('shift+/', toggleHelp, hotkeyOptions);

  // N — focus new subscription form
  useHotkeys(
    'n',
    () => {
      // Close help if open before navigating
      if (isHelpOpenRef.current) setIsHelpOpen(false);
      scrollToSection(SECTION_IDS.subscriptionForm);
    },
    hotkeyOptions,
  );

  // H — jump to payment history
  useHotkeys(
    'h',
    () => {
      if (isHelpOpenRef.current) setIsHelpOpen(false);
      scrollToSection(SECTION_IDS.paymentHistory);
    },
    hotkeyOptions,
  );

  // M — jump to merchant portal
  useHotkeys(
    'm',
    () => {
      if (isHelpOpenRef.current) setIsHelpOpen(false);
      scrollToSection(SECTION_IDS.merchantPortal);
    },
    hotkeyOptions,
  );

  // D — jump to dashboard
  useHotkeys(
    'd',
    () => {
      if (isHelpOpenRef.current) setIsHelpOpen(false);
      scrollToSection(SECTION_IDS.dashboard);
    },
    hotkeyOptions,
  );

  // Escape is handled inside the modal component (react-hotkeys-hook
  // registers it there with `enabled` tied to `isHelpOpen`), so we
  // don't need a duplicate here. If anything else needs Escape in the
  // future, add it to the modal component.

  return { isHelpOpen, openHelp, closeHelp, toggleHelp };
}
