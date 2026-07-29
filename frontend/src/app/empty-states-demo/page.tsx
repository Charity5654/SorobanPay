'use client';

/**
 * empty-states-demo/page.tsx
 *
 * Demo page showcasing all 4 empty state components and the skeleton loader.
 * This demonstrates how to integrate EmptyState components in real pages
 * (dashboard, payment history, merchant portal, webhook list).
 *
 * Once those pages exist, import the relevant component and conditionally
 * render:
 *   {isLoading && <SkeletonList rows={3} />}
 *   {!isLoading && data.length === 0 && <EmptySubscriptions onCreate={...} />}
 *   {!isLoading && data.length > 0 && <ActualList data={data} />}
 *
 * Issue: #453 UX-118
 */

import { useState } from 'react';
import {
  EmptySubscriptions,
  EmptyPaymentHistory,
  EmptyMerchantSubscribers,
  EmptyWebhookList,
  SkeletonList,
} from '@/components/EmptyState';

export default function EmptyStatesDemo() {
  const [section, setSection] = useState<'dashboard' | 'history' | 'merchant' | 'webhooks' | 'skeleton'>('dashboard');

  const handleDummyAction = (action: string) => {
    alert(`Demo: ${action} clicked`);
  };

  return (
    <main className="min-h-screen flex flex-col items-center px-4 py-12 bg-surface-base text-content-primary">
      <div className="w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-extrabold mb-2">Empty State Components</h1>
          <p className="text-content-secondary text-sm">
            Preview all empty state variants. Click the tabs below to switch between them.
          </p>
        </div>

        {/* Tab navigation */}
        <div className="flex flex-wrap gap-2 mb-8 justify-center">
          {[
            { key: 'dashboard', label: 'Dashboard' },
            { key: 'history', label: 'Payment History' },
            { key: 'merchant', label: 'Merchant Portal' },
            { key: 'webhooks', label: 'Webhooks' },
            { key: 'skeleton', label: 'Loading Skeleton' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setSection(tab.key as typeof section)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors duration-150
                         focus:outline-none focus-visible:ring-2 focus-visible:ring-interactive-focus
                         focus-visible:ring-offset-2 focus-visible:ring-offset-surface-base
                         ${
                           section === tab.key
                             ? 'bg-interactive-primary text-white'
                             : 'bg-surface-overlay text-content-secondary hover:text-content-primary hover:bg-surface-border'
                         }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Demo container */}
        <div className="rounded-2xl border border-surface-border bg-surface-raised p-8 shadow-lg min-h-[400px] flex items-center justify-center">
          {section === 'dashboard' && (
            <EmptySubscriptions
              onCreate={() => handleDummyAction('Create Subscription')}
              onBrowse={() => handleDummyAction('Browse Services')}
            />
          )}
          {section === 'history' && (
            <EmptyPaymentHistory
              onCreateSubscription={() => handleDummyAction('Create Subscription')}
            />
          )}
          {section === 'merchant' && (
            <EmptyMerchantSubscribers
              onShareLink={() => handleDummyAction('Share Payment Link')}
              onViewQR={() => handleDummyAction('Show QR Code')}
            />
          )}
          {section === 'webhooks' && (
            <EmptyWebhookList
              onAddWebhook={() => handleDummyAction('Add Webhook')}
            />
          )}
          {section === 'skeleton' && (
            <div className="w-full max-w-md">
              <SkeletonList rows={4} />
            </div>
          )}
        </div>

        {/* Integration guide */}
        <div className="mt-8 p-6 rounded-lg bg-surface-overlay border border-surface-border">
          <h2 className="text-lg font-bold mb-3">Integration Guide</h2>
          <p className="text-sm text-content-secondary leading-relaxed mb-4">
            To integrate these components into real pages, conditionally render based on loading
            and data state:
          </p>
          <pre className="bg-gray-800 rounded-lg p-4 text-xs overflow-x-auto border border-gray-700 text-gray-300">
{`import {
  EmptySubscriptions,
  SkeletonList,
} from '@/components/EmptyState';

function DashboardPage() {
  const { data, isLoading } = useSubscriptions();

  if (isLoading) return <SkeletonList rows={3} />;
  if (data.length === 0) {
    return (
      <EmptySubscriptions
        onCreate={() => router.push('/subscribe')}
        onBrowse={() => router.push('/browse')}
      />
    );
  }
  return <SubscriptionList items={data} />;
}`}
          </pre>
        </div>
      </div>
    </main>
  );
}
