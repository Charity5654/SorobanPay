"use client";

/**
 * LanguageSelector.tsx — locale switcher component (FE-35)
 *
 * Renders a native <select> that lets users switch between supported locales.
 * Uses useLocale from next-intl and Next.js router for locale-aware navigation.
 * Accessible: keyboard navigable, has an associated label.
 */

import { useLocale, useTranslations } from 'next-intl';
import { useRouter, usePathname } from 'next/navigation';
import { locales, type Locale } from '@/i18n';
import { useTransition } from 'react';

export function LanguageSelector() {
  const t = useTranslations('languageSelector');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as Locale;
    startTransition(() => {
      // Strip the current locale prefix (if present) from the pathname so we
      // can rebuild it with the new locale. next-intl middleware with
      // localePrefix: 'as-needed' only adds a prefix for non-default locales.
      const strippedPath = pathname.replace(/^\/(en|es)/, '') || '/';
      const nextPath =
        next === 'en' ? strippedPath : `/${next}${strippedPath}`;
      router.push(nextPath);
    });
  }

  return (
    <div className="inline-flex items-center gap-2">
      <label
        htmlFor="language-selector"
        className="text-xs text-gray-400 font-medium select-none"
      >
        {t('label')}
      </label>
      <select
        id="language-selector"
        value={locale}
        onChange={handleChange}
        disabled={isPending}
        aria-label={t('label')}
        className="rounded-lg bg-gray-800 border border-gray-700 px-3 py-1.5 text-xs
                   text-white cursor-pointer transition-colors
                   hover:bg-gray-700 focus:outline-none focus-visible:ring-2
                   focus-visible:ring-blue-400 disabled:opacity-50"
      >
        {locales.map((loc) => (
          <option key={loc} value={loc}>
            {t(loc)}
          </option>
        ))}
      </select>
    </div>
  );
}

export default LanguageSelector;
