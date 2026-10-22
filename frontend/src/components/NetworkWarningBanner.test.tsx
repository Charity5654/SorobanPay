import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { getNetworkInfo } from '@/lib/runtime_config';
import { NetworkWarningBanner } from './NetworkWarningBanner';

jest.mock('@/lib/runtime_config', () => ({
  getNetworkInfo: jest.fn(),
}));

const mockGetNetworkInfo = jest.mocked(getNetworkInfo);

describe('NetworkWarningBanner', () => {
  beforeEach(() => {
    mockGetNetworkInfo.mockReset();
    mockGetNetworkInfo.mockReturnValue({
      name: 'Testnet',
      isProduction: false,
      passphrase: 'test-network',
    });
  });

  it('announces the testnet status and explains the dismissal action', () => {
    render(<NetworkWarningBanner />);

    expect(screen.getByRole('alert')).toHaveAttribute('aria-live', 'assertive');
    expect(screen.getByText('TESTNET - DEVELOPMENT ONLY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Dismiss testnet warning' })).toHaveAccessibleDescription(
      /Transactions use test assets/,
    );
  });

  it('can be dismissed using keyboard activation', async () => {
    const user = userEvent.setup();
    render(<NetworkWarningBanner />);

    await user.tab();
    const dismissButton = screen.getByRole('button', { name: 'Dismiss testnet warning' });
    expect(dismissButton).toHaveFocus();
    await user.keyboard('{Enter}');

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('provides a 44px dismissal target and narrow-screen wrapping', () => {
    const { container } = render(<NetworkWarningBanner />);
    const dismissButton = screen.getByRole('button', { name: 'Dismiss testnet warning' });
    const content = container.querySelector('.max-w-7xl');

    expect(dismissButton).toHaveClass('min-h-11', 'min-w-11', 'focus-visible:ring-2');
    expect(content).toHaveClass('flex-col', 'sm:flex-row');
    expect(container.querySelector('.min-w-0.break-words')).toBeInTheDocument();
  });

  it('keeps the live warning motion-safe and preserves mainnet visibility after dismissal', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<NetworkWarningBanner />);
    const dismissButton = screen.getByRole('button', { name: 'Dismiss testnet warning' });

    expect(dismissButton).toHaveClass('motion-reduce:transition-none');
    expect(screen.getByRole('alert').className).not.toMatch(/animate-/);

    await user.click(dismissButton);
    mockGetNetworkInfo.mockReturnValue({
      name: 'Mainnet',
      isProduction: true,
      passphrase: 'public-network',
    });
    rerender(<NetworkWarningBanner />);

    expect(screen.getByText('MAINNET - LIVE TRANSACTIONS')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  it('does not dismiss the mainnet safety warning', async () => {
    const user = userEvent.setup();
    mockGetNetworkInfo.mockReturnValue({
      name: 'Mainnet',
      isProduction: true,
      passphrase: 'public-network',
    });

    render(<NetworkWarningBanner />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/real and irreversible/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});