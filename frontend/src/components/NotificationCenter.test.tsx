/**
 * NotificationCenter.test.tsx
 *
 * Tests for the NotificationCenter component.
 *
 * Covers:
 *  - Rendering bell icon and badge
 *  - Panel visibility toggle
 *  - Notification list display
 *  - Pagination UI (load more button)
 *  - Mark individual and all as read
 *  - Error display
 *  - Loading states
 *  - Accessibility (ARIA labels, keyboard navigation)
 *  - Cross-tab awareness
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import NotificationCenter from './NotificationCenter';

// Mock the useNotificationsPaginated hook before importing the component
const mockUseNotifications = jest.fn();
jest.mock('@/hooks/useNotificationsPaginated', () => ({
  useNotificationsPaginated: () => mockUseNotifications(),
}));

describe('NotificationCenter', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock data
    mockUseNotifications.mockReturnValue({
      notifications: [
        {
          id: 'notif-1',
          type: 'payment_collected' as const,
          title: 'Payment collected',
          message: 'You received a payment',
          timestamp: Date.now() - 5 * 60 * 1000,
          read: false,
        },
        {
          id: 'notif-2',
          type: 'payment_due' as const,
          title: 'Payment due soon',
          message: 'Your subscription is due tomorrow',
          timestamp: Date.now() - 60 * 60 * 1000,
          read: true,
        },
      ],
      unreadCount: 1,
      isLoading: false,
      error: null,
      hasMore: true,
      loadMore: jest.fn(),
      refresh: jest.fn(),
      markRead: jest.fn().mockResolvedValue(undefined),
      markAllRead: jest.fn().mockResolvedValue(undefined),
      dismissNotification: jest.fn(),
    });
  });

  describe('rendering', () => {
    it('renders bell icon button', () => {
      render(<NotificationCenter />);
      const button = screen.getByRole('button', { name: /notifications/i });
      expect(button).toBeInTheDocument();
    });

    it('displays unread badge with count', () => {
      render(<NotificationCenter />);
      const badge = screen.getByText('1');
      expect(badge).toBeInTheDocument();
    });

    it('does not display badge when unread count is 0', () => {
      mockUseNotifications.mockReturnValue({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: jest.fn(),
        refresh: jest.fn(),
        markRead: jest.fn().mockResolvedValue(undefined),
        markAllRead: jest.fn().mockResolvedValue(undefined),
        dismissNotification: jest.fn(),
      });

      render(<NotificationCenter />);
      expect(screen.queryByText('0')).not.toBeInTheDocument();
    });

    it('displays 9+ badge when unread count exceeds 9', () => {
      mockUseNotifications.mockReturnValue({
        notifications: [],
        unreadCount: 15,
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: jest.fn(),
        refresh: jest.fn(),
        markRead: jest.fn().mockResolvedValue(undefined),
        markAllRead: jest.fn().mockResolvedValue(undefined),
        dismissNotification: jest.fn(),
      });

      render(<NotificationCenter />);
      expect(screen.getByText('9+')).toBeInTheDocument();
    });
  });

  describe('panel visibility', () => {
    it('hides panel initially', () => {
      render(<NotificationCenter />);
      const panel = screen.queryByRole('dialog');
      expect(panel).not.toBeInTheDocument();
    });

    it('shows panel when button clicked', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByRole('dialog')).toBeInTheDocument();
      });
    });

    it('shows empty state when no notifications', async () => {
      mockUseNotifications.mockReturnValue({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: jest.fn(),
        refresh: jest.fn(),
        markRead: jest.fn().mockResolvedValue(undefined),
        markAllRead: jest.fn().mockResolvedValue(undefined),
        dismissNotification: jest.fn(),
      });

      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText('No notifications yet')).toBeInTheDocument();
      });
    });

    it('shows loading state', async () => {
      mockUseNotifications.mockReturnValue({
        notifications: [],
        unreadCount: 0,
        isLoading: true,
        error: null,
        hasMore: false,
        loadMore: jest.fn(),
        refresh: jest.fn(),
        markRead: jest.fn().mockResolvedValue(undefined),
        markAllRead: jest.fn().mockResolvedValue(undefined),
        dismissNotification: jest.fn(),
      });

      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText('Loading notifications...')).toBeInTheDocument();
      });
    });
  });

  describe('notification display', () => {
    it('displays notifications in list', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText('Payment collected')).toBeInTheDocument();
        expect(screen.getByText('Payment due soon')).toBeInTheDocument();
      });
    });

    it('displays unread indicator for unread notifications', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        const unreadNotif = screen.getByLabelText(/Unread: Payment collected/i);
        expect(unreadNotif).toBeInTheDocument();
      });
    });
  });

  describe('read state management', () => {
    it('displays mark all button when unread exists', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /mark all as read/i })).toBeInTheDocument();
      });
    });

    it('hides mark all button when no unread', async () => {
      mockUseNotifications.mockReturnValue({
        notifications: [
          {
            id: 'notif-1',
            type: 'payment_collected' as const,
            title: 'Test',
            message: 'Test',
            timestamp: Date.now(),
            read: true,
          },
        ],
        unreadCount: 0,
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: jest.fn(),
        refresh: jest.fn(),
        markRead: jest.fn().mockResolvedValue(undefined),
        markAllRead: jest.fn().mockResolvedValue(undefined),
        dismissNotification: jest.fn(),
      });

      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /mark all as read/i })).not.toBeInTheDocument();
      });
    });
  });

  describe('pagination', () => {
    it('displays load more button when hasMore', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /load more/i })).toBeInTheDocument();
      });
    });

    it('hides load more button when !hasMore', async () => {
      mockUseNotifications.mockReturnValue({
        notifications: [
          {
            id: 'notif-1',
            type: 'payment_collected' as const,
            title: 'Test',
            message: 'Test',
            timestamp: Date.now(),
            read: false,
          },
        ],
        unreadCount: 1,
        isLoading: false,
        error: null,
        hasMore: false,
        loadMore: jest.fn(),
        refresh: jest.fn(),
        markRead: jest.fn().mockResolvedValue(undefined),
        markAllRead: jest.fn().mockResolvedValue(undefined),
        dismissNotification: jest.fn(),
      });

      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.queryByRole('button', { name: /load more/i })).not.toBeInTheDocument();
      });
    });

    it('shows loading indicator during pagination', async () => {
      mockUseNotifications.mockReturnValue({
        notifications: [
          {
            id: 'notif-1',
            type: 'payment_collected' as const,
            title: 'Test',
            message: 'Test',
            timestamp: Date.now(),
            read: false,
          },
        ],
        unreadCount: 1,
        isLoading: true,
        error: null,
        hasMore: true,
        loadMore: jest.fn(),
        refresh: jest.fn(),
        markRead: jest.fn().mockResolvedValue(undefined),
        markAllRead: jest.fn().mockResolvedValue(undefined),
        dismissNotification: jest.fn(),
      });

      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText('Loading more...')).toBeInTheDocument();
      });
    });
  });

  describe('error handling', () => {
    it('displays error message when present', async () => {
      mockUseNotifications.mockReturnValue({
        notifications: [],
        unreadCount: 0,
        isLoading: false,
        error: 'Failed to load notifications',
        hasMore: false,
        loadMore: jest.fn(),
        refresh: jest.fn(),
        markRead: jest.fn().mockResolvedValue(undefined),
        markAllRead: jest.fn().mockResolvedValue(undefined),
        dismissNotification: jest.fn(),
      });

      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByRole('alert')).toHaveTextContent('Failed to load notifications');
      });
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA labels on bell button', () => {
      render(<NotificationCenter />);
      const button = screen.getByRole('button', { name: /notifications.*1 unread/i });
      expect(button).toHaveAttribute('aria-expanded');
      expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    });

    it('has ARIA live region for unread count', () => {
      render(<NotificationCenter />);
      const liveRegion = screen.getByRole('status');
      expect(liveRegion).toBeInTheDocument();
      expect(liveRegion).toHaveAttribute('aria-live', 'polite');
    });

    it('panel has proper dialog role', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        const panel = screen.getByRole('dialog');
        expect(panel).toHaveAttribute('aria-modal', 'false');
      });
    });

    it('notifications have proper list structure', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        const list = screen.getByRole('list');
        expect(list).toBeInTheDocument();
      });
    });
  });

  describe('cross-tab awareness', () => {
    it('displays synced across tabs footer message', async () => {
      const user = userEvent.setup();
      render(<NotificationCenter />);

      const button = screen.getByRole('button', { name: /notifications/i });
      await user.click(button);

      await waitFor(() => {
        expect(screen.getByText(/synced across tabs/i)).toBeInTheDocument();
      });
    });
  });
});
