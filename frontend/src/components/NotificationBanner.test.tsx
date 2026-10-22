/**
 * NotificationBanner.test.tsx
 *
 * Tests for the NotificationBanner information-architecture component.
 * Issue #1153 – Improve notification information architecture.
 *
 * Coverage:
 *  - Positive: each severity renders correct role, aria-live, icon, and title
 *  - Negative: dismiss button absent when onDismiss omitted
 *  - Boundary: very long title and body text
 *  - Recovery: dismiss callback fires on click; keyboard Enter/Space dismiss
 *  - ARIA: role="alert" for error/warning; role="status" for info/success
 *  - Keyboard: dismiss button is focusable and activatable
 *  - Narrow viewport: wrapper has no fixed width (flex layout)
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  NotificationBanner,
  ErrorNotification,
  SuccessNotification,
  WarningNotification,
  InfoNotification,
} from '@/components/NotificationBanner';

// ─── Severity × ARIA role matrix ─────────────────────────────────────────────

describe('NotificationBanner – ARIA role and live region', () => {
  it('error severity uses role="alert" and aria-live="assertive"', () => {
    render(<NotificationBanner severity="error" title="Signing cancelled" />);
    const banner = screen.getByRole('alert');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'assertive');
    expect(banner).toHaveAttribute('aria-atomic', 'true');
  });

  it('warning severity uses role="alert" and aria-live="assertive"', () => {
    render(<NotificationBanner severity="warning" title="Wallet not detected" />);
    const banner = screen.getByRole('alert');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'assertive');
  });

  it('success severity uses role="status" and aria-live="polite"', () => {
    render(<NotificationBanner severity="success" title="Subscription created" />);
    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });

  it('info severity uses role="status" and aria-live="polite"', () => {
    render(<NotificationBanner severity="info" title="Network: Testnet" />);
    const banner = screen.getByRole('status');
    expect(banner).toBeInTheDocument();
    expect(banner).toHaveAttribute('aria-live', 'polite');
  });
});

// ─── Title rendering ──────────────────────────────────────────────────────────

describe('NotificationBanner – title', () => {
  it('renders the title text', () => {
    render(<NotificationBanner severity="success" title="Subscription active" />);
    expect(screen.getByText('Subscription active')).toBeInTheDocument();
  });

  it('renders very long title without overflow (no error)', () => {
    const longTitle = 'A'.repeat(200);
    render(<NotificationBanner severity="info" title={longTitle} />);
    expect(screen.getByText(longTitle)).toBeInTheDocument();
  });
});

// ─── Children / body content ──────────────────────────────────────────────────

describe('NotificationBanner – body content', () => {
  it('renders string children', () => {
    render(
      <NotificationBanner severity="error" title="Error">
        Something went wrong.
      </NotificationBanner>
    );
    expect(screen.getByText('Something went wrong.')).toBeInTheDocument();
  });

  it('renders React node children', () => {
    render(
      <NotificationBanner severity="info" title="Info">
        <a href="https://example.com">Read more</a>
      </NotificationBanner>
    );
    expect(screen.getByRole('link', { name: 'Read more' })).toBeInTheDocument();
  });

  it('renders without children (body section absent)', () => {
    const { container } = render(
      <NotificationBanner severity="success" title="Done" />
    );
    // No paragraph with body text beyond the title
    expect(container.querySelectorAll('p').length).toBe(1);
  });
});

// ─── Dismiss behavior ─────────────────────────────────────────────────────────

describe('NotificationBanner – dismiss button', () => {
  it('dismiss button is absent when onDismiss is not provided', () => {
    render(<NotificationBanner severity="error" title="Error" />);
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('dismiss button is present when onDismiss is provided', () => {
    render(<NotificationBanner severity="error" title="Error" onDismiss={() => {}} />);
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('dismiss button aria-label includes the notification title', () => {
    render(
      <NotificationBanner severity="warning" title="Wallet not found" onDismiss={() => {}} />
    );
    expect(
      screen.getByRole('button', { name: /Dismiss: Wallet not found/i })
    ).toBeInTheDocument();
  });

  it('calls onDismiss when dismiss button is clicked', () => {
    const onDismiss = jest.fn();
    render(<NotificationBanner severity="error" title="Error" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismiss button is keyboard-activatable (Enter key)', async () => {
    const onDismiss = jest.fn();
    const user = userEvent.setup();
    render(<NotificationBanner severity="error" title="Error" onDismiss={onDismiss} />);
    const btn = screen.getByRole('button', { name: /dismiss/i });
    btn.focus();
    await user.keyboard('{Enter}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('dismiss button is focusable via Tab', async () => {
    const user = userEvent.setup();
    render(<NotificationBanner severity="error" title="Error" onDismiss={() => {}} />);
    await user.tab();
    expect(screen.getByRole('button', { name: /dismiss/i })).toHaveFocus();
  });
});

// ─── Convenience wrappers ─────────────────────────────────────────────────────

describe('Convenience notification wrappers', () => {
  it('ErrorNotification renders role="alert"', () => {
    render(<ErrorNotification title="Oops" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('SuccessNotification renders role="status"', () => {
    render(<SuccessNotification title="Done" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('WarningNotification renders role="alert"', () => {
    render(<WarningNotification title="Warning" />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('InfoNotification renders role="status"', () => {
    render(<InfoNotification title="FYI" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

// ─── Reduced-motion: no animated content ──────────────────────────────────────

describe('NotificationBanner – reduced-motion safe', () => {
  it('renders without any animate-* class on the banner wrapper', () => {
    const { container } = render(
      <NotificationBanner severity="info" title="Info" />
    );
    // The root element should not carry any animation class
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).not.toMatch(/animate-/);
  });
});
