/**
 * DashboardEmptyState.test.tsx
 *
 * Unit tests for the DashboardEmptyState component.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import DashboardEmptyState from '@/components/DashboardEmptyState';

// Mock next/link — jsdom doesn't support Next.js routing
jest.mock('next/link', () => {
  const Link = ({ children, href, ...props }: { children: React.ReactNode; href: string; [key: string]: unknown }) => (
    <a href={href} {...props}>{children}</a>
  );
  Link.displayName = 'Link';
  return Link;
});

describe('DashboardEmptyState', () => {
  it('renders a heading about no active subscriptions', () => {
    render(<DashboardEmptyState />);
    expect(screen.getByText(/no active subscriptions/i)).toBeInTheDocument();
  });

  it('renders a descriptive body text', () => {
    render(<DashboardEmptyState />);
    expect(screen.getByText(/you don't have any active subscriptions yet/i)).toBeInTheDocument();
  });

  it('renders a link to create a subscription', () => {
    render(<DashboardEmptyState />);
    const link = screen.getByRole('link', { name: /create a subscription/i });
    expect(link).toBeInTheDocument();
    expect(link).toHaveAttribute('href', '/');
  });

  it('has the correct data-testid attribute', () => {
    render(<DashboardEmptyState />);
    expect(screen.getByTestId('dashboard-empty-state')).toBeInTheDocument();
  });

  it('has accessible aria-label', () => {
    render(<DashboardEmptyState />);
    expect(
      screen.getByLabelText(/no active subscriptions/i),
    ).toBeInTheDocument();
  });
});
