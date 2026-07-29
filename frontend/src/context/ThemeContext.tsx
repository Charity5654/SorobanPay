'use client';

/**
 * ThemeContext.tsx
 *
 * Provides dark / light theme toggling with:
 *  - System preference detection via window.matchMedia('(prefers-color-scheme: dark)')
 *  - User preference persistence in localStorage (key: 'sorobanpay-theme')
 *  - No flash of unstyled content (FOUC) — the <ThemeScript> component injects
 *    a blocking <script> into <head> that sets the 'dark' class on <html>
 *    before the page paints.
 *
 * Usage:
 *   // In layout.tsx:
 *   <ThemeScript />               ← inject into <head> before body
 *   <ThemeProvider>…</ThemeProvider>   ← wrap body children
 *
 *   // In any component:
 *   const { theme, setTheme, toggleTheme } = useTheme();
 */

import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from 'react';

// ─── Types ─────────────────────────────────────────────────────────────────────

export type Theme = 'dark' | 'light';

interface ThemeContextValue {
  /** Current active theme */
  theme: Theme;
  /** Explicitly set a theme */
  setTheme: (theme: Theme) => void;
  /** Toggle between dark and light */
  toggleTheme: () => void;
}

// ─── Storage key ──────────────────────────────────────────────────────────────

const STORAGE_KEY = 'sorobanpay-theme';

// ─── Context ──────────────────────────────────────────────────────────────────

const ThemeContext = createContext<ThemeContextValue | null>(null);

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within a ThemeProvider');
  }
  return ctx;
}

// ─── Provider ─────────────────────────────────────────────────────────────────

/**
 * ThemeProvider
 *
 * Reads the initial theme from localStorage (set by ThemeScript before paint),
 * then keeps the 'dark' class on <html> in sync with React state.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  // Initialise from whatever ThemeScript already applied to <html>, falling
  // back to system preference. This prevents a flicker on first render.
  const [theme, setThemeState] = useState<Theme>(() => {
    // During SSR there is no window — default to dark (matches ThemeScript logic).
    if (typeof window === 'undefined') return 'dark';
    const stored = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (stored === 'dark' || stored === 'light') return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  });

  // Keep <html> class and localStorage in sync whenever theme changes.
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') {
      root.classList.add('dark');
    } else {
      root.classList.remove('dark');
    }
    localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  // Listen for OS-level preference changes; only apply if user has no saved pref.
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    function handleChange(e: MediaQueryListEvent) {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) {
        setThemeState(e.matches ? 'dark' : 'light');
      }
    }
    mq.addEventListener('change', handleChange);
    return () => mq.removeEventListener('change', handleChange);
  }, []);

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

// ─── FOUC-prevention script ────────────────────────────────────────────────────

/**
 * ThemeScript
 *
 * Renders a blocking <script> that must be placed inside <head> (before <body>)
 * so the browser sets the correct theme class on <html> before the first paint.
 * Without this the page would flash with the wrong theme on load.
 *
 * The script is intentionally tiny and has no external dependencies.
 * dangerouslySetInnerHTML is safe here because the string is a static literal
 * with no user input.
 */
export function ThemeScript() {
  const script = `
(function(){
  var k='${STORAGE_KEY}';
  var stored=null;
  try{stored=localStorage.getItem(k);}catch(e){}
  var prefersDark=window.matchMedia('(prefers-color-scheme:dark)').matches;
  var isDark=stored==='dark'||(stored===null&&prefersDark);
  if(isDark){document.documentElement.classList.add('dark');}
})();
`.trim();

  return (
    <script
      dangerouslySetInnerHTML={{ __html: script }}
      // Suppress React hydration warning — script runs before hydration and
      // the content is a constant so it will always match server/client.
      suppressHydrationWarning
    />
  );
}
