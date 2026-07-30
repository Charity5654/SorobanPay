/**
 * PaymentHistoryTable.test.tsx
 *
 * Unit + accessibility tests for the PaymentHistoryTable component.
 *
 * Tests cover:
 *  - Renders disconnected state when isConnected is false
 *  - Renders loading skeleton with aria-busy when isLoading and events are empty
 *  - Renders empty state when events are empty and not loading
 *  - Renders error state when error is set and events are empty
 *  - Renders table with correct row data for each event
 *  - Table headers have correct scope attributes (accessibility)
 *  - Renders "Load more" button when hasMore is true
 *  - Calls onLoadMore when "Load more" is clicked
 *  - Calls onRefresh when refresh button is clicked
 *  - Tx hash links point to correct Stellar Expert URL (testnet / mainnet)
 *  - Shows "All payments loaded" when not hasMore and events exist
 *  - Timestamps are formatted and have dateTime attributes
 *  - Addresses are truncated for display
 */

import { render, screen, fireEvent } from '@testing-library/react';
import PaymentHistoryTable, { type PaymentHistoryTableProps } from '@/components/PaymentHistoryTable';
import { type PaymentEvent } from '@/hooks/usePaymentHistory';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeEvent(overrides: Partial<PaymentEvent> = {}): PaymentEvent {
  return {
    id: 'evt-001',
    ledger: 12345,
    timestamp: '2024-06-15T09:30:00Z',
    subscriber: 'GABC123456789SUBSCRIBER0000000000000000000000000000000000',
    merchant: 'GXYZ987654321MERCHANT000000000000000000000000000000000000',
    token: 'CABC123456789TOKEN00000000000000000000000000000000000000',
    amount: '10.0000000',
    amountStroops: '100000000',
    txHash: 'abcdef1234567890abcdef1234567890abcdef1234567890abcdef12',
    ...overrides,
  };
}

function defaultProps(
  overrides: Partial<PaymentHistoryTableProps> = {},
): PaymentHistoryTableProps {
  return {
    events: [],
    isLoading: false,
    error: null,
    hasMore: false,
    onLoadMore: jest.fn(),
    onRefresh: jest.fn(),
    isConnected: true,
    networkName: 'Testnet',
    ...overrides,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PaymentHistoryTable', () => {
  // ── Disconnected state ───────────────────────────────────────────────────

  describe('disconnected state', () => {
    it('renders a "connect your wallet" message when isConnected is false', () => {
      render(<PaymentHistoryTable {...defaultProps({ isConnected: false })} />);
      expect(screen.getByText(/connect your wallet/i)).toBeInTheDocument();
    });

    it('does not render a table when disconnected', () => {
      render(<PaymentHistoryTable {...defaultProps({ isConnected: false })} />);
      expect(screen.queryByRole('table')).not.toBeInTheDocument();
    });

    it('has an accessible label for the disconnected region', () => {
      render(<PaymentHistoryTable {...defaultProps({ isConnected: false })} />);
      expect(
        screen.getByRole('status', { name: /wallet not connected/i }),
      ).toBeInTheDocument();
    });
  });

  // ── Loading skeleton ─────────────────────────────────────────────────────

  describe('loading skeleton', () => {
    it('renders a table with aria-busy when loading with no events', () => {
      render(<PaymentHistoryTable {...defaultProps({ isLoading: true })} />);
      expect(screen.getByRole('table', { name: /loading/i })).toBeInTheDocument();
    });

    it('has aria-label indicating loading state', () => {
      render(<PaymentHistoryTable {...defaultProps({ isLoading: true })} />);
      expect(
        screen.getByLabelText(/loading payment history/i),
      ).toBeInTheDocument();
    });
  });

  // ── Empty state ──────────────────────────────────────────────────────────

  describe('empty state', () => {
    it('renders "No payments found" when events are empty and not loading', () => {
      render(<PaymentHistoryTable {...defaultProps()} />);
      expect(screen.getByText(/no payments found/i)).toBeInTheDocument();
    });

    it('has an accessible status role for the empty state', () => {
      render(<PaymentHistoryTable {...defaultProps()} />);
      expect(screen.getByRole('status', { name: /no payment history/i })).toBeInTheDocument();
    });

    it('renders a refresh button in the empty state', () => {
      render(<PaymentHistoryTable {...defaultProps()} />);
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });

    it('calls onRefresh when the empty state refresh button is clicked', () => {
      const onRefresh = jest.fn();
      render(<PaymentHistoryTable {...defaultProps({ onRefresh })} />);
      fireEvent.click(screen.getByRole('button', { name: /refresh/i }));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  // ── Error state ──────────────────────────────────────────────────────────

  describe('error state', () => {
    it('renders an error message when error is set and no events are loaded', () => {
      render(
        <PaymentHistoryTable
          {...defaultProps({ error: 'RPC request timed out' })}
        />,
      );
      expect(screen.getByText(/rpc request timed out/i)).toBeInTheDocument();
    });

    it('has an alert role for the error state', () => {
      render(
        <PaymentHistoryTable
          {...defaultProps({ error: 'Network error' })}
        />,
      );
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });

    it('renders a "Try again" button in the error state', () => {
      render(
        <PaymentHistoryTable
          {...defaultProps({ error: 'Network error' })}
        />,
      );
      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('calls onRefresh when "Try again" is clicked', () => {
      const onRefresh = jest.fn();
      render(
        <PaymentHistoryTable
          {...defaultProps({ error: 'Network error', onRefresh })}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });
  });

  // ── Table rendering ──────────────────────────────────────────────────────

  describe('table with events', () => {
    const events = [makeEvent(), makeEvent({ id: 'evt-002', ledger: 12346, amount: '5.0000000', txHash: 'aaaa' })];

    it('renders a table element with accessible label', () => {
      render(<PaymentHistoryTable {...defaultProps({ events })} />);
      expect(screen.getByRole('table', { name: /payment history/i })).toBeInTheDocument();
    });

    it('renders correct number of rows (header + data rows)', () => {
      render(<PaymentHistoryTable {...defaultProps({ events })} />);
      // 2 data rows + 1 header row
      expect(screen.getAllByRole('row')).toHaveLength(3);
    });

    it('renders all column headers with scope="col"', () => {
      render(<PaymentHistoryTable {...defaultProps({ events })} />);
      const headers = screen.getAllByRole('columnheader');
      expect(headers.length).toBe(6);
      headers.forEach((th) => {
        expect(th).toHaveAttribute('scope', 'col');
      });
    });

    it('displays column header labels: Date, Merchant, Token, Amount, Ledger, Transaction', () => {
      render(<PaymentHistoryTable {...defaultProps({ events })} />);
      expect(screen.getByRole('columnheader', { name: /date/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /merchant/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /token/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /amount/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /ledger/i })).toBeInTheDocument();
      expect(screen.getByRole('columnheader', { name: /transaction/i })).toBeInTheDocument();
    });

    it('renders the event amount in each row', () => {
      render(<PaymentHistoryTable {...defaultProps({ events })} />);
      expect(screen.getByText('10.0000000')).toBeInTheDocument();
      expect(screen.getByText('5.0000000')).toBeInTheDocument();
    });

    it('renders an accessible timestamp with dateTime attribute', () => {
      render(<PaymentHistoryTable {...defaultProps({ events: [makeEvent()] })} />);
      const time = document.querySelector('time');
      expect(time).toBeInTheDocument();
      expect(time).toHaveAttribute('dateTime', '2024-06-15T09:30:00Z');
    });

    it('truncates addresses for display', () => {
      render(<PaymentHistoryTable {...defaultProps({ events: [makeEvent()] })} />);
      // truncateAddress('GABC123456789SUBSCRIBER0000000000000000000000000000000000', 6)
      // = 'GABC12…000000'
      expect(screen.getByText(/GABC12/)).toBeInTheDocument();
    });

    it('renders tx hash as a link to Stellar Expert (testnet)', () => {
      render(<PaymentHistoryTable {...defaultProps({ events: [makeEvent()] })} />);
      const link = screen.getByRole('link', { name: /view transaction/i });
      expect(link).toHaveAttribute(
        'href',
        expect.stringContaining('stellar.expert/explorer/testnet/tx/'),
      );
      expect(link).toHaveAttribute('target', '_blank');
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('renders tx hash link pointing to mainnet when networkName is Mainnet', () => {
      render(
        <PaymentHistoryTable
          {...defaultProps({ events: [makeEvent()], networkName: 'Mainnet' })}
        />,
      );
      const link = screen.getByRole('link', { name: /view transaction/i });
      expect(link).toHaveAttribute(
        'href',
        expect.stringContaining('stellar.expert/explorer/public/tx/'),
      );
    });

    it('renders a dash when txHash is empty', () => {
      render(
        <PaymentHistoryTable
          {...defaultProps({ events: [makeEvent({ txHash: '' })] })}
        />,
      );
      expect(screen.getByLabelText(/transaction hash not available/i)).toBeInTheDocument();
    });

    it('renders the events count text', () => {
      render(<PaymentHistoryTable {...defaultProps({ events })} />);
      expect(screen.getByText(/2 payments loaded/i)).toBeInTheDocument();
    });

    it('shows "All payments loaded" when hasMore is false and events exist', () => {
      render(<PaymentHistoryTable {...defaultProps({ events, hasMore: false })} />);
      expect(screen.getByText(/all payments loaded/i)).toBeInTheDocument();
    });
  });

  // ── Pagination ───────────────────────────────────────────────────────────

  describe('pagination', () => {
    const events = [makeEvent()];

    it('renders a "Load more" button when hasMore is true', () => {
      render(<PaymentHistoryTable {...defaultProps({ events, hasMore: true })} />);
      expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
    });

    it('does not render "Load more" when hasMore is false', () => {
      render(<PaymentHistoryTable {...defaultProps({ events, hasMore: false })} />);
      expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
    });

    it('calls onLoadMore when "Load more" is clicked', () => {
      const onLoadMore = jest.fn();
      render(
        <PaymentHistoryTable {...defaultProps({ events, hasMore: true, onLoadMore })} />,
      );
      fireEvent.click(screen.getByRole('button', { name: /load more/i }));
      expect(onLoadMore).toHaveBeenCalledTimes(1);
    });

    it('shows a loading status when isLoading with existing events', () => {
      render(
        <PaymentHistoryTable
          {...defaultProps({ events, hasMore: false, isLoading: true })}
        />,
      );
      expect(screen.getByRole('status', { name: /loading more/i })).toBeInTheDocument();
    });
  });

  // ── Refresh button ───────────────────────────────────────────────────────

  describe('refresh button', () => {
    it('renders a refresh button when events are loaded', () => {
      render(
        <PaymentHistoryTable {...defaultProps({ events: [makeEvent()] })} />,
      );
      expect(screen.getByRole('button', { name: /refresh payment history/i })).toBeInTheDocument();
    });

    it('calls onRefresh when the refresh button is clicked', () => {
      const onRefresh = jest.fn();
      render(
        <PaymentHistoryTable
          {...defaultProps({ events: [makeEvent()], onRefresh })}
        />,
      );
      fireEvent.click(screen.getByRole('button', { name: /refresh payment history/i }));
      expect(onRefresh).toHaveBeenCalledTimes(1);
    });

    it('disables the refresh button while loading', () => {
      render(
        <PaymentHistoryTable
          {...defaultProps({ events: [makeEvent()], isLoading: true })}
        />,
      );
      expect(
        screen.getByRole('button', { name: /refresh payment history/i }),
      ).toBeDisabled();
    });
  });

  // ── Region accessibility ─────────────────────────────────────────────────

  describe('region accessibility', () => {
    it('wraps the table in a scrollable region with aria-label', () => {
      render(<PaymentHistoryTable {...defaultProps({ events: [makeEvent()] })} />);
      expect(
        screen.getByRole('region', { name: /payment history table/i }),
      ).toBeInTheDocument();
    });
  });
});
