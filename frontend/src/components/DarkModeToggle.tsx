'use client';

/**
 * DarkModeToggle.tsx
 *
 * A button that toggles between dark and light mode.
 * Uses sun (☀️) and moon (🌙) SVG icons.
 *
 * Accessibility:
 *  - aria-label reflects the current state and what clicking will do
 *  - aria-pressed reflects the dark mode state
 *  - Focus ring meets WCAG 3:1 contrast requirement
 *
 * Place this component in the header alongside LanguageSelector.
 */

import { useTheme } from '@/context/ThemeContext';

export function DarkModeToggle({ className = '' }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  return (
    <button
      type="button"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      aria-pressed={isDark}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={`
        inline-flex items-center justify-center
        h-8 w-8 rounded-lg
        border border-gray-700 dark:border-gray-600
        bg-gray-100 dark:bg-gray-800
        text-gray-700 dark:text-gray-300
        hover:bg-gray-200 dark:hover:bg-gray-700
        hover:text-gray-900 dark:hover:text-white
        transition-colors duration-150
        focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
        ${className}
      `}
    >
      {isDark ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}

// ─── Icons ─────────────────────────────────────────────────────────────────────

function SunIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      className="h-4 w-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
    </svg>
  );
}

export default DarkModeToggle;
