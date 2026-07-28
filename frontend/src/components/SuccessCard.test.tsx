/**
 * SuccessCard.test.tsx
 *
 * Unit tests for the SuccessCard component rendered inside SubscriptionForm
 * when a transaction is confirmed.
 *
 * Issue #433 – Frontend unit tests with Jest and RTL
 */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';

// ── Minimal mocks so SubscriptionForm can render ───────────────────────────

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: 'C' + 'A'.repeat(55),
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  NETWORK_NAME: 'Testnet',
}));

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({
    publicKey: 'G' + 'A'.repeat(55),
    isCheckingFreighter: false,
    freighterInstalled: true,
  }),
}));

const mockBuildAndSubmit = jest.fn();
jest.mock('@/lib/transaction_builder', () => ({
  buildAndSubmitSubscribe: (...args: unknown[]) => mockBuildAndSubmit(...args),
}));

// ── Test helpers ───────────────────────────────────────────────────────────

import { act, waitFor, fireEvent as fe } from '@testing-library/react';
import SubscriptionForm from '@/components/SubscriptionForm';

const VALID_MERCHANT = 'G' + 'A'.repeat(55);
const VALID_TOKEN = 'C' + 'A'.repeat(55);
const TX_HASH = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc123';
const AMOUNT = '100';
const INTERVAL = '2592000'; // 30 days

async function renderSuccessState() {
  mockBuildAndSubmit.mockResolvedValueOnce({ txHash: TX_HASH });
  render(<SubscriptionForm />);

  fireEvent.change(screen.getByLabelText(/merchant address/i), {
    target: { value: VALID_MERCHANT },
  });
  fireEvent.change(screen.getByLabelText(/token contract address/i), {
    target: { value: VALID_TOKEN },
  });
  fireEvent.change(screen.getByLabelText(/amount/i), {
    target: { value: AMOUNT },
  });
  fireEvent.change(screen.getByLabelText(/interval/i), {
    target: { value: INTERVAL },
  });

  fireEvent.submit(
    screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
  );

  // Confirm in modal
  await waitFor(() => screen.getByRole('dialog'));
  fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));

  await waitFor(() =>
    expect(screen.getByText(/subscription created successfully/i)).toBeInTheDocument(),
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('SuccessCard – rendering', () => {
  beforeEach(() => {
    mockBuildAndSubmit.mockReset();
    // Mock clipboard API
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      writable: true,
    });
  });

  it('renders success heading', async () => {
    await renderSuccessState();
    expect(
      screen.getByText(/subscription created successfully/i),
    ).toBeInTheDocument();
  });

  it('renders the transaction hash', async () => {
    await renderSuccessState();
    expect(screen.getByText(TX_HASH)).toBeInTheDocument();
  });

  it('renders the payment amount', async () => {
    await renderSuccessState();
    expect(screen.getByText(/100 tokens/i)).toBeInTheDocument();
  });

  it('renders the interval as days', async () => {
    await renderSuccessState();
    // 2592000 / 86400 = 30 days — appears in both summary grid and next-steps
    const elements = screen.getAllByText(/every 30 days/i);
    expect(elements.length).toBeGreaterThan(0);
  });

  it('renders the merchant address in the summary', async () => {
    await renderSuccessState();
    expect(screen.getByText(VALID_MERCHANT)).toBeInTheDocument();
  });

  it('renders "What happens next" next-steps section', async () => {
    await renderSuccessState();
    expect(screen.getByText(/what happens next/i)).toBeInTheDocument();
  });

  it('renders the "Create Another Subscription" reset button', async () => {
    await renderSuccessState();
    expect(
      screen.getByRole('button', { name: /create another subscription/i }),
    ).toBeInTheDocument();
  });

  it('renders with role="alert" for screen readers', async () => {
    await renderSuccessState();
    const alerts = screen.getAllByRole('alert');
    const successAlert = alerts.find((el) =>
      el.textContent?.includes('Subscription created successfully'),
    );
    expect(successAlert).toBeInTheDocument();
  });
});

describe('SuccessCard – interval display edge cases', () => {
  it('displays "1 day" (singular) for interval=86400', async () => {
    mockBuildAndSubmit.mockReset();
    mockBuildAndSubmit.mockResolvedValueOnce({ txHash: TX_HASH });
    render(<SubscriptionForm />);

    fireEvent.change(screen.getByLabelText(/merchant address/i), {
      target: { value: VALID_MERCHANT },
    });
    fireEvent.change(screen.getByLabelText(/token contract address/i), {
      target: { value: VALID_TOKEN },
    });
    fireEvent.change(screen.getByLabelText(/amount/i), {
      target: { value: '50' },
    });
    fireEvent.change(screen.getByLabelText(/interval/i), {
      target: { value: '86400' },
    });

    fireEvent.submit(
      screen.getByRole('button', { name: /authorize subscription/i }).closest('form')!,
    );

    await waitFor(() => screen.getByRole('dialog'));
    fireEvent.click(screen.getByRole('button', { name: /confirm & authorize/i }));

    await waitFor(() =>
      expect(screen.getByText(/subscription created successfully/i)).toBeInTheDocument(),
    );

    // Check singular "day"
    const dayElements = screen.getAllByText(/every 1 day\b/i);
    expect(dayElements.length).toBeGreaterThan(0);
  });
});

describe('SuccessCard – reset flow', () => {
  it('"Create Another Subscription" clears the success state and re-shows the form', async () => {
    await renderSuccessState();
    const resetBtn = screen.getByRole('button', { name: /create another subscription/i });
    fireEvent.click(resetBtn);

    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: /authorize subscription/i }),
      ).toBeInTheDocument(),
    );
    expect(
      screen.queryByText(/subscription created successfully/i),
    ).not.toBeInTheDocument();
  });

  it('form fields are cleared after reset', async () => {
    await renderSuccessState();
    fireEvent.click(screen.getByRole('button', { name: /create another subscription/i }));

    await waitFor(() =>
      expect(screen.getByLabelText(/merchant address/i)).toBeInTheDocument(),
    );
    expect(screen.getByLabelText(/merchant address/i)).toHaveValue('');
    expect(screen.getByLabelText(/token contract address/i)).toHaveValue('');
    expect(screen.getByLabelText(/amount/i)).toHaveValue(null);
  });
});

// ─── Issue #379: Download Receipt button ─────────────────────────────────────

describe('SuccessCard – Download Receipt button (#379)', () => {
  beforeEach(() => {
    mockBuildAndSubmit.mockReset();
    // Mock clipboard
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: jest.fn().mockResolvedValue(undefined) },
      writable: true,
    });
    // Mock URL.createObjectURL / revokeObjectURL (not available in jsdom)
    global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    global.URL.revokeObjectURL = jest.fn();
  });

  it('renders a "Download Receipt" button in the success state', async () => {
    await renderSuccessState();
    expect(
      screen.getByRole('button', { name: /download.*receipt/i }),
    ).toBeInTheDocument();
  });

  it('"Download Receipt" button has an accessible label', async () => {
    await renderSuccessState();
    const btn = screen.getByRole('button', { name: /download subscription receipt as pdf/i });
    expect(btn).toBeInTheDocument();
  });

  it('"Download Receipt" button is enabled in the success state', async () => {
    await renderSuccessState();
    const btn = screen.getByRole('button', { name: /download.*receipt/i });
    expect(btn).not.toBeDisabled();
  });

  it('clicking "Download Receipt" triggers receipt generation and does not throw', async () => {
    await renderSuccessState();
    const btn = screen.getByRole('button', { name: /download.*receipt/i });

    // The mock pdf().toBlob() returns a minimal Blob; clicking should not crash
    await act(async () => {
      fireEvent.click(btn);
    });

    // Button should re-enable after generation completes (no error state shown)
    await waitFor(() => expect(btn).not.toBeDisabled());
  });

  it('"Download Receipt" and "Create Another" buttons both appear side-by-side', async () => {
    await renderSuccessState();
    expect(
      screen.getByRole('button', { name: /download.*receipt/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /create another subscription/i }),
    ).toBeInTheDocument();
  });
});
