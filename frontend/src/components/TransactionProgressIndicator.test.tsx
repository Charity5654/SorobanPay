import { fireEvent, render, screen } from '@testing-library/react';
import { TransactionProgressIndicator, type TransactionProgressIndicatorProps } from '@/components/TransactionProgressIndicator';

const baseProps: TransactionProgressIndicatorProps = {
  title: 'Confirming payment',
  steps: [
    { id: 'submitted', label: 'Submitted', status: 'completed' },
    { id: 'confirmed', label: 'On-chain confirmation', status: 'in-progress' },
  ],
  currentStepIndex: 1,
};

describe('TransactionProgressIndicator', () => {
  it('announces the loading state and exposes accessible progress values', () => {
    render(<TransactionProgressIndicator {...baseProps} status="loading" />);

    expect(screen.getByRole('status')).toHaveTextContent(/please wait/i);
    expect(screen.getByRole('progressbar', { name: /transaction progress/i })).toHaveAttribute('aria-valuenow', '50');
  });

  it('announces successful confirmation', () => {
    render(<TransactionProgressIndicator {...baseProps} status="success" />);

    expect(screen.getByRole('status')).toHaveTextContent(/transaction confirmed/i);
  });

  it('exposes failure details as an alert', () => {
    render(
      <TransactionProgressIndicator
        {...baseProps}
        status="failure"
        isFailed
        errorMessage="Transaction failed on-chain"
      />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(/transaction failed on-chain/i);
  });

  it('offers an accessible manual refresh when status is unknown', () => {
    const onRefresh = jest.fn();
    render(
      <TransactionProgressIndicator
        {...baseProps}
        status="unknown"
        onRefresh={onRefresh}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /check transaction status again/i }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('alert')).toHaveTextContent(/status unknown/i);
  });

  it('disables manual refresh while a check is active', () => {
    render(
      <TransactionProgressIndicator
        {...baseProps}
        status="timeout"
        onRefresh={jest.fn()}
        isRefreshing
      />,
    );

    expect(screen.getByRole('button', { name: /check transaction status again/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /check transaction status again/i })).toHaveTextContent(/checking status/i);
  });
});