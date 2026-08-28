import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { WalletProvider } from '@/context/WalletContext';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { LanguageSelector } from '@/components/LanguageSelector';
import { HelpButton } from '@/components/help/HelpButton';
import './globals.css';

export const metadata: Metadata = {
  title: 'SorobanPay — Decentralized Recurring Payments',
  description:
    'Non-custodial subscription and recurring payment protocol built on Stellar Soroban.',
};

/**
 * RootLayout
 *
 * - FE-38: Top-level ErrorBoundary prevents blank-screen crashes.
 * - FE-35: NextIntlClientProvider supplies translated messages to all client
 *          components. getMessages() reads the locale resolved by middleware.
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
              {/* Language switcher — fixed to top-right corner */}
              <div className="fixed top-4 right-4 z-50">
                <LanguageSelector />
              </div>
              {children}
              {/* Issue #745: Global floating help button */}
              <HelpButton currentPage="global" />
            </WalletProvider>
          </NextIntlClientProvider>
        </ErrorBoundary>
      </body>
    </html>
  );
}
