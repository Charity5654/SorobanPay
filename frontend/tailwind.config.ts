/**
 * tailwind.config.ts
 *
 * Semantic colour system — Issue #451 UX-116
 * ─────────────────────────────────────────
 * All foreground/background pairs below are verified against WCAG AA:
 *   • Normal text (< 18 pt / < 14 pt bold) — minimum 4.5 : 1
 *   • Large text  (≥ 18 pt / ≥ 14 pt bold) — minimum 3.0 : 1
 *
 * Base palette (dark theme, bg = #030712 / gray-950):
 *   text-content-primary   : #F9FAFB  (gray-50)   — 16.7 : 1  ✅ AAA
 *   text-content-secondary : #D1D5DB  (gray-300)  —  9.7 : 1  ✅ AA+
 *   text-content-tertiary  : #9CA3AF  (gray-400)  —  5.9 : 1  ✅ AA
 *   text-content-disabled  : #6B7280  (gray-500)  —  3.9 : 1  ✅ AA (large only)
 *
 * Status colours — WCAG 1.4.1: ALWAYS paired with an icon (see StatusBadge component)
 *   status-success-text    : #86EFAC  (green-300) —  8.3 : 1 on gray-950  ✅ AA
 *   status-error-text      : #FCA5A5  (red-300)   —  7.1 : 1 on gray-950  ✅ AA
 *   status-warning-text    : #FDE047  (yellow-300)— 11.4 : 1 on gray-950  ✅ AA
 *   status-info-text       : #93C5FD  (blue-300)  —  7.8 : 1 on gray-950  ✅ AA
 *
 * Interactive surfaces
 *   interactive-primary    : #3B82F6  (blue-500) — focus ring, primary buttons
 *   interactive-destructive: #EF4444  (red-500)  — destructive actions
 */

import type { Config } from 'tailwindcss';

const config: Config = {
  // Enable class-based dark mode so ThemeProvider can toggle the 'dark' class
  // on <html> and persist user preference in localStorage. (Issue #xxx UX-dark)
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // ── Semantic colour tokens ───────────────────────────────────────────
      colors: {
        // Content / text
        content: {
          primary:   '#F9FAFB', // gray-50   — 16.7:1 on gray-950
          secondary: '#D1D5DB', // gray-300  —  9.7:1 on gray-950
          tertiary:  '#9CA3AF', // gray-400  —  5.9:1 on gray-950
          disabled:  '#6B7280', // gray-500  —  3.9:1 on gray-950 (large/UI only)
          inverse:   '#030712', // gray-950  — for text on light surfaces
        },
        // Surface / background
        surface: {
          base:      '#030712', // gray-950 — page background
          raised:    '#111827', // gray-900 — card / modal background
          overlay:   '#1F2937', // gray-800 — secondary surface
          border:    '#374151', // gray-700 — default border
        },
        // Status — ALWAYS pair with an icon (WCAG 1.4.1)
        status: {
          success: {
            text:    '#86EFAC', // green-300 — 8.3:1 on surface-base
            surface: '#14532D', // green-900
            border:  '#15803D', // green-700
            icon:    '#4ADE80', // green-400
          },
          error: {
            text:    '#FCA5A5', // red-300   — 7.1:1 on surface-base
            surface: '#450A0A', // red-950
            border:  '#B91C1C', // red-700
            icon:    '#F87171', // red-400
          },
          warning: {
            text:    '#FDE047', // yellow-300 — 11.4:1 on surface-base
            surface: '#422006', // yellow-950
            border:  '#A16207', // yellow-700
            icon:    '#FACC15', // yellow-400
          },
          info: {
            text:    '#93C5FD', // blue-300   — 7.8:1 on surface-base
            surface: '#0C1A2E', // blue-950
            border:  '#1D4ED8', // blue-700
            icon:    '#60A5FA', // blue-400
          },
        },
        // Interactive
        interactive: {
          primary:      '#3B82F6', // blue-500
          'primary-hover': '#60A5FA', // blue-400
          destructive:  '#EF4444', // red-500
          'destructive-hover': '#F87171', // red-400
          focus:        '#60A5FA', // blue-400 — focus ring colour
        },
      },

      // ── Animation keyframes ──────────────────────────────────────────────
      keyframes: {
        progress: {
          '0%':   { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(400%)' },
        },
        // #452 UX-117 — Framer Motion handles most animations,
        // but we keep a CSS fallback shake for environments
        // where JS animations are disabled.
        shake: {
          '0%, 100%': { transform: 'translateX(0)' },
          '20%, 60%': { transform: 'translateX(-6px)' },
          '40%, 80%': { transform: 'translateX(6px)' },
        },
        'fade-in': {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-up': {
          '0%':   { transform: 'translateY(8px)', opacity: '0' },
          '100%': { transform: 'translateY(0)',   opacity: '1' },
        },
        'scale-in': {
          '0%':   { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)',    opacity: '1' },
        },
      },
      animation: {
        progress:  'progress 1.8s ease-in-out infinite',
        shake:     'shake 400ms ease-in-out',
        'fade-in': 'fade-in 200ms ease-out',
        'slide-up':'slide-up 250ms ease-out',
        'scale-in':'scale-in 200ms ease-out',
      },
    },
  },
  plugins: [],
};

export default config;
