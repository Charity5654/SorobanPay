'use client';

/**
 * /merchant — Merchant Portal
 *
 * Tabbed portal for merchants:
 *   - Overview tab: subscription list + revenue summary
 *   - Analytics tab (/merchant?tab=analytics): FE-50 analytics dashboard
 *
 * FE-50: Add analytics dashboard with charts for merchant revenue.
 */

import { useState, useEffect } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import AnalyticsDashboard from '@/components/AnalyticsDashboard';
import { useWallet } from '@/hooks/useWallet';

type Tab = 'overview' | 'analytics';

const TABS: { id: Tab; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '🏪' },
  { id: 'analytics', label: 'Analytics', icon: '📊' },
];

// ─── Overview tab (placeholder, existing functionality) ───────────────────────

function OverviewTab({ merchantAddress }: { merchantAddress: string | null }) {
  if (!merchantAddress) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center space-y-3">
        <span className="text-4xl" aria-hidden="true">🔒</span>
        <p className="text-gray-300 font-semibold text-sm">
          Connect your wallet to access the merchant portal
        </p>
        <p className="text-gray-500 text-xs max-w-xs">
          The merchant portal lets you view active subscriptions and trigger
          payment collection.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
        <h2 className="text-sm font-semibold text-white mb-1">
          Merchant Address
        </h2>
        <code className="text-xs text-indigo-300 break-all">{merchantAddress}</code>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-5 text-center space-y-2">
        <p className="text-2xl" aria-hidden="true">📋</p>
        <p className="text-gray-300 font-semibold text-sm">Active Subscriptions</p>
        <p className="text-gray-500 text-xs">
          Use the{' '}
          <code className="bg-gray-800 px-1 rounded text-gray-400 text-xs">
            execute_payment
          </code>{' '}
          entry point to collect due payments from subscribers.
        </p>
        <a
          href="/"
          className="inline-block mt-2 px-4 py-2 rounded-lg bg-indigo-600 text-white text-xs font-medium hover:bg-indigo-500 transition-colors"
        >
          Go to Subscription Form
        </a>
      </div>
    </div>
  );
}

// ─── Merchant Portal Page ─────────────────────────────────────────────────────

export default function MerchantPortalPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { publicKey, mounted } = useWallet();

  const initialTab = (searchParams.get('tab') as Tab) ?? 'overview';
  const [activeTab, setActiveTab] = useState<Tab>(
    TABS.some((t) => t.id === initialTab) ? initialTab : 'overview',
  );

  // Sync tab to URL
  function selectTab(tab: Tab) {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.replace(`/merchant?${params.toString()}`, { scroll: false });
  }

  // Update tab if URL changes externally
  useEffect(() => {
    const tabParam = searchParams.get('tab') as Tab;
    if (tabParam && TABS.some((t) => t.id === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [searchParams]);

  return (
    <>
      <head>
        <title>Merchant Portal — SorobanPay</title>
        <meta
          name="description"
          content="Merchant portal for SorobanPay — manage subscriptions and view revenue analytics."
        />
      </head>

      <main className="min-h-screen flex flex-col items-center px-4 py-10 bg-slate-950">
        {/* Header */}
        <div className="w-full max-w-2xl mb-8">
          <div className="flex items-center gap-3 mb-1">
            <a
              href="/"
              className="text-xs text-gray-500 hover:text-gray-300 transition-colors"
              aria-label="Back to home"
            >
              ← Home
            </a>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Merchant Portal
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            Manage subscriptions and view revenue analytics
          </p>
        </div>

        {/* Tab navigation */}
        <div className="w-full max-w-2xl mb-6">
          <nav
            role="tablist"
            aria-label="Merchant portal sections"
            className="flex gap-1 bg-slate-900 border border-slate-700 rounded-2xl p-1.5"
          >
            {TABS.map((tab) => (
              <button
                key={tab.id}
                role="tab"
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                id={`tab-${tab.id}`}
                type="button"
                onClick={() => selectTab(tab.id)}
                className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  activeTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-900/40'
                    : 'text-gray-400 hover:text-white hover:bg-slate-800'
                }`}
              >
                <span aria-hidden="true">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </nav>
        </div>

        {/* Tab panels */}
        <div className="w-full max-w-2xl">
          {mounted ? (
            <>
              <div
                id="panel-overview"
                role="tabpanel"
                aria-labelledby="tab-overview"
                hidden={activeTab !== 'overview'}
              >
                <OverviewTab merchantAddress={publicKey} />
              </div>

              <div
                id="panel-analytics"
                role="tabpanel"
                aria-labelledby="tab-analytics"
                hidden={activeTab !== 'analytics'}
              >
                <AnalyticsDashboard merchantAddress={publicKey} />
              </div>
            </>
          ) : (
            // SSR skeleton
            <div className="space-y-4">
              {[140, 160, 160].map((h, i) => (
                <div
                  key={i}
                  className="animate-pulse rounded-2xl bg-slate-800/60 w-full"
                  style={{ height: h }}
                />
              ))}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
