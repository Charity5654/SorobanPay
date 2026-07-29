/**
 * FeeEstimate.test.tsx
 *
 * Unit tests for the FeeEstimate component.
 *
 * Covers:
 *  - Renders nothing when status is 'idle'
 *  - Renders a loading skeleton (aria-busy) when status is 'loading'
 *  - Renders estimated fee in XLM when status is 'success'
 *  - Correct stroop-to-XLM conversion in the success state
 *  - Breakdown section is collapsed by default
 *  - Clicking "Show fee details" expands the breakdown
 *  - Clicking "Hide fee details" collapses the breakdown
 *  - Breakdown rows contain correct values
 *  - Renders inline error message when status is 'error'
 *  - Renders fallback "still submit" note in error state
 */

import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FeeEstimate } from '@/components/FeeEstimate';
import type { FeeEstimateProps } from '@/components/FeeEstimate';

// ── Fixtures ───────────────────────────────────────────────────────────────────

const successBreakdown = {
  instructions: 100_000,
  readBytes: 256,
  writeBytes: 128,
};

// 12345 stroops = 0.0012345 XLM
const FEE_STROOPS = '12345';
const FEE_XLM = '0.0012345';

function renderFee(props: Partial<FeeEstimateProps> = {}) {
  const defaults: FeeEstimateProps = {
    status: 'idle',
    minResourceFee: null,
    breakdown: null,
    error: null,
  };
  return render(<FeeEstimate {...defaults} {...props} />);
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('FeeEstimate', () => {
  describe('idle state', () => {
    it('renders nothing when status is idle', () => {
      const { container } = renderFee({ status: 'idle' });
      expect(container.firstChild).toBeNull();
    });
  });

  describe('loading state', () => {
    it('renders a loading skeleton when status is loading', () => {
      renderFee({ status: 'loading' });
      // The skeleton has role="status" and aria-label
      const skeleton = screen.getByRole('status', {
        name: /estimating transaction fee/i,
      });
      expect(skeleton).toBeInTheDocument();
    });

    it('loading skeleton is aria-busy', () => {
      renderFee({ status: 'loading' });
      const skeleton = screen.getByRole('status');
      expect(skeleton).toHaveAttribute('aria-busy', 'true');
    });

    it('loading skeleton has animate-pulse class for visual feedback', () => {
      renderFee({ status: 'loading' });
      const skeleton = screen.getByRole('status');
      expect(skeleton.className).toContain('animate-pulse');
    });
  });

  describe('success state', () => {
    it('renders the estimated fee in XLM', () => {
      renderFee({
        status: 'success',
        minResourceFee: FEE_STROOPS,
        breakdown: successBreakdown,
      });
      // Should display the XLM value (with tilde prefix)
      expect(screen.getByText(new RegExp(FEE_XLM))).toBeInTheDocument();
    });

    it('converts 10_000_000 stroops to 1.0000000 XLM correctly', () => {
      renderFee({
        status: 'success',
        minResourceFee: '10000000',
        breakdown: successBreakdown,
      });
      expect(screen.getByText(/1\.0000000/)).toBeInTheDocument();
    });

    it('converts 100 stroops to 0.0000100 XLM correctly', () => {
      renderFee({
        status: 'success',
        minResourceFee: '100',
        breakdown: successBreakdown,
      });
      expect(screen.getByText(/0\.0000100/)).toBeInTheDocument();
    });

    it('shows "Estimated fee" label', () => {
      renderFee({
        status: 'success',
        minResourceFee: FEE_STROOPS,
        breakdown: successBreakdown,
      });
      expect(screen.getByText(/estimated fee/i)).toBeInTheDocument();
    });

    it('includes the +15% buffer note', () => {
      renderFee({
        status: 'success',
        minResourceFee: FEE_STROOPS,
        breakdown: successBreakdown,
      });
      expect(screen.getByText(/\+15%/i)).toBeInTheDocument();
    });

    it('breakdown section is collapsed by default', () => {
      renderFee({
        status: 'success',
        minResourceFee: FEE_STROOPS,
        breakdown: successBreakdown,
      });
      expect(screen.queryByText(/cpu instructions/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/read bytes/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/write bytes/i)).not.toBeInTheDocument();
    });

    it('shows "Show fee details" toggle button', () => {
      renderFee({
        status: 'success',
        minResourceFee: FEE_STROOPS,
        breakdown: successBreakdown,
      });
      const btn = screen.getByRole('button', { name: /show fee details/i });
      expect(btn).toBeInTheDocument();
      expect(btn).toHaveAttribute('aria-expanded', 'false');
    });

    it('expands breakdown when toggle is clicked', async () => {
      const user = userEvent.setup();
      renderFee({
        status: 'success',
        minResourceFee: FEE_STROOPS,
        breakdown: successBreakdown,
      });

      const btn = screen.getByRole('button', { name: /show fee details/i });
      await act(async () => { await user.click(btn); });

      expect(screen.getByText(/cpu instructions/i)).toBeInTheDocument();
      expect(screen.getByText(/read bytes/i)).toBeInTheDocument();
      expect(screen.getByText(/write bytes/i)).toBeInTheDocument();
      expect(btn).toHaveAttribute('aria-expanded', 'true');
      expect(btn).toHaveTextContent(/hide fee details/i);
    });

    it('collapses breakdown again when toggle is clicked twice', async () => {
      const user = userEvent.setup();
      renderFee({
        status: 'success',
        minResourceFee: FEE_STROOPS,
        breakdown: successBreakdown,
      });

      const btn = screen.getByRole('button', { name: /show fee details/i });
      await act(async () => { await user.click(btn); }); // open
      await act(async () => { await user.click(btn); }); // close

      expect(screen.queryByText(/cpu instructions/i)).not.toBeInTheDocument();
      expect(btn).toHaveAttribute('aria-expanded', 'false');
    });

    it('shows correct breakdown values when expanded', async () => {
      const user = userEvent.setup();
      renderFee({
        status: 'success',
        minResourceFee: FEE_STROOPS,
        breakdown: { instructions: 200_000, readBytes: 512, writeBytes: 384 },
      });

      await act(async () => {
        await user.click(screen.getByRole('button', { name: /show fee details/i }));
      });

      // Values are displayed with toLocaleString formatting
      expect(screen.getByText('200,000')).toBeInTheDocument();
      expect(screen.getByText('512')).toBeInTheDocument();
      expect(screen.getByText('384')).toBeInTheDocument();
      // Stroop value shown as-is
      expect(screen.getByText(FEE_STROOPS)).toBeInTheDocument();
    });
  });

  describe('error state', () => {
    it('renders the error message inline', () => {
      renderFee({
        status: 'error',
        error: 'HostError: wasm trap in contract execution',
      });
      expect(
        screen.getByText(/hostError: wasm trap in contract execution/i),
      ).toBeInTheDocument();
    });

    it('shows "Fee estimation unavailable" label', () => {
      renderFee({ status: 'error', error: 'Something went wrong' });
      expect(screen.getByText(/fee estimation unavailable/i)).toBeInTheDocument();
    });

    it('includes note that user can still submit', () => {
      renderFee({ status: 'error', error: 'RPC error' });
      expect(screen.getByText(/you can still submit/i)).toBeInTheDocument();
    });

    it('renders as an alert', () => {
      renderFee({ status: 'error', error: 'Something failed' });
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
  });
});
