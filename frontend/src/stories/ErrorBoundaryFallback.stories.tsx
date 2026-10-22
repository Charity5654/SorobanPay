import type { Meta, StoryObj } from '@storybook/react';
import { ErrorBoundaryFallback } from '../components/ErrorBoundaryFallback';

/**
 * ErrorBoundaryFallback is the UI rendered by React Error Boundaries when
 * an unhandled JavaScript error is thrown anywhere in the component tree.
 *
 * It always includes a "Reload page" button and optionally a "Try again"
 * button when a `resetErrorBoundary` callback is provided (i.e., when the
 * error boundary supports recovery without a full reload).
 */
const meta: Meta<typeof ErrorBoundaryFallback> = {
  title: 'Components/ErrorBoundaryFallback',
  component: ErrorBoundaryFallback,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Fallback UI displayed when an unhandled React error occurs. ' +
          'Uses `role="alert"` and `aria-live="assertive"` so screen readers ' +
          'announce the error immediately. Provides a reset button when a ' +
          '`resetErrorBoundary` callback is available.',
      },
    },
  },
  argTypes: {
    heading: {
      control: 'text',
      description: 'Heading override — defaults to "Something went wrong"',
    },
    resetErrorBoundary: { action: 'reset clicked' },
  },
};

export default meta;
type Story = StoryObj<typeof ErrorBoundaryFallback>;

/**
 * Basic error boundary fallback with no error detail.
 * Shown when the error object is not available.
 */
export const Basic: Story = {
  args: {
    heading: 'Something went wrong',
  },
};

/**
 * With an Error object — shows the error message and a collapsible stack trace.
 * Useful for debugging during development.
 */
export const WithError: Story = {
  args: {
    heading: 'Something went wrong',
    error: new Error('Failed to submit transaction: RPC connection refused'),
  },
};

/**
 * With a reset callback — adds a "Try again" button that re-renders the
 * component tree without a full page reload.
 */
export const WithReset: Story = {
  args: {
    heading: 'Something went wrong',
    error: new Error('Unexpected wallet state: publicKey is null after connect()'),
  },
};

/**
 * Contract configuration error variant — used when the contract address
 * is missing or invalid on app startup.
 */
export const ContractConfigError: Story = {
  args: {
    heading: 'Contract not configured',
    error: new Error(
      'NEXT_PUBLIC_CONTRACT_ID is not set. Deploy the contract and update frontend/.env.local.',
    ),
  },
};
