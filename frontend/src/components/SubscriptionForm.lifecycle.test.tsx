/**
 * SubscriptionForm.lifecycle.test.tsx
 *
 * End-to-end form lifecycle tests:
 *   - Disconnected wallet state (submit disabled, hint shown)
 *   - Connected/idle state (form enabled)
 *   - Validation errors shown on empty submit
 *   - Full subscribe → success lifecycle
 *   - Error state with form preservation
 *   - ContractConfigError shown when CONTRACT_ID is missing
 *
 * Issue #433 – Frontend unit tests with Jest and RTL
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// ── Network mock (overridden per describe block) ───────────────────────────

const mockNetwork = {
  CONTRACT_ID: 'C' + 'A'.repeat(55),
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  NETWORK_NAME: 'Testnet',
};
jest.mock('@/constants/network', () => mockNetwork);

const mockBuildAndSubmit = jest.fn();
jest.mock('@/lib/transaction_builder', () => ({
  buildAndSubmitSubscribe: (...args: unknown[]) => mockBuildAndSubmit(...args),
}));

// useWallet state controlled per test
let mockWalletState = {
  publicKey: null as string | null,
  isCheckingFreighter: false,
  freighterInstalled: true,
};
jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => mockWalletState,
}));

import SubscriptionForm from '@/components/SubscriptionForm';

const VALID_MERCHANT = 'G' + 'A'.repeat(55);
const VALID_TOKEN = 'C' + 'A'.repeat(55);

function fillForm(merchant = VALID_MERCHANT, token = VALID_TOKEN, amount = '100') {
  fireEvent.change(screen.getByLabelText(/merchant address/i), {
    target: { value: merchant },
  });
  fireEvent.change(screen.getByLabelText(/token contract address/i), {
    target: { value: token },
  });
  fireEvent.change(screen.getByLabelText(/amount/i), {
    target: { value: amount },
  });
}

// ── Disconnected wallet state ──────────────────────────────────────────────

describe('SubscriptionForm – disconnected wallet state', () => {
  beforeEach(() => {
    mockWalletState = { publicKey: null, isCheckingFreighter: false, freighterInstalled: true };
    mockBuildAndSubmit.mockReset();
    render(<SubscriptionForm />);
  });

  it('shows the "Disconnected" badge', () => {
    expect(screen.getByText(/disconnected/i)).toBeInTheDocument();
  });

  it('disables the submit button when wallet is not connected', () => {
    expect(screen.getByRole('button', { name: /authorize subscription/i })).toBeDisabled();
  });

  it('shows a wallet hint message when disconnected', () => {
    expect(
      screen.getByText(/connect your freighter wallet to enable submission/i),
    ).toBeInTheDocument();
  });
});

// ── Connected/idle wallet state ────────────────────────────────────────────

describe('SubscriptionForm – connected wallet state', () => {
  beforeEach(() => {
    mockWalletState = {
      publicKey: 'G' + 'B'.repeat(55),
      isCheckingFreighter: false,
      freighterInstalled: true,
    };
    mockBuildAndSubmit.mockReset();
    render(<SubscriptionForm />);
  });

  it('shows the "Connected" badge', () => {
    expect(screen.getByText(/connected/i)).toBeInTheDocument();
  });

  it('enables the submit button when wallet is connected', () => {
    expect(
      screen.getByRole('button', { name: /authorize subscription/i }),
    ).not.toBeDisabled();
  });

  it('does not show the wallet hint when connected', () => {
    expect(
      screen.queryByText(/connect your freighter wallet/i),
    ).not.toBeInTheDocument();
  });
});

// ── Form validation ────────────────────────────────────────────────────────

describe('SubscriptionForm – form validation', () => {
  beforeEach(() => {
    mockWalletState = {
      publicKey: 'G' + 'B'.repeat(55),
      isCheckingFreighter: false,
      freighterInstalled: true,
    };
    mockBuildAndSubmit.mockReset();
    render(<SubscriptionForm />);
  });

  it('shows error for empty merchant address on submit', async () => {
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() =>
      expect(screen.getByText(/merchant address is required/i)).toBeInTheDocument(),
    );
  });

  it('shows error for invalid G-address', async () => {
    fireEvent.change(screen.getByLabelText(/merchant address/i), {
      target: { value: 'INVALID' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() =>
      expect(screen.getByText(/valid stellar g-address/i)).toBeInTheDocument(),
    );
  });

  it('shows error for invalid C-address token', async () => {
    fireEvent.change(screen.getByLabelText(/merchant address/i), {
      target: { value: VALID_MERCHANT },
    });
    fireEvent.change(screen.getByLabelText(/token contract address/i), {
      target: { value: 'NOTACONTRACT' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() =>
      expect(screen.getByText(/valid stellar c-address/i)).toBeInTheDocument(),
    );
  });

  it('shows error for amount = 0', async () => {
    fireEvent.change(screen.getByLabelText(/merchant address/i), {
      target: { value: VALID_MERCHANT },
    });
    fireEvent.change(screen.getByLabelText(/token contract address/i), {
      target: { value: VALID_TOKEN },
    });
    fireEvent.change(screen.getByLabelText(/amount/i), {
      target: { value: '0' },
    });
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() =>
      expect(screen.getByText(/amount must be greater than 0/i)).toBeInTheDocument(),
    );
  });

  it('does NOT submit when there are validation errors', async () => {
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() =>
      expect(screen.getByText(/merchant address is required/i)).toBeInTheDocument(),
    );
    expect(mockBuildAndSubmit).not.toHaveBeenCalled();
  });
});

// ── Full lifecycle ─────────────────────────────────────────────────────────

describe('SubscriptionForm – full subscribe → success lifecycle', () => {
  beforeEach(() => {
    mockWalletState = {
      publicKey: 'G' + 'B'.repeat(55),
      isCheckingFreighter: false,
      freighterInstalled: true,
    };
    mockBuildAndSubmit.mockReset();
    render(<SubscriptionForm />);
  });

  it('shows confirmation modal before submitting', async () => {
    fillForm();
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() =>
      expect(screen.getByRole('dialog')).toBeInTheDocument(),
    );
    expect(screen.getByText(/confirm subscription/i)).toBeInTheDocument();
  });

  it('cancelling the modal returns to idle — no API call', async () => {
    fillForm();
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /go back/i }));
    await waitFor(() =>
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
    );
    expect(mockBuildAndSubmit).not.toHaveBeenCalled();
  });

  it('shows SuccessCard after successful transaction', async () => {
    mockBuildAndSubmit.mockResolvedValueOnce({ txHash: 'deadbeef' });
    fillForm();
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    await waitFor(() =>
      expect(screen.getByText(/subscription created successfully/i)).toBeInTheDocument(),
    );
    expect(screen.getByText('deadbeef')).toBeInTheDocument();
  });
});

// ── Error states ───────────────────────────────────────────────────────────

describe('SubscriptionForm – error states', () => {
  beforeEach(() => {
    mockWalletState = {
      publicKey: 'G' + 'B'.repeat(55),
      isCheckingFreighter: false,
      freighterInstalled: true,
    };
    mockBuildAndSubmit.mockReset();
    render(<SubscriptionForm />);
  });

  it('shows "Signing cancelled" for user rejection', async () => {
    mockBuildAndSubmit.mockRejectedValueOnce(new Error('User declined transaction'));
    fillForm();
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/signing cancelled/i),
    );
  });

  it('shows "Insufficient balance" for balance errors', async () => {
    mockBuildAndSubmit.mockRejectedValueOnce(new Error('insufficient balance'));
    fillForm();
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/insufficient balance/i),
    );
  });

  it('preserves form data after an error', async () => {
    mockBuildAndSubmit.mockRejectedValueOnce(new Error('user rejected'));
    fillForm();
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    await waitFor(() => screen.getByRole('alert'));
    expect(screen.getByLabelText(/merchant address/i)).toHaveValue(VALID_MERCHANT);
  });

  it('re-enables the submit button after an error', async () => {
    mockBuildAndSubmit.mockRejectedValueOnce(new Error('user rejected'));
    fillForm();
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    await waitFor(() => screen.getByRole('alert'));
    expect(
      screen.getByRole('button', { name: /authorize subscription/i }),
    ).not.toBeDisabled();
  });

  it('dismisses the error card when the × button is clicked', async () => {
    mockBuildAndSubmit.mockRejectedValueOnce(new Error('user rejected'));
    fillForm();
    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );
    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));
    await waitFor(() => screen.getByRole('alert'));
    fireEvent.click(screen.getByRole('button', { name: /dismiss error/i }));
    await waitFor(() =>
      expect(screen.queryByRole('alert')).not.toBeInTheDocument(),
    );
  });
});

// ── ContractConfigError ────────────────────────────────────────────────────

describe('SubscriptionForm – ContractConfigError', () => {
  it('renders a config error card when CONTRACT_ID is empty', () => {
    mockNetwork.CONTRACT_ID = '';
    mockWalletState = {
      publicKey: null,
      isCheckingFreighter: false,
      freighterInstalled: true,
    };
    render(<SubscriptionForm />);
    expect(screen.getByText(/contract not configured/i)).toBeInTheDocument();
    // Restore
    mockNetwork.CONTRACT_ID = 'C' + 'A'.repeat(55);
  });
});

// ── Freighter not installed warning ───────────────────────────────────────

describe('SubscriptionForm – Freighter not installed', () => {
  it('shows install warning when freighterInstalled is false', () => {
    mockWalletState = {
      publicKey: null,
      isCheckingFreighter: false,
      freighterInstalled: false,
    };
    render(<SubscriptionForm />);
    expect(screen.getByText(/freighter wallet not detected/i)).toBeInTheDocument();
  });
});
