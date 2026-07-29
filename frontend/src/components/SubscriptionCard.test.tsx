/**
 * SubscriptionCard.test.tsx
 *
 * Unit tests for the SubscriptionCard component.
 * Covers: rendering, cancel confirmation dialog, optimistic UI, error state,
 * and overdue payment indication.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import SubscriptionCard from '@/components/SubscriptionCard';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'C' + 'A'.repeat(55),
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  NETWORK_NAME: 'Testnet',
}));

const mockBuildAndSubmitCancel = jest.fn();
jest.mock('@/lib/cancel_builder', () => ({
  buildAndSubmitCancel: (...args: unknown[]) => mockBuildAndSubmitCancel(...args),
}));

// ── Test data ──────────────────────────────────────────────────────────────

const SUBSCRIBER = 'G' + 'A'.repeat(55);
const MERCHANT   = 'G' + 'B'.repeat(55);
const TOKEN      = 'C' + 'A'.repeat(55);
const AMOUNT     = 10_000_000n; // 1.0000000 tokens
const INTERVAL   = 2_592_000;  // 30 days
// Unix timestamp ~30 days in the future
const NEXT_PAYMENT = Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
const SUB_KEY    = `${SUBSCRIBER}:${MERCHANT}`;

function makeProps(overrides: Partial<React.ComponentProps<typeof SubscriptionCard>> = {}) {
  return {
    subscriber: SUBSCRIBER,
    merchant: MERCHANT,
    token: TOKEN,
    amount: AMOUNT,
    interval: INTERVAL,
    nextPayment: NEXT_PAYMENT,
    subscriptionKey: SUB_KEY,
    isCancelling: false,
    cancelledAt: null,
    onCancelled: jest.fn(),
    onCancelStateChange: jest.fn(),
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SubscriptionCard – rendering', () => {
  beforeEach(() => {
    mockBuildAndSubmitCancel.mockReset();
  });

  it('renders Active badge', () => {
    render(<SubscriptionCard {...makeProps()} />);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders truncated merchant address', () => {
    render(<SubscriptionCard {...makeProps()} />);
    // Merchant is truncated: first 8 + last 8 chars
    expect(screen.getByText(/GBBBBBBB/)).toBeInTheDocument();
  });

  it('renders truncated token address', () => {
    render(<SubscriptionCard {...makeProps()} />);
    expect(screen.getByText(/CAAAAAA/)).toBeInTheDocument();
  });

  it('renders the amount in token units', () => {
    render(<SubscriptionCard {...makeProps()} />);
    // 10_000_000 stroops = 1.0000000
    expect(screen.getByText('1.0000000')).toBeInTheDocument();
  });

  it('renders the interval as "Every 30 days"', () => {
    render(<SubscriptionCard {...makeProps()} />);
    expect(screen.getByText('Every 30 days')).toBeInTheDocument();
  });

  it('renders the Cancel Subscription button', () => {
    render(<SubscriptionCard {...makeProps()} />);
    expect(
      screen.getByRole('button', { name: /cancel subscription/i }),
    ).toBeInTheDocument();
  });

  it('Cancel button is enabled when not cancelling', () => {
    render(<SubscriptionCard {...makeProps({ isCancelling: false })} />);
    expect(
      screen.getByRole('button', { name: /cancel subscription/i }),
    ).not.toBeDisabled();
  });

  it('Cancel button is disabled when isCancelling', () => {
    render(<SubscriptionCard {...makeProps({ isCancelling: true })} />);
    const btn = screen.getByRole('button', { name: /cancelling/i });
    expect(btn).toBeDisabled();
  });

  it('shows overdue indicator when nextPayment is in the past', () => {
    const pastTimestamp = Math.floor(Date.now() / 1000) - 100;
    render(<SubscriptionCard {...makeProps({ nextPayment: pastTimestamp })} />);
    expect(screen.getByText(/overdue/i)).toBeInTheDocument();
  });

  it('does not show overdue indicator for future payment', () => {
    render(<SubscriptionCard {...makeProps()} />);
    expect(screen.queryByText(/overdue/i)).not.toBeInTheDocument();
  });
});

describe('SubscriptionCard – cancel confirmation dialog', () => {
  beforeEach(() => {
    mockBuildAndSubmitCancel.mockReset();
  });

  it('opens confirmation dialog when Cancel button is clicked', () => {
    render(<SubscriptionCard {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText(/cancel subscription\?/i)).toBeInTheDocument();
  });

  it('dialog shows the merchant address', () => {
    render(<SubscriptionCard {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }));
    // Truncated merchant should appear in dialog
    expect(screen.getByLabelText(new RegExp(`Merchant: ${MERCHANT}`))).toBeInTheDocument();
  });

  it('"Keep subscription" button closes the dialog', () => {
    render(<SubscriptionCard {...makeProps()} />);
    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /keep subscription/i }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('confirming cancel calls onCancelStateChange(key, true)', async () => {
    mockBuildAndSubmitCancel.mockResolvedValue({ txHash: 'abc123' });
    const onCancelled = jest.fn();
    const onCancelStateChange = jest.fn();
    render(
      <SubscriptionCard
        {...makeProps({ onCancelled, onCancelStateChange })}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel it/i }));

    await waitFor(() => expect(onCancelStateChange).toHaveBeenCalledWith(SUB_KEY, true));
  });

  it('confirming cancel calls onCancelled(key) on success', async () => {
    mockBuildAndSubmitCancel.mockResolvedValue({ txHash: 'abc123' });
    const onCancelled = jest.fn();
    render(
      <SubscriptionCard {...makeProps({ onCancelled })} />,
    );

    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel it/i }));

    await waitFor(() => expect(onCancelled).toHaveBeenCalledWith(SUB_KEY));
  });

  it('shows error message when cancel tx fails', async () => {
    mockBuildAndSubmitCancel.mockRejectedValue(new Error('Transaction failed: insufficient fee'));
    render(<SubscriptionCard {...makeProps()} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel it/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Transaction failed: insufficient fee/),
    );
  });

  it('calls onCancelStateChange(key, false) after cancel failure', async () => {
    mockBuildAndSubmitCancel.mockRejectedValue(new Error('RPC error'));
    const onCancelStateChange = jest.fn();
    render(<SubscriptionCard {...makeProps({ onCancelStateChange })} />);

    fireEvent.click(screen.getByRole('button', { name: /cancel subscription/i }));
    fireEvent.click(screen.getByRole('button', { name: /yes, cancel it/i }));

    await waitFor(() =>
      expect(onCancelStateChange).toHaveBeenLastCalledWith(SUB_KEY, false),
    );
  });
});

describe('SubscriptionCard – optimistic cancel state', () => {
  it('renders a muted "Cancelled" state when cancelledAt is set', () => {
    render(
      <SubscriptionCard
        {...makeProps({ cancelledAt: new Date() })}
      />,
    );
    expect(screen.getByText(/cancelled/i)).toBeInTheDocument();
    // The active badge and cancel button should not be present
    expect(screen.queryByText('Active')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /cancel subscription/i }),
    ).not.toBeInTheDocument();
  });

  it('cancelled card has aria-label indicating cancelled state', () => {
    render(
      <SubscriptionCard
        {...makeProps({ cancelledAt: new Date() })}
      />,
    );
    expect(
      screen.getByRole('article', { name: /cancelled subscription/i }),
    ).toBeInTheDocument();
  });
});
