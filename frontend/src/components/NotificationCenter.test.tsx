/**
 * NotificationCenter.test.tsx — unit tests for the notification center (UX-119).
 */

import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import '@testing-library/jest-dom';
import NotificationCenter from './NotificationCenter';
import { useNotifications } from '@/context/NotificationContext';
import type { Notification } from '@/types/notifications';

// ─── Mock the context ─────────────────────────────────────────────────────────
jest.mock('@/context/NotificationContext', () => ({
  useNotifications: jest.fn(),
}));

const mockMarkRead = jest.fn();
const mockMarkAllRead = jest.fn();
const mockDismiss = jest.fn();

const sampleNotifications: Notification[] = [
  {
    id: 'n1',
    type: 'payment_collected',
    title: 'Payment collected',
    message: 'Received 100 USDC from GABC…XY01.',
    timestamp: Date.now() - 1000 * 60 * 5,
    read: false,
  },
  {
    id: 'n2',
    type: 'payment_failed',
    title: 'Payment failed',
    message: 'Insufficient balance for payment to GXYZ…MERCH.',
    timestamp: Date.now() - 1000 * 60 * 60,
    read: true,
  },
];

function setupMock(overrides: Partial<ReturnType<typeof useNotifications>> = {}) {
  (useNotifications as jest.Mock).mockReturnValue({
    notifications: sampleNotifications,
    unreadCount: 1,
    markRead: mockMarkRead,
    markAllRead: mockMarkAllRead,
    dismissNotification: mockDismiss,
    addNotification: jest.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  setupMock();
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('NotificationCenter', () => {
  it('renders the bell button', () => {
    render(<NotificationCenter />);
    const btn = screen.getByRole('button', { name: /notifications/i });
    expect(btn).toBeInTheDocument();
  });

  it('shows unread count badge when unreadCount > 0', () => {
    render(<NotificationCenter />);
    // Badge shows the number
    expect(screen.getByText('1')).toBeInTheDocument();
  });

  it('hides the badge when unreadCount is 0', () => {
    setupMock({ unreadCount: 0 });
    render(<NotificationCenter />);
    expect(screen.queryByText('0')).not.toBeInTheDocument();
  });

  it('opens the dropdown when bell is clicked', () => {
    render(<NotificationCenter />);
    const btn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(btn);
    expect(screen.getByRole('dialog', { name: /notifications/i })).toBeInTheDocument();
  });

  it('closes the dropdown on second click (toggle)', () => {
    render(<NotificationCenter />);
    const btn = screen.getByRole('button', { name: /notifications/i });
    fireEvent.click(btn); // open
    fireEvent.click(btn); // close
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows notification titles when open', () => {
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText('Payment collected')).toBeInTheDocument();
    expect(screen.getByText('Payment failed')).toBeInTheDocument();
  });

  it('calls markRead when clicking a notification', () => {
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    // Use getAllByLabelText to handle the "Unread: Payment collected" label
    const notifBtns = screen.getAllByLabelText(/Payment collected/i);
    // The first match is the mark-read button (not the dismiss button)
    const markReadBtn = notifBtns.find((el) => el.getAttribute('aria-label')?.includes('Click to mark as read'));
    expect(markReadBtn).toBeTruthy();
    fireEvent.click(markReadBtn!);
    expect(mockMarkRead).toHaveBeenCalledWith('n1');
  });

  it('calls markAllRead when "Mark all as read" is clicked', () => {
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    const markAllBtn = screen.getByRole('button', { name: /mark all as read/i });
    fireEvent.click(markAllBtn);
    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
  });

  it('does not show "Mark all as read" when unreadCount is 0', () => {
    setupMock({ unreadCount: 0 });
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.queryByRole('button', { name: /mark all as read/i })).not.toBeInTheDocument();
  });

  it('calls dismissNotification when dismiss button is clicked', () => {
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    const dismissBtns = screen.getAllByLabelText(/dismiss notification/i);
    fireEvent.click(dismissBtns[0]);
    expect(mockDismiss).toHaveBeenCalledWith('n1');
  });

  it('shows empty state when notifications list is empty', () => {
    setupMock({ notifications: [], unreadCount: 0 });
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByText(/no notifications yet/i)).toBeInTheDocument();
  });

  it('closes on Escape key press', () => {
    render(<NotificationCenter />);
    fireEvent.click(screen.getByRole('button', { name: /notifications/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows "9+" badge when unreadCount > 9', () => {
    setupMock({ unreadCount: 12 });
    render(<NotificationCenter />);
    expect(screen.getByText('9+')).toBeInTheDocument();
  });
});
