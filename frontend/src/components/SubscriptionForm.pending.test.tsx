/**
 * @jest-environment jsdom
 *
 * SubscriptionForm.pending.test.tsx
 *
 * Confirms that while a subscription transaction is in flight:
 *  - the submit button is disabled
 *  - a spinner (animate-spin SVG) is rendered inside the button
 *  - the ProgressBar spinner ("Submitting transaction…") is visible
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'CTEST',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: 'GPUBKEY',
    isCheckingFreighter: false,
    freighterInstalled: true,
  }),
}));

// Never resolves so isSubmitting stays true for the duration of each assertion.
jest.mock('@/lib/transaction_builder', () => ({
  buildAndSubmitSubscribe: () => new Promise(() => {}),
}));

import SubscriptionForm from '@/components/SubscriptionForm';

const VALID_MERCHANT = 'G' + 'A'.repeat(55);
const VALID_TOKEN    = 'C' + 'A'.repeat(55);

async function submitThroughModal() {
  fireEvent.change(screen.getByLabelText(/merchant address/i), { target: { value: VALID_MERCHANT } });
  fireEvent.change(screen.getByLabelText(/token contract address/i), { target: { value: VALID_TOKEN } });
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } });

  act(() => {
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
  });

  // Confirm modal appears; click through to start the actual async submission.
  await waitFor(() => screen.getByRole('dialog'));
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
  });
}

describe('SubscriptionForm – pending request state', () => {
  beforeEach(() => render(<SubscriptionForm />));

  it('disables the submit button while the transaction is in flight', async () => {
    await submitThroughModal();
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /submitting/i })).toBeDisabled(),
    );
  });

  it('renders a spinner inside the submit button while submitting', async () => {
    await submitThroughModal();
    await waitFor(() => {
      const btn = screen.getByRole('button', { name: /submitting/i });
      // The inline SVG spinner has the animate-spin class.
      expect(btn.querySelector('svg.animate-spin')).not.toBeNull();
    });
  });

  it('shows the ProgressBar "Submitting transaction…" status while submitting', async () => {
    await submitThroughModal();
    await waitFor(() =>
      expect(screen.getByRole('status', { name: /transaction in progress/i })).toBeInTheDocument(),
    );
  });
});
