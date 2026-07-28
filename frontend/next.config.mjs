import createNextIntlPlugin from 'next-intl/plugin';
import { getSecurityHeaders } from './src/lib/security-headers.js';

/**
 * next.config.mjs
 *
 * Wraps the base Next.js config with the next-intl plugin (FE-35).
 * The plugin wires up the i18n request config defined in src/i18n.ts.
 *
 * Security headers (issue #380) are defined in src/lib/security-headers.ts
 * and applied to every route via the headers() function below.
 * That module is also imported by the Jest test suite for unit testing.
 *
 * See docs/security.md §5 for the full CSP policy rationale and the future
 * nonce-based upgrade path.
 */

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Enables standalone output for Docker deployments (#457)
  output: 'standalone',

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

export default withNextIntl(nextConfig);
