import createNextIntlPlugin from 'next-intl/plugin';
import { getSecurityHeaders } from './src/lib/security-headers.js';
import withPWAInit from 'next-pwa';

/**
 * next.config.mjs
 *
 * Wraps the base Next.js config with:
 *  1. next-intl plugin (FE-35) — wires up i18n request config from src/i18n.ts.
 *  2. next-pwa — generates a Workbox service worker for:
 *       - App shell caching (layout, fonts, static assets)
 *       - Offline fallback
 *       - PWA installation (A2HS)
 *
 * Security headers (issue #380) are defined in src/lib/security-headers.ts
 * and applied to every route via the headers() function below.
 *
 * Service worker is disabled in development mode to avoid caching stale
 * assets during development. Freighter signing works in both modes because
 * the service worker uses a network-first strategy for all navigation requests
 * and passes through browser extension API calls without interception.
 *
 * See docs/security.md §5 for the full CSP policy rationale.
 */

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

const withPWA = withPWAInit({
  dest: 'public',
  // Disable service worker registration in development mode
  disable: process.env.NODE_ENV === 'development',
  // Register the service worker automatically
  register: true,
  // Skip waiting — activate new service worker immediately on update
  skipWaiting: true,
  // Runtime caching configuration
  runtimeCaching: [
    // ── Navigation (app shell) — network first, fall back to cache ────────
    // Uses NetworkFirst so Freighter signing popups work correctly; the browser
    // extension API calls are never intercepted by the service worker.
    {
      urlPattern: /^https?:\/\/[^/]+\/($|\?)/,
      handler: 'NetworkFirst',
      options: {
        cacheName: 'app-shell',
        expiration: { maxEntries: 10, maxAgeSeconds: 24 * 60 * 60 }, // 1 day
        networkTimeoutSeconds: 10,
      },
    },
    // ── Static assets (JS, CSS, fonts) — stale while revalidate ──────────
    {
      urlPattern: /\/_next\/static\/.*/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'next-static',
        expiration: { maxEntries: 200, maxAgeSeconds: 30 * 24 * 60 * 60 }, // 30 days
      },
    },
    // ── Next.js image optimisation — stale while revalidate ───────────────
    {
      urlPattern: /\/_next\/image\?.*/,
      handler: 'StaleWhileRevalidate',
      options: {
        cacheName: 'next-image',
        expiration: { maxEntries: 64, maxAgeSeconds: 24 * 60 * 60 },
      },
    },
    // ── Public icons and manifest ─────────────────────────────────────────
    {
      urlPattern: /\/icons\/.*/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'icons',
        expiration: { maxEntries: 20, maxAgeSeconds: 30 * 24 * 60 * 60 },
      },
    },
    // ── Google Fonts ──────────────────────────────────────────────────────
    {
      urlPattern: /^https:\/\/fonts\.(?:googleapis|gstatic)\.com\/.*/,
      handler: 'CacheFirst',
      options: {
        cacheName: 'google-fonts',
        expiration: { maxEntries: 10, maxAgeSeconds: 365 * 24 * 60 * 60 },
      },
    },
  ],
  // ── Freighter compatibility ────────────────────────────────────────────────
  // Exclude Freighter extension API calls from service worker interception.
  // Freighter injects its API through a browser extension context; service
  // workers cannot intercept chrome-extension:// or moz-extension:// URLs,
  // so signing requests are never affected. The exclusion below is a belt-
  // and-braces measure for any Stellar RPC calls made during signing.
  exclude: [
    // Exclude Stellar RPC endpoints from caching (always fetch live data)
    ({ request }) =>
      request.url.includes('soroban-testnet.stellar.org') ||
      request.url.includes('mainnet.stellar.validationcloud.io'),
  ],
  // Offline fallback page
  fallbacks: {
    document: '/offline',
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Suppress Stellar SDK build warnings in Next.js
  webpack: (config) => {
    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      net: false,
      tls: false,
    };
    return config;
  },

  async headers() {
    return [
      {
        // Apply to every route, including API routes and static assets.
        source: '/(.*)',
        headers: getSecurityHeaders(),
      },
    ];
  },
};

export default withPWA(withNextIntl(nextConfig));
