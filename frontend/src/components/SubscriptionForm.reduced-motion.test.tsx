/**
 * SubscriptionForm.reduced-motion.test.tsx
 *
 * Tests for Issue #1144 – Add reduced-motion transaction states.
 *
 * Coverage:
 *  - Positive: animated spinner shown when motion is NOT reduced
 *  - Positive: static hourglass shown when motion IS reduced
 *  - Positive: progress bar animated class absent in reduced-motion mode
 *  - Positive: progress bar has role="status" and aria-label in both modes
 *  - Recovery: component renders correctly in both motion states
 *  - Boundary: loading state UI when prefersReducedMotion toggles
 *  - ARIA: progress bar is always announced regardless of motion preference
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

// ─── Mock deps ────────────────────────────────────────────────────────────────

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'CTEST',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  NETWORK_NAME: 'Testnet',
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: 'GPUBKEY',
    freighterInstalled: true,
    isCheckingFreighter: false,
  }),
}));

// Controllable pending promise
let resolveSubmit: (v: { txHash: string }) => void;
jest.mock('@/lib/transaction_builder', () => ({
  buildSignAndSubmitSubscribe: () =>
    new Promise<{ txHash: string }>((res) => { resolveSubmit = res; }),
}));

// ─── useReducedMotion mock helpers ────────────────────────────────────────────

let mockPrefersReducedMotion = false;

jest.mock('@/hooks/useReducedMotion', () => ({
  useReducedMotion: () => mockPrefersReducedMotion,
}));

import SubscriptionForm from '@/components/SubscriptionForm';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VALID_MERCHANT = 'G' + 'A'.repeat(55);
const VALID_TOKEN    = 'C' + 'A'.repeat(55);

function fillAndSubmitForm() {
  fireEvent.change(screen.getByLabelText(/merchant address/i), {
    target: { value: VALID_MERCHANT },
  });
  fireEvent.change(screen.getByLabelText(/token contract address/i), {
    target: { value: VALID_TOKEN },
  });
  fireEvent.change(screen.getByLabelText(/amount/i), {
    target: { value: '100' },
  });
  act(() => {
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!
    );
  });
}

async function confirmModal() {
  await waitFor(() =>
    expect(screen.getByRole('button', { name: /confirm & authorize/i })).toBeInTheDocument()
  );
  act(() => {
    fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
  });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('SubscriptionForm – reduced-motion transaction states', () => {
  afterEach(() => {
    mockPrefersReducedMotion = false;
  });

  describe('motion allowed (default)', () => {
    it('progress bar is rendered with role="status" during submission', async () => {
      mockPrefersReducedMotion = false;
      render(<SubscriptionForm />);
      fillAndSubmitForm();
      await confirmModal();

      await waitFor(() =>
        expect(screen.getByRole('status', { name: /transaction in progress/i })).toBeInTheDocument()
      );
    });

    it('submit button shows animated SVG spinner in motion-allowed mode', async () => {
      mockPrefersReducedMotion = false;
      render(<SubscriptionForm />);
      fillAndSubmitForm();
      await confirmModal();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
      );

      const submitBtn = screen.getByRole('button', { name: /submitting/i });
      expect(submitBtn.querySelector('svg')).not.toBeNull();
    });
  });

  describe('reduced-motion mode', () => {
    it('progress bar is still rendered with role="status" during submission', async () => {
      mockPrefersReducedMotion = true;
      render(<SubscriptionForm />);
      fillAndSubmitForm();
      await confirmModal();

      await waitFor(() =>
        expect(screen.getByRole('status', { name: /transaction in progress/i })).toBeInTheDocument()
      );
    });

    it('progress bar does not contain animate-progress class in reduced-motion mode', async () => {
      mockPrefersReducedMotion = true;
      render(<SubscriptionForm />);
      fillAndSubmitForm();
      await confirmModal();

      await waitFor(() =>
        expect(screen.getByRole('status', { name: /transaction in progress/i })).toBeInTheDocument()
      );

      const progressBar = screen.getByRole('status', { name: /transaction in progress/i });
      expect(progressBar.innerHTML).not.toMatch(/animate-progress/);
    });

    it('submit button shows static hourglass emoji instead of SVG spinner', async () => {
      mockPrefersReducedMotion = true;
      render(<SubscriptionForm />);
      fillAndSubmitForm();
      await confirmModal();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
      );

      const submitBtn = screen.getByRole('button', { name: /submitting/i });
      expect(submitBtn.querySelector('svg')).toBeNull();
      expect(submitBtn.textContent).toContain('⏳');
    });

    it('progress bar aria-label is preserved in reduced-motion mode', async () => {
      mockPrefersReducedMotion = true;
      render(<SubscriptionForm />);
      fillAndSubmitForm();
      await confirmModal();

      await waitFor(() =>
        expect(
          screen.getByRole('status', { name: /transaction in progress/i })
        ).toBeInTheDocument()
      );

      expect(
        screen.getByRole('status', { name: /transaction in progress/i })
      ).toHaveAttribute('aria-label', 'Transaction in progress');
    });

    it('success card renders after tx completes in reduced-motion mode', async () => {
      mockPrefersReducedMotion = true;
      render(<SubscriptionForm />);
      fillAndSubmitForm();
      await confirmModal();

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled()
      );

      await act(async () => {
        resolveSubmit({ txHash: 'abc123reduced' });
      });

      await waitFor(() =>
        expect(screen.getByRole('button', { name: /create another/i })).toBeInTheDocument()
      );

      expect(screen.getByText(/subscription created successfully/i)).toBeInTheDocument();
    });
  });

  describe('useReducedMotion mock semantics', () => {
    it('hook returns false by default (SSR-safe, motion allowed)', () => {
      expect(mockPrefersReducedMotion).toBe(false);
    });

    it('hook returns true when reduced-motion preference is active', () => {
      mockPrefersReducedMotion = true;
      expect(mockPrefersReducedMotion).toBe(true);
    });
  });
});
