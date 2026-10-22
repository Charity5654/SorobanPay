import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useClipboard } from './useClipboard';

function ClipboardExample() {
  const { copy, status } = useClipboard();
  return (
    <>
      <button type="button" onClick={() => void copy('GEXAMPLE')}>Copy address</button>
      <span role="status" aria-live="polite">
        {status === 'copied' ? 'Wallet address copied.' : status === 'error' ? 'Could not copy wallet address.' : ''}
      </span>
    </>
  );
}

describe('useClipboard', () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, 'clipboard', originalClipboard);
    } else {
      Reflect.deleteProperty(navigator, 'clipboard');
    }
  });

  it('announces successful copy after keyboard activation', async () => {
    const writeText = jest.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const user = userEvent.setup();
    render(<ClipboardExample />);

    await user.tab();
    await user.keyboard('{Enter}');

    expect(writeText).toHaveBeenCalledWith('GEXAMPLE');
    expect(await screen.findByText('Wallet address copied.')).toBeInTheDocument();
  });

  it('announces clipboard rejection and recovers after a successful retry', async () => {
    const writeText = jest.fn()
      .mockRejectedValueOnce(new Error('Permission denied'))
      .mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    render(<ClipboardExample />);

    fireEvent.click(screen.getByRole('button', { name: /copy address/i }));
    expect(await screen.findByText('Could not copy wallet address.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /copy address/i }));
    expect(await screen.findByText('Wallet address copied.')).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledTimes(2);
  });

  it('reports unavailable clipboard support without throwing', async () => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    render(<ClipboardExample />);

    fireEvent.click(screen.getByRole('button', { name: /copy address/i }));

    expect(await screen.findByText('Could not copy wallet address.')).toBeInTheDocument();
  });
});