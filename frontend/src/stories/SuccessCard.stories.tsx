import type { Meta, StoryObj } from '@storybook/react';
import { SuccessCard } from '../components/SuccessCard';

/**
 * SuccessCard is shown immediately after a subscription is created on-chain.
 * It displays the transaction hash, a summary of the subscription parameters,
 * and guidance on what happens next.
 *
 * The component uses `role="alert"` so screen readers announce the success
 * message as soon as it appears in the DOM.
 */
const meta: Meta<typeof SuccessCard> = {
  title: 'Components/SuccessCard',
  component: SuccessCard,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Post-subscription success confirmation. Shows the transaction hash, ' +
          'subscription summary, and next-steps guidance. Uses `role="alert"` ' +
          'for accessible announcement.',
      },
    },
  },
  argTypes: {
    onReset: { action: 'create another clicked' },
    data: {
      description: 'Subscription data to display in the card',
    },
  },
};

export default meta;
type Story = StoryObj<typeof SuccessCard>;

const sampleTxHash =
  'a3f1b2c4d5e6f7081234567890abcdef1234567890abcdef1234567890abcdef12';

/**
 * Standard 30-day monthly subscription — the most common case.
 * Shows a full subscription with a realistic Stellar transaction hash.
 */
export const Monthly: Story = {
  args: {
    data: {
      txHash: sampleTxHash,
      merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      amount: '100',
      interval: '2592000', // 30 days
    },
  },
};

/**
 * Daily subscription — interval is 1 day (86400 seconds).
 * Tests the singular "day" label (no trailing 's').
 */
export const Daily: Story = {
  args: {
    data: {
      txHash: sampleTxHash,
      merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      amount: '10',
      interval: '86400', // 1 day
    },
  },
};

/**
 * Annual subscription — interval is 365 days (31536000 seconds).
 * The maximum interval supported by the contract.
 */
export const Annual: Story = {
  args: {
    data: {
      txHash: sampleTxHash,
      merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      amount: '1200',
      interval: '31536000', // 365 days
    },
  },
};

/**
 * Long transaction hash — tests the `break-all` overflow handling on the hash display.
 */
export const LongTxHash: Story = {
  name: 'Long Transaction Hash',
  args: {
    data: {
      txHash:
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff' +
        'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
      merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
      token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      amount: '500',
      interval: '2592000',
    },
  },
};
