/**
 * SubscriptionForm.signing.test.tsx
 *
 * Tests for Freighter signing success and rejection flows.
 */
import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'CTEST',
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({ publicKey: mockWalletPublicKey, isCheckingFreighter: false, freighterInstalled: true }),
}));

const mockBuildAndSubmit = jest.fn();
jest.mock('@/lib/transaction_builder', () => ({
  buildSignAndSubmitSubscribe: (...args: unknown[]) => mockBuildAndSubmit(...args),
}));

import SubscriptionForm from '@/components/SubscriptionForm';

const VALID_MERCHANT = 'G' + 'A'.repeat(55);
const VALID_TOKEN    = 'C' + 'A'.repeat(55);
let mockWalletPublicKey = 'GPUBKEY';
let unmountForm: () => void;
let rerenderForm: (ui: React.ReactElement) => void;

function fillAndSubmitForm() {
  fireEvent.change(screen.getByLabelText(/merchant address/i), { target: { value: VALID_MERCHANT } });
  fireEvent.change(screen.getByLabelText(/token contract address/i), { target: { value: VALID_TOKEN } });
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value: '100' } });
  fireEvent.submit(
    screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
  );
}

async function confirmModal() {
  await waitFor(() => screen.getByRole('dialog'));
  fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
}

describe('SubscriptionForm – Freighter signing', () => {
  beforeEach(() => {
    mockBuildAndSubmit.mockReset();
    mockWalletPublicKey = 'GPUBKEY';
    const rendered = render(<SubscriptionForm />);
    unmountForm = rendered.unmount;
    rerenderForm = rendered.rerender;
  });

  it('shows success card after Freighter approves', async () => {
    mockBuildAndSubmit.mockResolvedValueOnce({ txHash: 'abc123' });
    fillAndSubmitForm();
    await confirmModal();
    await waitFor(() =>
      expect(screen.getByText(/subscription created successfully/i)).toBeInTheDocument(),
    );
  });

  it('shows Signing cancelled when Freighter rejects with "User declined"', async () => {
    mockBuildAndSubmit.mockRejectedValueOnce(new Error('User declined transaction'));
    fillAndSubmitForm();
    await confirmModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/signing cancelled/i),
    );
  });

  it('shows Signing cancelled for "user rejected" variant', async () => {
    mockBuildAndSubmit.mockRejectedValueOnce(new Error('user rejected'));
    fillAndSubmitForm();
    await confirmModal();
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/signing cancelled/i),
    );
  });

  it('preserves form data after rejection so user can retry', async () => {
    mockBuildAndSubmit.mockRejectedValueOnce(new Error('user rejected'));
    fillAndSubmitForm();
    await confirmModal();
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByLabelText(/merchant address/i)).toHaveValue(VALID_MERCHANT);
    expect(screen.getByLabelText(/token contract address/i)).toHaveValue(VALID_TOKEN);
    expect(screen.getByLabelText(/amount/i)).toHaveValue(100);
  });

  it('re-enables submit button after rejection', async () => {
    mockBuildAndSubmit.mockRejectedValueOnce(new Error('user rejected'));
    fillAndSubmitForm();
    await confirmModal();
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByRole('button', { name: /authorize subscription/i })).not.toBeDisabled();
  });

  it('aborts stale signing on unmount and restores saved form values on remount', async () => {
    let signal: AbortSignal | undefined;
    mockBuildAndSubmit.mockImplementationOnce((...args: unknown[]) => {
      signal = args[5] as AbortSignal;
      return new Promise(() => {});
    });

    fillAndSubmitForm();
    await confirmModal();
    expect(signal?.aborted).toBe(false);

    unmountForm();
    expect(signal?.aborted).toBe(true);

    sessionStorage.setItem('sorobanpay_form_data', JSON.stringify({
      merchantAddress: VALID_MERCHANT,
      tokenAddress: VALID_TOKEN,
      amount: '100',
      interval: '2592000',
    }));
    render(<SubscriptionForm />);
    await waitFor(() => {
      expect(screen.getByLabelText(/merchant address/i)).toHaveValue(VALID_MERCHANT);
      expect(screen.getByLabelText(/token contract address/i)).toHaveValue(VALID_TOKEN);
      expect(screen.getByLabelText(/amount/i)).toHaveValue(100);
    });
  });

  it('aborts the pending signing attempt when the connected wallet changes', async () => {
    let signal: AbortSignal | undefined;
    mockBuildAndSubmit.mockImplementationOnce((...args: unknown[]) => {
      signal = args[5] as AbortSignal;
      return new Promise(() => {});
    });

    fillAndSubmitForm();
    await confirmModal();
    expect(signal?.aborted).toBe(false);

    mockWalletPublicKey = 'G' + 'C'.repeat(55);
    rerenderForm(<SubscriptionForm />);
    await waitFor(() => expect(signal?.aborted).toBe(true));
  });
});
