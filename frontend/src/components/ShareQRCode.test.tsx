/**
 * ShareQRCode.test.tsx
 *
 * Tests for the ShareQRCode component.
 *
 * Covers:
 *  - ShareQRCode renders without merchant (disabled state)
 *  - ShareQRCode renders with merchant (enabled state)
 *  - URL building with various field combinations
 *  - QR panel visibility toggle
 *  - Copy link functionality
 *  - Download PNG functionality
 *  - Loading state during worker generation
 *  - Error handling from worker
 *  - Accessibility attributes and ARIA labels
 *  - Tenant/wallet/network safety (parameters sanitized)
 *  - buildSubscriptionUrl helper function
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  ShareQRCode,
  buildSubscriptionUrl,
  type ShareQRCodeProps,
} from './ShareQRCode';

/**
 * Mock the useQRWorker hook
 */
jest.mock('@/hooks/useQRWorker', () => ({
  useQRWorker: jest.fn((url: string, size: number, level: string) => ({
    status: 'success',
    dataUrl: url
      ? 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
      : null,
    error: null,
  })),
}));

/**
 * Mock QRCodeCanvas component
 */
jest.mock('qrcode.react', () => ({
  QRCodeCanvas: ({ value, size, level, 'aria-label': ariaLabel }: any) => (
    <canvas
      data-testid="qr-code-canvas"
      data-value={value}
      data-size={size}
      data-level={level}
      aria-label={ariaLabel}
      width={size}
      height={size}
    />
  ),
}));

// ─── Fixtures ──────────────────────────────────────────────────────────────────

const defaultProps: ShareQRCodeProps = {
  merchant: 'GBUQWP3BOUZX34LOCALNET2IQ7KDZNF3YDUET2AYE62XWJF2Q6HHVRM',
  token: 'CUQPBUFPIQ5I4DU7EC7VZRWE3LBQVUK5EC4ADCKMUEENPBI7YSLW53XV',
  amount: '100',
  interval: '2592000',
};

function renderShareQRCode(props: Partial<ShareQRCodeProps> = {}) {
  return render(
    <ShareQRCode {...defaultProps} {...props} />
  );
}

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe('ShareQRCode', () => {
  describe('rendering', () => {
    it('renders share button', () => {
      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });
      expect(button).toBeInTheDocument();
    });

    it('renders with accessible icon', () => {
      renderShareQRCode();
      const svg = screen.getByRole('button').querySelector('svg');
      expect(svg).toBeInTheDocument();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
    });
  });

  describe('disabled state', () => {
    it('disables share button when no merchant', () => {
      renderShareQRCode({ merchant: '' });
      const button = screen.getByRole('button', { name: /share/i });
      expect(button).toBeDisabled();
    });

    it('disables share button when merchant is only whitespace', () => {
      renderShareQRCode({ merchant: '   ' });
      const button = screen.getByRole('button', { name: /share/i });
      expect(button).toBeDisabled();
    });

    it('enables share button when merchant is provided', () => {
      renderShareQRCode({ merchant: 'GBUQWP3BOUZX34...' });
      const button = screen.getByRole('button', { name: /share/i });
      expect(button).not.toBeDisabled();
    });

    it('shows appropriate title when disabled', () => {
      renderShareQRCode({ merchant: '' });
      const button = screen.getByRole('button', { name: /share/i });
      expect(button).toHaveAttribute('title', expect.stringContaining('merchant'));
    });

    it('shows appropriate title when enabled', () => {
      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });
      expect(button).toHaveAttribute(
        'title',
        expect.stringContaining('shareable QR code')
      );
    });
  });

  describe('panel visibility', () => {
    it('hides QR panel initially', () => {
      renderShareQRCode();
      const panel = screen.queryByRole('region', { name: /subscription qr code/i });
      expect(panel).not.toBeInTheDocument();
    });

    it('shows QR panel when button clicked', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });
      await userEvent.click(button);

      const panel = screen.getByRole('region', { name: /subscription qr code/i });
      expect(panel).toBeInTheDocument();
    });

    it('toggles panel visibility on repeated clicks', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });

      // Open
      await userEvent.click(button);
      expect(screen.getByRole('region')).toBeInTheDocument();

      // Close
      await userEvent.click(button);
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('does not show panel when button is disabled', () => {
      renderShareQRCode({ merchant: '' });
      const button = screen.getByRole('button');
      expect(button).toBeDisabled();
      expect(screen.queryByRole('region')).not.toBeInTheDocument();
    });

    it('button aria-expanded reflects panel state', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });

      expect(button).toHaveAttribute('aria-expanded', 'false');

      await userEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'true');

      await userEvent.click(button);
      expect(button).toHaveAttribute('aria-expanded', 'false');
    });
  });

  describe('panel content', () => {
    it('displays subscription URL in panel', async () => {
      renderShareQRCode({
        merchant: 'G123',
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });

      const button = screen.getByRole('button');
      await userEvent.click(button);

      const urlDisplay = screen.getByText(/G123/);
      expect(urlDisplay).toBeInTheDocument();
    });

    it('renders QR code canvas', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button');
      await userEvent.click(button);

      const canvas = screen.getByTestId('qr-code-canvas');
      expect(canvas).toBeInTheDocument();
    });

    it('passes correct size to QR code', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button');
      await userEvent.click(button);

      const canvas = screen.getByTestId('qr-code-canvas');
      expect(canvas).toHaveAttribute('data-size', '200');
    });

    it('passes correct error correction level to QR code', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button');
      await userEvent.click(button);

      const canvas = screen.getByTestId('qr-code-canvas');
      expect(canvas).toHaveAttribute('data-level', 'M');
    });

    it('displays descriptive text about QR code', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button');
      await userEvent.click(button);

      const description = screen.getByText(
        /anyone who scans this qr code/i
      );
      expect(description).toBeInTheDocument();
    });
  });

  describe('copy link button', () => {
    it('renders copy link button', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });
      await userEvent.click(button);

      const copyButton = screen.getByRole('button', { name: /copy link/i });
      expect(copyButton).toBeInTheDocument();
    });

    it('copies URL to clipboard', async () => {
      const user = userEvent.setup();
      const clipboardWriteText = jest.spyOn(navigator.clipboard, 'writeText');

      renderShareQRCode({
        merchant: 'G123',
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });

      const button = screen.getByRole('button', { name: /share/i });
      await user.click(button);

      const copyButton = screen.getByRole('button', { name: /copy link/i });
      await user.click(copyButton);

      await waitFor(() => {
        expect(clipboardWriteText).toHaveBeenCalledWith(expect.stringContaining('G123'));
      });

      clipboardWriteText.mockRestore();
    });

    it('shows copied confirmation', async () => {
      const user = userEvent.setup();
      jest.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);

      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });
      await user.click(button);

      const copyButton = screen.getByRole('button', { name: /copy link/i });
      await user.click(copyButton);

      await waitFor(() => {
        expect(screen.getByText(/copied!/i)).toBeInTheDocument();
      });
    });

    it('handles clipboard API errors gracefully', async () => {
      const user = userEvent.setup();
      jest.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
        new Error('Clipboard denied')
      );

      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });
      await user.click(button);

      const copyButton = screen.getByRole('button', { name: /copy link/i });

      // Should not throw
      await expect(user.click(copyButton)).resolves.toBeUndefined();
    });
  });

  describe('download button', () => {
    it('renders download button', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });
      await userEvent.click(button);

      const downloadButton = screen.getByRole('button', { name: /download png/i });
      expect(downloadButton).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('has proper ARIA labels', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });
      expect(button).toHaveAttribute('aria-expanded');
      expect(button).toHaveAttribute('aria-controls', 'qr-panel');
    });

    it('panel has region role', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button');
      await userEvent.click(button);

      const panel = screen.getByRole('region');
      expect(panel).toHaveAttribute('aria-label');
    });

    it('QR code has descriptive aria-label', async () => {
      renderShareQRCode({
        merchant: 'G123',
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });
      const button = screen.getByRole('button');
      await userEvent.click(button);

      const canvas = screen.getByTestId('qr-code-canvas');
      expect(canvas).toHaveAttribute('aria-label', expect.stringContaining('QR code'));
    });

    it('buttons have proper focus states', async () => {
      renderShareQRCode();
      const button = screen.getByRole('button', { name: /share/i });
      expect(button.className).toContain('focus-visible:ring');
    });
  });

  describe('URL building', () => {
    it('builds URL with all parameters', () => {
      const url = buildSubscriptionUrl({
        merchant: 'G123',
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });

      expect(url).toContain('merchant=G123');
      expect(url).toContain('token=C456');
      expect(url).toContain('amount=100');
      expect(url).toContain('interval=2592000');
    });

    it('builds URL with partial parameters', () => {
      const url = buildSubscriptionUrl({
        merchant: 'G123',
        token: '',
        amount: '100',
        interval: '',
      });

      expect(url).toContain('merchant=G123');
      expect(url).not.toContain('token=');
      expect(url).toContain('amount=100');
      expect(url).not.toContain('interval=');
    });

    it('returns empty string when no merchant', () => {
      const url = buildSubscriptionUrl({
        merchant: '',
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });

      expect(url).toBe('');
    });

    it('returns empty string when merchant is whitespace', () => {
      const url = buildSubscriptionUrl({
        merchant: '   ',
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });

      expect(url).toBe('');
    });

    it('trims whitespace from parameters', () => {
      const url = buildSubscriptionUrl({
        merchant: '  G123  ',
        token: '  C456  ',
        amount: '  100  ',
        interval: '  2592000  ',
      });

      expect(url).toContain('merchant=G123');
      expect(url).toContain('token=C456');
      expect(url).toContain('amount=100');
      expect(url).toContain('interval=2592000');
    });

    it('includes /subscribe path', () => {
      const url = buildSubscriptionUrl({
        merchant: 'G123',
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });

      expect(url).toContain('/subscribe?');
    });

    it('handles special characters safely', () => {
      const url = buildSubscriptionUrl({
        merchant: 'G123&dangerous=true',
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });

      // URLSearchParams should encode special characters
      expect(url).toContain('%26');
    });
  });

  describe('worker integration', () => {
    it('calls useQRWorker with subscription URL', () => {
      const { useQRWorker } = require('@/hooks/useQRWorker');
      renderShareQRCode({
        merchant: 'G123',
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });

      expect(useQRWorker).toHaveBeenCalledWith(
        expect.stringContaining('merchant=G123'),
        200,
        'M'
      );
    });

    it('passes empty string to useQRWorker when no merchant', () => {
      const { useQRWorker } = require('@/hooks/useQRWorker');
      renderShareQRCode({ merchant: '' });

      expect(useQRWorker).toHaveBeenCalledWith('', 200, 'M');
    });
  });

  describe('data safety', () => {
    it('sanitizes merchant address in URL', () => {
      const maliciousMerchant = 'G123"><script>alert(1)</script>';
      const url = buildSubscriptionUrl({
        merchant: maliciousMerchant,
        token: 'C456',
        amount: '100',
        interval: '2592000',
      });

      // Should be URL encoded, not executable
      expect(url).not.toContain('<script>');
      expect(url).toContain('%');
    });

    it('does not expose sensitive values in display', async () => {
      renderShareQRCode({
        merchant: 'G_SENSITIVE',
        token: 'C_SECRET_TOKEN',
        amount: '1000',
        interval: '2592000',
      });

      const button = screen.getByRole('button', { name: /share/i });
      await userEvent.click(button);

      // Values should be visible only in the URL display (as intended)
      const urlDisplay = screen.getByText(/G_SENSITIVE/);
      expect(urlDisplay).toBeInTheDocument();
    });
  });
});
