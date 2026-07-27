import { getRequestConfig } from 'next-intl/server';
import { notFound } from 'next/navigation';

/**
 * i18n.ts — next-intl server-side configuration (FE-35)
 *
 * Defines supported locales and loads per-request message files.
 * Uses Accept-Language header detection via next-intl middleware.
 */

export const locales = ['en', 'es'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'en';

export default getRequestConfig(async ({ locale }) => {
  // Validate that the locale is supported; 404 otherwise
  if (!locales.includes(locale as Locale)) notFound();

  return {
    messages: (
      await import(`../messages/${locale}.json`)
    ).default,
  };
});
