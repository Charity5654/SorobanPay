/**
 * Payment history page tests for URL-backed pagination.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import HistoryPage from '@/app/history/page';
import type { PaymentEvent } from '@/hooks/usePaymentHistory';

const mockWallet = { publicKey: 'G' + 'A'.repeat(55) };
const mockHistory = {
  events: [] as PaymentEvent[],
  isLoading: false,
  error: null as string | null,
  hasMore: false,
  loadMore: jest.fn(),
  refresh: jest.fn(),
};

jest.mock('next/link', () => {
  const Link = ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  );
  Link.displayName = 'Link';
  return Link;
});

jest.mock('@/hooks/useWallet', () => ({ useWallet: () => mockWallet }));
jest.mock('@/hooks/usePaymentHistory', () => ({
  usePaymentHistory: () => mockHistory,
}));
jest.mock('@/constants/network', () => ({ NETWORK_NAME: 'Testnet' }));

function makeEvents(count: number): PaymentEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `event-${index + 1}`,
    ledger: index + 1,
    timestamp: '2026-01-01T00:00:00Z',
    subscriber: mockWallet.publicKey,
    merchant: 'G' + 'B'.repeat(55),
    token: 'C' + 'C'.repeat(55),
    amount: String(index + 1),
    amountStroops: String(index + 1),
    txHash: `tx-${index + 1}`,
  }));
}

describe('HistoryPage URL pagination', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/history');
    mockHistory.events = makeEvents(40);
    mockHistory.isLoading = false;
    mockHistory.error = null;
    mockHistory.hasMore = false;
    mockHistory.loadMore.mockClear();
    mockHistory.refresh.mockClear();
  });

  it('updates the URL while moving between already-loaded pages', async () => {
    render(<HistoryPage />);

    fireEvent.click(screen.getByRole('button', { name: /next payment history page/i }));
    expect(new URL(window.location.href).searchParams.get('page')).toBe('2');
    expect(await screen.findByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /amount: 21 tokens/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /previous payment history page/i }));
    expect(new URL(window.location.href).searchParams.has('page')).toBe(false);
    expect(await screen.findByText('Page 1')).toBeInTheDocument();
  });

  it('falls back to the last non-empty page for an invalid final-page URL', async () => {
    window.history.replaceState({}, '', '/history?page=3');
    mockHistory.events = makeEvents(21);

    render(<HistoryPage />);

    await waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('page')).toBe('2');
    });
    expect(screen.getByText('Page 2')).toBeInTheDocument();
    expect(screen.getByRole('row', { name: /amount: 21 tokens/i })).toBeInTheDocument();
  });
});
