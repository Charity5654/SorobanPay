import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { WalletProvider } from '@/context/WalletContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LanguageSelector } from '@/components/LanguageSelector';
import { OfflineBanner } from '@/components/OfflineBanner';
import { InstallPrompt } from '@/components/InstallPrompt';
import './globals.css';

/**
 * PWA metadata — manifest, theme colour, mobile web-app settings.
 * Apple-specific tags (apple-touch-icon, apple-mobile-web-app-*) are added
 * via the icons/other fields so Next.js renders the correct <link>/<meta> tags.
 */
export const metadata: Metadata = {
  title: 'SorobanPay — Decentralized Recurring Payments',
  description:
    'Non-custodial subscription and recurring payment protocol built on Stellar Soroban.',
  manifest: '/manifest.json',
  applicationName: 'SorobanPay',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'SorobanPay',
  },
  formatDetection: {
    telephone: false,
  },
  icons: {
    icon: [
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
      { url: '/icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
    ],
    apple: [
      { url: '/icons/icon-152x152.png', sizes: '152x152', type: 'image/png' },
      { url: '/icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
    ],
  },
};

export const viewport: Viewport = {
  themeColor: '#030712',
  width: 'device-width',
  initialScale: 1,
  minimumScale: 1,
};

/**
 * RootLayout
 *
 * - FE-38: Top-level ErrorBoundary prevents blank-screen crashes.
 * - FE-35: NextIntlClientProvider supplies translated messages to all client
 *          components. getMessages() reads the locale resolved by middleware.
 * - PWA: Manifest and meta tags wired up via metadata export above.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  // Load messages for the current locale (resolved by next-intl middleware)
  const messages = await getMessages();

  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-950 text-white antialiased">
        {/*
         * Top-level ErrorBoundary (FE-38)
         * Prevents a full blank-screen crash on any unhandled render error.
         */}
        <ErrorBoundary name="RootLayout">
          <NextIntlClientProvider messages={messages}>
            <WalletProvider>
              {/* Offline connectivity banner (PWA) */}
              <OfflineBanner />
              {/* A2HS install prompt — shown after 2 visits */}
              <InstallPrompt />
              {/* Language switcher — fixed to top-right corner */}
              <div className="fixed top-4 right-4 z-50">
                <LanguageSelector />
              </div>
              {children}
            </WalletProvider>
          </NextIntlClientProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
