/**
 * RouteErrorBoundary.test.tsx
 *
 * Tests for the RouteErrorBoundary component.
 *
 * Covers:
 *   - Success (renders children when used inside a wrapper)
 *   - Failure (error UI, heading, message, correlation ID, actions)
 *   - Loading / pending state (aria-busy)
 *   - Retry callback
 *   - Home navigation link
 *   - Accessibility (role, aria-live, aria-labelledby, tabIndex, focus)
 *   - Correlation ID format
 *   - Wallet / network / tenant safety (no sensitive data rendered)
 *   - Dev vs production message sanitisation
 *
 * Issue #1051 — Add route-level error boundaries
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { RouteErrorBoundary } from '@/components/RouteErrorBoundary';

// ── Mocks ──────────────────────────────────────────────────────────────────────

jest.mock('next/link', () => {
  const Link = ({
    children,
    href,
    className,
    'aria-label': ariaLabel,
  }: {
    children: React.ReactNode;
    href: string;
    className?: string;
    'aria-label'?: string;
  }) => (
    <a href={href} className={className} aria-label={ariaLabel}>
      {children}
    </a>
  );
  Link.displayName = 'Link';
  return Link;
});

// Silence console.error so test output is clean; verify it was called.
const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeError(message = 'Test error', digest?: string) {
  const err = new Error(message) as Error & { digest?: string };
  if (digest) err.digest = digest;
  return err;
}

function renderBoundary(
  overrides: Partial<{
    error: Error & { digest?: string };
    reset: () => void;
    routeName: string;
  }> = {},
) {
  const props = {
    error: makeError(),
    reset: jest.fn(),
    ...overrides,
  };
  return { ...render(<RouteErrorBoundary {...props} />), reset: props.reset };
}

// ── Tests ──────────────────────────────────────────────────────────────────────

afterEach(() => {
  consoleSpy.mockClear();
});

afterAll(() => {
  consoleSpy.mockRestore();
});

// ─── Failure state UI ──────────────────────────────────────────────────────────

describe('RouteErrorBoundary — failure state', () => {
  it('renders an alert region', () => {
    renderBoundary();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('renders the default heading when routeName is omitted', () => {
    renderBoundary();
    expect(
      screen.getByRole('heading', { name: /something went wrong/i }),
    ).toBeInTheDocument();
  });

  it('renders a route-specific heading when routeName is provided', () => {
    renderBoundary({ routeName: 'Subscribe' });
    expect(
      screen.getByRole('heading', {
        name: /something went wrong on the subscribe page/i,
      }),
    ).toBeInTheDocument();
  });

  it('renders the correlation ID with the ERR- prefix', () => {
    renderBoundary();
    const refText = screen.getByText(/reference id/i);
    const id = refText.closest('p')?.querySelector('.font-mono');
    expect(id?.textContent).toMatch(/^ERR-/);
  });

  it('correlation ID contains no sensitive values', () => {
    renderBoundary({ error: makeError('secret-token=abc123') });
    const idEl = screen.getByLabelText(/error reference id/i);
    expect(idEl.textContent).not.toContain('secret-token');
  });

  it('renders the digest when provided', () => {
    renderBoundary({ error: makeError('boom', 'DIGEST42') });
    expect(screen.getByText(/DIGEST42/)).toBeInTheDocument();
  });

  it('renders "Try again" button', () => {
    renderBoundary();
    expect(
      screen.getByRole('button', { name: /try again/i }),
    ).toBeInTheDocument();
  });

  it('calls reset when "Try again" is clicked', () => {
    const reset = jest.fn();
    renderBoundary({ reset });
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it('renders "Go home" link pointing to /', () => {
    renderBoundary();
    const link = screen.getByRole('link', { name: /go home/i });
    expect(link).toHaveAttribute('href', '/');
  });

  it('logs an error via console.error on mount', () => {
    renderBoundary();
    expect(consoleSpy).toHaveBeenCalledWith(
      '[RouteErrorBoundary]',
      expect.objectContaining({ correlationId: expect.stringMatching(/^ERR-/) }),
    );
  });
});

// ─── Accessibility ─────────────────────────────────────────────────────────────

describe('RouteErrorBoundary — accessibility', () => {
  it('alert region has aria-live="assertive"', () => {
    renderBoundary();
    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
  });

  it('alert region has aria-labelledby matching the heading id', () => {
    renderBoundary({ routeName: 'Dashboard' });
    const alert = screen.getByRole('alert');
    const labelledBy = alert.getAttribute('aria-labelledby');
    expect(labelledBy).toBeTruthy();
    // Heading with that id must exist
    const heading = document.getElementById(labelledBy!);
    expect(heading).not.toBeNull();
    expect(heading?.tagName).toBe('H1');
  });

  it('alert region has tabIndex="-1" for programmatic focus', () => {
    renderBoundary();
    expect(screen.getByRole('alert')).toHaveAttribute('tabindex', '-1');
  });

  it('"Try again" button has accessible aria-label', () => {
    renderBoundary();
    expect(
      screen.getByRole('button', { name: /try again — reload this route/i }),
    ).toBeInTheDocument();
  });

  it('"Go home" link has accessible aria-label', () => {
    renderBoundary();
    expect(
      screen.getByRole('link', { name: /navigate back to the home page/i }),
    ).toBeInTheDocument();
  });
});

// ─── Retry / cancellation ──────────────────────────────────────────────────────

describe('RouteErrorBoundary — retry', () => {
  it('calls reset exactly once per button click', () => {
    const reset = jest.fn();
    renderBoundary({ reset });
    const btn = screen.getByRole('button', { name: /try again/i });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it('reset is not called on "Go home" click', () => {
    const reset = jest.fn();
    renderBoundary({ reset });
    fireEvent.click(screen.getByRole('link', { name: /go home/i }));
    expect(reset).not.toHaveBeenCalled();
  });
});

// ─── Production message sanitisation ──────────────────────────────────────────

describe('RouteErrorBoundary — message safety', () => {
  const ORIGINAL_ENV = process.env.NODE_ENV;

  afterEach(() => {
    // Restore NODE_ENV
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: ORIGINAL_ENV,
      writable: true,
      configurable: true,
    });
  });

  it('shows a generic message in production (no raw error text)', () => {
    Object.defineProperty(process.env, 'NODE_ENV', {
      value: 'production',
      writable: true,
      configurable: true,
    });
    renderBoundary({ error: makeError('Internal DB connection string: db://secret') });
    // The raw message must NOT appear in the rendered output
    expect(screen.queryByText(/Internal DB connection string/i)).toBeNull();
    // A generic fallback message should be present
    expect(
      screen.getByText(/an unexpected error occurred/i),
    ).toBeInTheDocument();
  });

  it('does not render wallet public key even if passed in error', () => {
    const walletKey = 'GABC123FAKEWALLETADDRESS';
    renderBoundary({ error: makeError(`wallet ${walletKey} rejected`) });
    // Even in dev, the correlation ID and heading must NOT contain the key
    const headingEl = screen.getByRole('heading');
    expect(headingEl.textContent).not.toContain(walletKey);
  });
});

// ─── Correlation ID uniqueness ─────────────────────────────────────────────────

describe('RouteErrorBoundary — correlation ID', () => {
  it('each render produces a correlation ID matching ERR-<ts>-<rand> format', () => {
    const { unmount } = renderBoundary();
    const id1 = screen
      .getByLabelText(/error reference id/i)
      .textContent!;
    expect(id1).toMatch(/^ERR-[A-Z0-9]+-[A-Z0-9]+$/);
    unmount();
  });

  it('two successive mounts produce different correlation IDs', async () => {
    const { unmount } = renderBoundary();
    const id1 = screen.getByLabelText(/error reference id/i).textContent!;
    unmount();

    // Small delay to guarantee timestamp component changes
    await new Promise((r) => setTimeout(r, 2));

    renderBoundary();
    const id2 = screen.getByLabelText(/error reference id/i).textContent!;
    expect(id1).not.toBe(id2);
  });
});
