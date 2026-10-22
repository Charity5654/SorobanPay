import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubscriptionWizard from './SubscriptionWizard';

const mockBuildAndSubmit = jest.fn();

jest.mock('@/hooks/useWallet', () => ({
  useWallet: () => ({ publicKey: `G${'S'.repeat(55)}` }),
}));

jest.mock('@/constants/network', () => ({
  CONTRACT_ID: `C${'C'.repeat(55)}`,
  NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
  NETWORK_NAME: 'Testnet',
  RPC_URL: 'https://soroban-testnet.stellar.org',
}));

jest.mock('@/lib/transaction_builder', () => ({
  buildAndSubmitSubscribe: (...args: unknown[]) => mockBuildAndSubmit(...args),
}));

jest.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast: jest.fn() }),
}));

const MERCHANT = `G${'M'.repeat(55)}`;
const TOKEN = `C${'T'.repeat(55)}`;

async function reachReview(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText(/merchant address/i), MERCHANT);
  await user.keyboard('{Enter}');
  await user.type(screen.getByLabelText(/token contract/i), TOKEN);
  await user.type(screen.getByLabelText(/^amount/i), '100');
  await user.keyboard('{Enter}');
  await user.click(screen.getByRole('button', { name: /next: review/i }));
}

describe('SubscriptionWizard responsive behavior', () => {
  beforeEach(() => mockBuildAndSubmit.mockReset());

  it('shows the active step on narrow layouts and keeps the step track constrained', () => {
    render(<SubscriptionWizard />);

    const stepNavigation = screen.getByRole('navigation', { name: /subscription wizard steps/i });
    expect(stepNavigation).toBeInTheDocument();
    expect(screen.getByText('Merchant')).toHaveClass('block');
    expect(screen.getByText('Merchant').closest('li')).toHaveAttribute('aria-current', 'step');
    expect(screen.getByText('Token & Amount')).toHaveClass('hidden', 'sm:block');
    expect(stepNavigation.querySelector('ol')).toHaveClass('flex', 'items-center');
  });

  it('supports keyboard progression and stacks step actions for mobile', async () => {
    const user = userEvent.setup();
    render(<SubscriptionWizard />);

    await user.type(screen.getByLabelText(/merchant address/i), MERCHANT);
    await user.keyboard('{Enter}');

    expect(screen.getByRole('heading', { name: /token & amount/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/token contract/i)).toHaveFocus();
    const nextButton = screen.getByRole('button', { name: /next: schedule/i });
    expect(nextButton.parentElement).toHaveClass('flex-col', 'sm:flex-row');
  });

  it('keeps empty and invalid address input on the current step with inline feedback', async () => {
    const user = userEvent.setup();
    render(<SubscriptionWizard />);

    await user.click(screen.getByRole('button', { name: /next: token & amount/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/merchant address is required/i);
    expect(screen.getByRole('navigation', { name: /subscription wizard steps/i })
      .querySelector('[aria-current="step"]')).toHaveAttribute('aria-label', 'Step 1 of 5: Merchant');

    await user.clear(screen.getByLabelText(/merchant address/i));
    await user.type(screen.getByLabelText(/merchant address/i), 'invalid');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(/valid stellar g-address/i);
  });

  it('rejects the connected wallet address as its own merchant', async () => {
    const user = userEvent.setup();
    render(<SubscriptionWizard />);

    await user.type(screen.getByLabelText(/merchant address/i), `G${'S'.repeat(55)}`);
    await user.keyboard('{Enter}');

    expect(screen.getByRole('alert')).toHaveTextContent(/cannot be the same as your subscriber address/i);
    expect(screen.getByRole('heading', { name: /choose a merchant/i })).toBeInTheDocument();
  });

  it('shows signing progress, reports submission errors, and recovers on retry', async () => {
    const user = userEvent.setup();
    let rejectSubmission!: (reason: Error) => void;
    mockBuildAndSubmit
      .mockImplementationOnce(() => new Promise((_, reject) => { rejectSubmission = reject; }))
      .mockResolvedValueOnce({ txHash: 'a'.repeat(64) });
    render(<SubscriptionWizard />);
    await reachReview(user);

    await user.click(screen.getByRole('button', { name: /confirm & sign/i }));
    const progress = await screen.findByRole('status', { name: /transaction in progress/i });
    expect(progress.querySelector('svg')).toHaveClass('motion-reduce:animate-none');
    await act(async () => rejectSubmission(new Error('temporary RPC failure')));
    expect(await screen.findByRole('heading', { name: /transaction failed/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toHaveClass('motion-reduce:transition-none');

    await user.click(screen.getByRole('button', { name: /retry/i }));
    await waitFor(() => expect(screen.getByText(/subscription created!/i)).toBeInTheDocument());
    expect(mockBuildAndSubmit).toHaveBeenCalledTimes(2);
  });

  it('provides reduced-motion overrides for progress and step controls', async () => {
    const user = userEvent.setup();
    mockBuildAndSubmit.mockImplementation(() => new Promise(() => {}));
    render(<SubscriptionWizard />);
    await reachReview(user);
    await user.click(screen.getByRole('button', { name: /confirm & sign/i }));

    expect(await screen.findByRole('status', { name: /transaction in progress/i })).toHaveClass('rounded-xl');
    expect(document.querySelector('.animate-spin')).toHaveClass('motion-reduce:animate-none');
    expect(document.querySelector('.animate-progress')).toHaveClass('motion-reduce:animate-none');
  });
});