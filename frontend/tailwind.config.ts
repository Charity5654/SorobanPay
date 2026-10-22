/**
 * tailwind.config.ts
 *
 * Semantic colors resolve from CSS variables in globals.css so text and
 * controls keep their contrast in both light and dark themes. WCAG AA text
 * pairs and focus/control boundaries are covered by theme-tokens.test.ts.
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
          primary:   'rgb(var(--content-primary) / <alpha-value>)',
          secondary: 'rgb(var(--content-secondary) / <alpha-value>)',
          tertiary:  'rgb(var(--content-tertiary) / <alpha-value>)',
          disabled:  'rgb(var(--content-disabled) / <alpha-value>)',
          inverse:   'rgb(var(--content-inverse) / <alpha-value>)',
        },
        // Surface / background
        surface: {
          base:      'rgb(var(--surface-base) / <alpha-value>)',
          raised:    'rgb(var(--surface-raised) / <alpha-value>)',
          overlay:   'rgb(var(--surface-overlay) / <alpha-value>)',
          border:    'rgb(var(--surface-border) / <alpha-value>)',
        },
        // Status — ALWAYS pair with an icon (WCAG 1.4.1)
        status: {
          success: {
            text:    'rgb(var(--status-success-text) / <alpha-value>)',
            surface: 'rgb(var(--status-success-surface) / <alpha-value>)',
            border:  'rgb(var(--status-success-border) / <alpha-value>)',
            icon:    'rgb(var(--status-success-icon) / <alpha-value>)',
          },
          error: {
            text:    'rgb(var(--status-error-text) / <alpha-value>)',
            surface: 'rgb(var(--status-error-surface) / <alpha-value>)',
            border:  'rgb(var(--status-error-border) / <alpha-value>)',
            icon:    'rgb(var(--status-error-icon) / <alpha-value>)',
          },
          warning: {
            text:    'rgb(var(--status-warning-text) / <alpha-value>)',
            surface: 'rgb(var(--status-warning-surface) / <alpha-value>)',
            border:  'rgb(var(--status-warning-border) / <alpha-value>)',
            icon:    'rgb(var(--status-warning-icon) / <alpha-value>)',
          },
          info: {
            text:    'rgb(var(--status-info-text) / <alpha-value>)',
            surface: 'rgb(var(--status-info-surface) / <alpha-value>)',
            border:  'rgb(var(--status-info-border) / <alpha-value>)',
            icon:    'rgb(var(--status-info-icon) / <alpha-value>)',
          },
        },
        // Interactive
        interactive: {
          primary:      'rgb(var(--interactive-primary) / <alpha-value>)',
          'primary-hover': 'rgb(var(--interactive-primary-hover) / <alpha-value>)',
          destructive:  'rgb(var(--interactive-destructive) / <alpha-value>)',
          'destructive-hover': 'rgb(var(--interactive-destructive-hover) / <alpha-value>)',
          focus:        'rgb(var(--interactive-focus) / <alpha-value>)',
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
