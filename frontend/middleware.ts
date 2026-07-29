/**
 * middleware.ts — next-intl locale detection middleware (FE-35)
 *
 * Intercepts all requests and:
 *  1. Detects the user's preferred locale from the Accept-Language header.
 *  2. Redirects bare paths (e.g. /subscribe) to a locale-prefixed path
 *     (e.g. /en/subscribe) when locale routing is enabled.
 *
 * This uses next-intl's createMiddleware for idiomatic App Router integration.
 * The middleware only runs on non-static, non-API routes (see the matcher below).
 */

import createMiddleware from 'next-intl/middleware';
import { locales, defaultLocale } from './src/i18n';

export default createMiddleware({
  locales,
  defaultLocale,
  // Keep the default locale prefix off the URL (e.g. / instead of /en/)
  localePrefix: 'as-needed',
});

export const config = {
  // Match all routes except:
  //  - Next.js internals (_next/static, _next/image, etc.)
  //  - Public static assets with a file extension
  //  - API routes
  matcher: ['/((?!_next|api|.*\\..*).*)'],
};
