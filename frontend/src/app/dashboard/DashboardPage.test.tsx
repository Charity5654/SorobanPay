/**
 * DashboardPage.test.tsx
 *
 * Unit tests for the /dashboard page component.
 * Covers: wallet not connected state, loading state, error state, empty state,
 * and subscription list rendering.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DashboardPage from '@/app/dashboard/page';
import type { UseSubscriptionsInternalReturn } from '@/hooks/useSubscriptions';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'C' + 'A'.repeat(55),
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  NETWORK_NAME: 'Testnet',
}));

// Mock next/link
jest.mock('next/link', () => {
  const Link = ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  );
  Link.displayName = 'Link';
  return Link;
});

// Mock cancel builder (not invoked from page directly, but needed for SubscriptionCard)
jest.mock('@/lib/cancel_builder', () => ({
  buildAndSubmitCancel: jest.fn(),
}));

// Wallet mock factory
const mockWallet = {
  publicKey: null as string | null,
  isConnecting: false,
  connectError: null as string | null,
  freighterInstalled: true,
  isCheckingFreighter: false,
  connect: jest.fn(),
  disconnect: jest.fn(),
};

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => mockWallet,
}));

// Subscriptions hook mock factory
const mockSubscriptions: UseSubscriptionsInternalReturn = {
  subscriptions: [],
  isLoading: false,
  error: null,
  refetch: jest.fn(),
  _updateSubscription: jest.fn(),
};

jest.mock('@/hooks/useSubscriptions', () => ({
  useSubscriptions: () => mockSubscriptions,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

const SUBSCRIBER = 'G' + 'A'.repeat(55);
const MERCHANT   = 'G' + 'B'.repeat(55);
const TOKEN      = 'C' + 'A'.repeat(55);

function makeSub(overrides = {}) {
  return {
    merchant: MERCHANT,
    token: TOKEN,
    amount: 10_000_000n,
    interval: 2_592_000,
    nextPayment: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    key: `${SUBSCRIBER}:${MERCHANT}`,
    isCancelling: false,
    cancelledAt: null,
    ...overrides,
  };
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('DashboardPage – wallet not connected', () => {
  beforeEach(() => {
    mockWallet.publicKey = null;
    mockSubscriptions.subscriptions = [];
    mockSubscriptions.isLoading = false;
    mockSubscriptions.error = null;
  });

  it('renders the page heading', () => {
    render(<DashboardPage />);
    expect(screen.getByRole('heading', { name: /my subscriptions/i })).toBeInTheDocument();
  });

  it('renders Connect Freighter Wallet button', () => {
    render(<DashboardPage />);
    expect(
      screen.getByRole('button', { name: /connect freighter wallet/i }),
    ).toBeInTheDocument();
  });

  it('shows Freighter install prompt when not installed', () => {
    mockWallet.freighterInstalled = false;
    render(<DashboardPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/freighter is not installed/i);
    mockWallet.freighterInstalled = true;
  });

  it('shows connect error when present', () => {
    mockWallet.connectError = 'Access was denied';
    render(<DashboardPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/access was denied/i);
    mockWallet.connectError = null;
  });

  it('Back to home link is present', () => {
    render(<DashboardPage />);
    expect(screen.getByRole('link', { name: /back to home/i })).toHaveAttribute('href', '/');
  });
});

describe('DashboardPage – loading state', () => {
  beforeEach(() => {
    mockWallet.publicKey = SUBSCRIBER;
    mockSubscriptions.isLoading = true;
    mockSubscriptions.subscriptions = [];
    mockSubscriptions.error = null;
  });

  afterEach(() => {
    mockSubscriptions.isLoading = false;
  });

  it('shows a loading skeleton', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('dashboard-loading')).toBeInTheDocument();
  });

  it('loading skeleton has aria-busy', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('dashboard-loading')).toHaveAttribute('aria-busy', 'true');
  });
});

describe('DashboardPage – error state', () => {
  beforeEach(() => {
    mockWallet.publicKey = SUBSCRIBER;
    mockSubscriptions.isLoading = false;
    mockSubscriptions.error = 'RPC connection refused';
    mockSubscriptions.subscriptions = [];
  });

  afterEach(() => {
    mockSubscriptions.error = null;
  });

  it('renders error message', () => {
    render(<DashboardPage />);
    expect(screen.getByRole('alert')).toHaveTextContent(/RPC connection refused/);
  });

  it('renders Try again button', () => {
    render(<DashboardPage />);
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('clicking Try again calls refetch', () => {
    const refetch = jest.fn();
    mockSubscriptions.refetch = refetch;
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    mockSubscriptions.refetch = jest.fn();
  });
});

describe('DashboardPage – empty state', () => {
  beforeEach(() => {
    mockWallet.publicKey = SUBSCRIBER;
    mockSubscriptions.isLoading = false;
    mockSubscriptions.error = null;
    mockSubscriptions.subscriptions = [];
  });

  it('renders the empty state component', () => {
    render(<DashboardPage />);
    expect(screen.getByTestId('dashboard-empty-state')).toBeInTheDocument();
  });

  it('shows connected wallet address', () => {
    render(<DashboardPage />);
    // Short form of SUBSCRIBER: first 6 + last 4
    expect(screen.getByText(`${SUBSCRIBER.slice(0, 6)}…${SUBSCRIBER.slice(-4)}`)).toBeInTheDocument();
  });
});

describe('DashboardPage – subscriptions list', () => {
  beforeEach(() => {
    mockWallet.publicKey = SUBSCRIBER;
    mockSubscriptions.isLoading = false;
    mockSubscriptions.error = null;
    mockSubscriptions.subscriptions = [makeSub()];
  });

  afterEach(() => {
    mockSubscriptions.subscriptions = [];
  });

  it('renders the subscription count', () => {
    render(<DashboardPage />);
    expect(screen.getByText(/1 subscription/)).toBeInTheDocument();
  });

  it('renders a SubscriptionCard for the subscription', () => {
    render(<DashboardPage />);
    // Active badge from SubscriptionCard
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('uses plural "subscriptions" for 2+ items', () => {
    mockSubscriptions.subscriptions = [
      makeSub({ key: `${SUBSCRIBER}:${MERCHANT}` }),
      makeSub({ merchant: 'G' + 'C'.repeat(55), key: `${SUBSCRIBER}:${'G' + 'C'.repeat(55)}` }),
    ];
    render(<DashboardPage />);
    expect(screen.getByText(/2 subscriptions/)).toBeInTheDocument();
  });

  it('renders the Refresh button', () => {
    render(<DashboardPage />);
    expect(screen.getByRole('button', { name: /refresh subscriptions/i })).toBeInTheDocument();
  });

  it('clicking Refresh calls refetch', () => {
    const refetch = jest.fn();
    mockSubscriptions.refetch = refetch;
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole('button', { name: /refresh subscriptions/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
    mockSubscriptions.refetch = jest.fn();
  });

  it('hides cancelled subscriptions from the count', () => {
    mockSubscriptions.subscriptions = [
      makeSub({ cancelledAt: new Date() }),
    ];
    render(<DashboardPage />);
    // With 0 visible active subs, we should see empty state
    expect(screen.getByTestId('dashboard-empty-state')).toBeInTheDocument();
  });

  it('Disconnect button calls disconnect', () => {
    const disconnect = jest.fn();
    mockWallet.disconnect = disconnect;
    render(<DashboardPage />);
    fireEvent.click(screen.getByRole('button', { name: /disconnect/i }));
    expect(disconnect).toHaveBeenCalledTimes(1);
    mockWallet.disconnect = jest.fn();
  });
});
