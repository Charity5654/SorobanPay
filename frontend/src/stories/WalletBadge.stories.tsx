import type { Meta, StoryObj } from '@storybook/react';
import { WalletBadge } from '../components/WalletBadge';

/**
 * WalletBadge displays the current Freighter wallet connection state.
 * It covers all 5 connection states: disconnected, connecting, connected,
 * extension not installed, and connection error.
 *
 * The component is purely presentational — all callbacks and state are passed
 * via props, making it easy to test in isolation.
 */
const meta: Meta<typeof WalletBadge> = {
  title: 'Components/WalletBadge',
  component: WalletBadge,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Compact wallet connection UI. Shows a connect button when disconnected, ' +
          'a spinner while connecting, the truncated public key when connected, and ' +
          'appropriate error/install prompts in failure states.',
      },
    },
  },
  argTypes: {
    state: {
      control: 'select',
      options: ['disconnected', 'connecting', 'connected', 'no_extension', 'error'],
      description: 'Current wallet connection state',
    },
    publicKey: {
      control: 'text',
      description: 'Connected Stellar public key (used when state = connected)',
    },
    errorMessage: {
      control: 'text',
      description: 'Error message (used when state = error)',
    },
    onConnect: { action: 'connect clicked' },
    onDisconnect: { action: 'disconnect clicked' },
  },
};

export default meta;
type Story = StoryObj<typeof WalletBadge>;

/**
 * Default disconnected state — the user has not yet connected a wallet.
 * Shows the primary "Connect Freighter Wallet" CTA button.
 */
export const Disconnected: Story = {
  args: {
    state: 'disconnected',
  },
};

/**
 * Connecting state — a connection request is in flight (Freighter dialog open).
 * The button shows a spinner and is disabled to prevent double-clicks.
 */
export const Connecting: Story = {
  args: {
    state: 'connecting',
  },
};

/**
 * Connected state — wallet is connected and the truncated public key is shown.
 * A "Disconnect" link allows the user to clear the session.
 */
export const Connected: Story = {
  args: {
    state: 'connected',
    publicKey: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
  },
};

/**
 * Freighter extension not installed — prompts the user to install Freighter
 * and disables the connect button until the extension is present.
 */
export const NoExtension: Story = {
  args: {
    state: 'no_extension',
  },
};

/**
 * Connection error — the user denied access or Freighter returned an error.
 * Shows the error message and a "Retry Connection" button.
 */
export const ConnectionError: Story = {
  args: {
    state: 'error',
    errorMessage:
      'Access was denied: User rejected the access request in Freighter.',
  },
};
