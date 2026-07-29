/**
 * useWallet.test.tsx
 *
 * Unit tests for the useWallet hook.
 *
 * Issue #433 – Frontend unit tests with Jest and RTL
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { useWallet } from '@/hooks/useWallet';
import { WalletProvider } from '@/context/WalletContext';

// ── Mocks ──────────────────────────────────────────────────────────────────

jest.mock('@/lib/wallet_manager', () => ({
  detectFreighter: jest.fn().mockResolvedValue(true),
  connectWallet: jest.fn().mockResolvedValue('GPUBLICKEY'),
}));

// ── Test components ────────────────────────────────────────────────────────

function ConsumerInsideProvider() {
  const wallet = useWallet();
  return (
    <div>
      <span data-testid="pk">{wallet.publicKey ?? 'null'}</span>
      <span data-testid="connecting">{String(wallet.isConnecting)}</span>
      <span data-testid="error">{wallet.connectError ?? 'null'}</span>
      <span data-testid="installed">{String(wallet.freighterInstalled)}</span>
      <span data-testid="checking">{String(wallet.isCheckingFreighter)}</span>
    </div>
  );
}

function ConsumerOutsideProvider() {
  useWallet();
  return <div />;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('useWallet – inside provider', () => {
  it('returns the wallet context value without throwing', () => {
    render(
      <WalletProvider>
        <ConsumerInsideProvider />
      </WalletProvider>,
    );
    expect(screen.getByTestId('pk').textContent).toBe('null');
  });

  it('exposes publicKey, isConnecting, connectError, freighterInstalled, isCheckingFreighter', () => {
    render(
      <WalletProvider>
        <ConsumerInsideProvider />
      </WalletProvider>,
    );
    // All fields present (no undefined)
    expect(screen.getByTestId('connecting').textContent).toMatch(/^(true|false)$/);
    expect(screen.getByTestId('installed').textContent).toMatch(/^(true|false)$/);
    expect(screen.getByTestId('checking').textContent).toMatch(/^(true|false)$/);
  });

  it('initially has publicKey null and isConnecting false', () => {
    render(
      <WalletProvider>
        <ConsumerInsideProvider />
      </WalletProvider>,
    );
    expect(screen.getByTestId('pk').textContent).toBe('null');
    expect(screen.getByTestId('connecting').textContent).toBe('false');
  });
});

describe('useWallet – outside provider', () => {
  it('throws a descriptive error mentioning WalletProvider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<ConsumerOutsideProvider />)).toThrow(/WalletProvider/);
    spy.mockRestore();
  });
});
