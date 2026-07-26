import createNextIntlPlugin from 'next-intl/plugin';

/**
 * next.config.mjs
 *
 * Wraps the base Next.js config with the next-intl plugin (FE-35).
 * The plugin wires up the i18n request config defined in src/i18n.ts.
 */

const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

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
};

export default withNextIntl(nextConfig);
