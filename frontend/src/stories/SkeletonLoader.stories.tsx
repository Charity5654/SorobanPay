import type { Meta, StoryObj } from '@storybook/react';
import {
  SkeletonBlock,
  WalletBadgeSkeleton,
  SubscriptionFormSkeleton,
  PageSkeleton,
} from '../components/SkeletonLoader';

/**
 * Skeleton loading components provide placeholder UI while async data is being
 * fetched (e.g., contract config, network status). They use a CSS pulse animation
 * to signal that content is loading without showing a disruptive spinner.
 *
 * All skeleton components use `role="status"` and `aria-label` attributes so
 * screen readers announce the loading state.
 */
const meta: Meta = {
  title: 'Components/SkeletonLoader',
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Animated skeleton placeholders used during loading states. ' +
          'Built with accessible `role="status"` + `aria-label` attributes and ' +
          'a CSS `animate-pulse` class.',
      },
    },
  },
};

export default meta;

// ─── SkeletonBlock ────────────────────────────────────────────────────────────

/**
 * The primitive building block — a pulsing gray rectangle.
 * All other skeletons are composed from SkeletonBlock.
 */
export const Block: StoryObj<typeof SkeletonBlock> = {
  render: () => (
    <div className="flex flex-col gap-3 w-64">
      <SkeletonBlock className="h-4 w-full" aria-label="Loading text line" />
      <SkeletonBlock className="h-4 w-3/4" aria-label="Loading text line" />
      <SkeletonBlock className="h-4 w-1/2" aria-label="Loading text line" />
    </div>
  ),
};

// ─── WalletBadgeSkeleton ──────────────────────────────────────────────────────

/**
 * Skeleton placeholder for the WalletBadge component.
 * Shown while the app checks whether Freighter is installed.
 */
export const WalletBadgeLoading: StoryObj<typeof WalletBadgeSkeleton> = {
  render: () => <WalletBadgeSkeleton />,
  name: 'Wallet Badge Skeleton',
};

// ─── SubscriptionFormSkeleton ─────────────────────────────────────────────────

/**
 * Skeleton placeholder for the full SubscriptionForm.
 * Shown while the contract address or network configuration is being loaded.
 */
export const FormLoading: StoryObj<typeof SubscriptionFormSkeleton> = {
  render: () => <SubscriptionFormSkeleton />,
  name: 'Subscription Form Skeleton',
};

// ─── PageSkeleton ─────────────────────────────────────────────────────────────

/**
 * Full-page skeleton: header + wallet badge + subscription form.
 * Shown on initial app load before the first render.
 */
export const FullPageLoading: StoryObj<typeof PageSkeleton> = {
  render: () => <PageSkeleton />,
  name: 'Full Page Skeleton',
  parameters: {
    layout: 'fullscreen',
  },
};
