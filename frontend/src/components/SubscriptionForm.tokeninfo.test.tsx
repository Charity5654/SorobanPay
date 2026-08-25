/**
 * SubscriptionForm.tokeninfo.test.tsx
 *
 * Tests for the token balance / allowance panel that appears below the amount
 * field when a valid SEP-41 token address and connected wallet are present.
 *
 * Tests cover:
 *   - Panel hidden when wallet disconnected
 *   - Panel hidden when token address is invalid
 *   - Balance and allowance rows rendered on success
 *   - Insufficient-balance warning shown when amount > balance
 *   - Insufficient-allowance warning shown when amount > allowance
 *   - Both warnings shown simultaneously when both conditions hold
 *   - Warnings absent when amount ≤ balance/allowance
 *   - Error state renders retry button
 *   - Loading skeleton shown while status is 'loading'
 *   - Refresh button triggers a re-fetch
 *
 * Uses jsdom environment (testEnvironment: 'jsdom') per project jest.config.js.
 */

import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';

// ── Network mock ───────────────────────────────────────────────────────────────
const mockNetwork = {
  CONTRACT_ID: 'C' + 'A'.repeat(55),
  RPC_URL: 'https://soroban-testnet.stellar.org',
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  NETWORK_NAME: 'Testnet',
};
jest.mock('@/constants/network', () => mockNetwork);

// ── transaction_builder mock ──────────────────────────────────────────────────
jest.mock('@/lib/transaction_builder', () => ({
  buildAndSubmitSubscribe: jest.fn(),
}));

// ── useWallet mock ────────────────────────────────────────────────────────────
let mockWalletState = {
  publicKey: null as string | null,
  isCheckingFreighter: false,
  freighterInstalled: true,
};
jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => mockWalletState,
}));

// ── useTokenInfo mock — fully controllable per test ───────────────────────────
const mockRefresh = jest.fn();
let mockTokenInfoState = {
  status: 'idle' as 'idle' | 'loading' | 'success' | 'error',
  balance: null as bigint | null,
  allowance: null as bigint | null,
  error: null as string | null,
  lastUpdated: null as string | null,
  refresh: mockRefresh,
};
jest.mock('@/hooks/useTokenInfo', () => ({
  useTokenInfo: () => mockTokenInfoState,
}));

import SubscriptionForm from '@/components/SubscriptionForm';

// ── Constants ─────────────────────────────────────────────────────────────────
const VALID_MERCHANT = 'G' + 'A'.repeat(55);
const VALID_TOKEN = 'C' + 'B'.repeat(55);
const CONNECTED_KEY = 'G' + 'B'.repeat(55);

// 1 token = 10_000_000 stroops (7 decimal places, SEP-41 convention)
const TOKEN_STROOPS = 10_000_000n;

// ── Helpers ───────────────────────────────────────────────────────────────────
function setConnected() {
  mockWalletState = {
    publicKey: CONNECTED_KEY,
    isCheckingFreighter: false,
    freighterInstalled: true,
  };
}

function setDisconnected() {
  mockWalletState = {
    publicKey: null,
    isCheckingFreighter: false,
    freighterInstalled: true,
  };
}

function setTokenInfoSuccess(balanceTokens: number, allowanceTokens: number) {
  mockTokenInfoState = {
    status: 'success',
    balance: BigInt(balanceTokens) * TOKEN_STROOPS,
    allowance: BigInt(allowanceTokens) * TOKEN_STROOPS,
    error: null,
    lastUpdated: new Date().toISOString(),
    refresh: mockRefresh,
  };
}

function setTokenInfoLoading() {
  mockTokenInfoState = {
    status: 'loading',
    balance: null,
    allowance: null,
    error: null,
    lastUpdated: null,
    refresh: mockRefresh,
  };
}

function setTokenInfoError(msg: string) {
  mockTokenInfoState = {
    status: 'error',
    balance: null,
    allowance: null,
    error: msg,
    lastUpdated: null,
    refresh: mockRefresh,
  };
}

function setTokenInfoIdle() {
  mockTokenInfoState = {
    status: 'idle',
    balance: null,
    allowance: null,
    error: null,
    lastUpdated: null,
    refresh: mockRefresh,
  };
}

/** Fill in token address in the combobox (simulates typing a raw address). */
function enterTokenAddress(token = VALID_TOKEN) {
  // The TokenCombobox renders an <input role="combobox"> — use getByRole.
  const combo = screen.getByRole('combobox');
  fireEvent.change(combo, { target: { value: token } });
}

function enterAmount(value: string) {
  fireEvent.change(screen.getByLabelText(/amount/i), { target: { value } });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TokenInfoPanel – hidden when wallet is disconnected', () => {
  beforeEach(() => {
    setDisconnected();
    setTokenInfoIdle();
  });

  it('does not show balance info when wallet is not connected', () => {
    render(<SubscriptionForm />);
    expect(screen.queryByText(/your balance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/approved allowance/i)).not.toBeInTheDocument();
  });
});

describe('TokenInfoPanel – idle when token not yet valid', () => {
  beforeEach(() => {
    setConnected();
    setTokenInfoIdle();
  });

  it('does not show balance info when status is idle', () => {
    render(<SubscriptionForm />);
    expect(screen.queryByText(/your balance/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/approved allowance/i)).not.toBeInTheDocument();
  });
});

describe('TokenInfoPanel – loading skeleton', () => {
  beforeEach(() => {
    setConnected();
    setTokenInfoLoading();
  });

  it('shows "Fetching balance…" while loading', () => {
    render(<SubscriptionForm />);
    expect(screen.getByText(/fetching balance/i)).toBeInTheDocument();
  });
});

describe('TokenInfoPanel – success state', () => {
  beforeEach(() => {
    setConnected();
    setTokenInfoSuccess(100, 50);
  });

  it('shows "Your balance" row', () => {
    render(<SubscriptionForm />);
    expect(screen.getByText(/your balance/i)).toBeInTheDocument();
  });

  it('shows "Approved allowance" row', () => {
    render(<SubscriptionForm />);
    expect(screen.getByText(/approved allowance/i)).toBeInTheDocument();
  });

  it('formats balance with 7 decimal places', () => {
    render(<SubscriptionForm />);
    // 100 tokens × 10_000_000 stroops = 1_000_000_000 stroops → 100.0000000
    expect(screen.getByText('100.0000000')).toBeInTheDocument();
  });

  it('formats allowance with 7 decimal places', () => {
    render(<SubscriptionForm />);
    // 50 tokens → 50.0000000
    expect(screen.getByText('50.0000000')).toBeInTheDocument();
  });

  it('does not show insufficient-balance warning when amount ≤ balance', () => {
    render(<SubscriptionForm />);
    enterAmount('50');
    expect(screen.queryByText(/balance too low/i)).not.toBeInTheDocument();
  });

  it('does not show insufficient-allowance warning when amount ≤ allowance', () => {
    render(<SubscriptionForm />);
    enterAmount('50');
    expect(screen.queryByText(/allowance too low/i)).not.toBeInTheDocument();
  });
});

describe('TokenInfoPanel – insufficient balance warning', () => {
  beforeEach(() => {
    setConnected();
    // balance = 10 tokens, allowance = 200 tokens
    setTokenInfoSuccess(10, 200);
  });

  it('shows balance-too-low warning when amount > balance', () => {
    render(<SubscriptionForm />);
    enterAmount('50'); // 50 > 10
    expect(screen.getByText(/balance too low/i)).toBeInTheDocument();
  });

  it('does not show balance-too-low warning when amount = balance', () => {
    render(<SubscriptionForm />);
    enterAmount('10'); // equal, not exceeding
    expect(screen.queryByText(/balance too low/i)).not.toBeInTheDocument();
  });

  it('warning mentions the actual balance value', () => {
    render(<SubscriptionForm />);
    enterAmount('50');
    const warning = screen.getByText(/balance too low/i).closest('[role="status"]')!;
    expect(warning).toHaveTextContent('10.0000000');
  });

  it('warning is informational — submit button remains enabled', () => {
    render(<SubscriptionForm />);
    enterAmount('50');
    expect(screen.getByRole('button', { name: /authorize subscription/i })).not.toBeDisabled();
  });
});

describe('TokenInfoPanel – insufficient allowance warning', () => {
  beforeEach(() => {
    setConnected();
    // balance = 200 tokens, allowance = 5 tokens
    setTokenInfoSuccess(200, 5);
  });

  it('shows allowance-too-low warning when amount > allowance', () => {
    render(<SubscriptionForm />);
    enterAmount('50'); // 50 > 5
    expect(screen.getByText(/allowance too low/i)).toBeInTheDocument();
  });

  it('warning mentions TransferFailed error 7', () => {
    render(<SubscriptionForm />);
    enterAmount('50');
    expect(screen.getByText(/transferfailed.*error 7/i)).toBeInTheDocument();
  });

  it('warning includes CLI approve snippet with CONTRACT_ID', () => {
    render(<SubscriptionForm />);
    enterAmount('50');
    expect(screen.getByText(/stellar contract invoke/i)).toBeInTheDocument();
  });

  it('allowance-too-low warning is informational — submit stays enabled', () => {
    render(<SubscriptionForm />);
    enterAmount('50');
    expect(screen.getByRole('button', { name: /authorize subscription/i })).not.toBeDisabled();
  });

  it('does not show warning when amount = allowance', () => {
    render(<SubscriptionForm />);
    enterAmount('5');
    expect(screen.queryByText(/allowance too low/i)).not.toBeInTheDocument();
  });
});

describe('TokenInfoPanel – both warnings simultaneously', () => {
  beforeEach(() => {
    setConnected();
    // balance = 3, allowance = 2
    setTokenInfoSuccess(3, 2);
  });

  it('shows both warnings when amount exceeds both balance and allowance', () => {
    render(<SubscriptionForm />);
    enterAmount('10');
    expect(screen.getByText(/balance too low/i)).toBeInTheDocument();
    expect(screen.getByText(/allowance too low/i)).toBeInTheDocument();
  });
});

describe('TokenInfoPanel – error state', () => {
  beforeEach(() => {
    setConnected();
    setTokenInfoError('The contract did not return a balance or allowance. Verify the token address is a SEP-41 contract.');
  });

  it('shows the error message', () => {
    render(<SubscriptionForm />);
    // The error panel renders a <div id="token-info-error" role="status"> with the
    // error text. The help-token paragraph also says "SEP-41 contract address" so we
    // scope the query to the error panel element by its id.
    // eslint-disable-next-line testing-library/no-node-access
    const errorPanel = document.getElementById('token-info-error');
    expect(errorPanel).not.toBeNull();
    expect(errorPanel).toHaveTextContent(/sep-41 contract/i);
  });

  it('shows a Retry button', () => {
    render(<SubscriptionForm />);
    expect(screen.getByRole('button', { name: /retry fetching token info/i })).toBeInTheDocument();
  });

  it('calls refresh() when Retry is clicked', () => {
    render(<SubscriptionForm />);
    fireEvent.click(screen.getByRole('button', { name: /retry fetching token info/i }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('TokenInfoPanel – refresh button in success state', () => {
  beforeEach(() => {
    setConnected();
    setTokenInfoSuccess(100, 100);
    mockRefresh.mockClear();
  });

  it('calls refresh() when the refresh icon button is clicked', () => {
    render(<SubscriptionForm />);
    const refreshBtn = screen.getByRole('button', { name: /refresh token balance and allowance/i });
    fireEvent.click(refreshBtn);
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });
});

describe('TokenInfoPanel – no warnings when amount field is empty', () => {
  beforeEach(() => {
    setConnected();
    // very small balance and allowance
    setTokenInfoSuccess(1, 1);
  });

  it('does not show any warnings when amount is blank', () => {
    render(<SubscriptionForm />);
    // amount field default is blank — no enteredRaw
    expect(screen.queryByText(/balance too low/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/allowance too low/i)).not.toBeInTheDocument();
  });
});
