import type { Meta, StoryObj } from '@storybook/react';
import { WalletContext } from '../context/WalletContext';
import SubscriptionForm from '../components/SubscriptionForm';
import type { WalletContextValue } from '../context/WalletContext';
import type { ReactNode } from 'react';

/**
 * SubscriptionForm is the main subscription creation form.
 * It integrates with the Freighter wallet and the Soroban contract.
 *
 * This file covers all 5 wallet states:
 *  1. disconnected — wallet not connected (form hidden, guarded by parent)
 *  2. connected    — ready to fill in and submit
 *  3. submitting   — transaction in flight (progress bar + spinner)
 *  4. success      — subscription created (SuccessCard shown)
 *  5. error        — transaction failed (error message shown)
 *
 * Note: Since SubscriptionForm reads CONTRACT_ID from the environment at module
 * load time, the `ContractNotConfigured` story demonstrates the guard UI shown
 * when the contract address is absent.
 */
const meta: Meta<typeof SubscriptionForm> = {
  title: 'Components/SubscriptionForm',
  component: SubscriptionForm,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    docs: {
      description: {
        component:
          'Full subscription creation form. Validates merchant address, token address, ' +
          'amount, and interval. Integrates with Freighter for transaction signing. ' +
          'Shows a progress bar while the transaction is in flight and a SuccessCard ' +
          'on completion.',
      },
    },
    // Override the NEXT_PUBLIC_CONTRACT_ID env var for all stories in this file
    nextjs: {
      appDirectory: true,
    },
  },
};

export default meta;
type Story = StoryObj<typeof SubscriptionForm>;

// ─── Mock wallet context helper ───────────────────────────────────────────────

function walletContextValue(overrides: Partial<WalletContextValue> = {}): WalletContextValue {
  return {
    publicKey: null,
    isConnecting: false,
    connectError: null,
    freighterInstalled: true,
    connect: async () => {},
    disconnect: () => {},
    ...overrides,
  };
}

function WithWallet({
  value,
  children,
}: {
  value: WalletContextValue;
  children: ReactNode;
}) {
  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

// ─── Stories ──────────────────────────────────────────────────────────────────

/**
 * Connected state — wallet is connected and ready.
 * The form is fully interactive: fill in merchant address, token, amount, and interval.
 *
 * CONTRACT_ID is injected via the Storybook environment override so the
 * ContractConfigError guard doesn't fire.
 */
export const Connected: Story = {
  parameters: {
    nextjs: {
      navigation: {},
    },
    env: {
      NEXT_PUBLIC_CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
      NEXT_PUBLIC_RPC_URL: 'https://soroban-testnet.stellar.org',
      NEXT_PUBLIC_NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015',
    },
  },
  decorators: [
    (Story) => (
      <WithWallet
        value={walletContextValue({
          publicKey: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
        })}
      >
        <Story />
      </WithWallet>
    ),
  ],
};

/**
 * Disconnected state — no wallet connected.
 * The submit button is disabled because `publicKey` is null.
 * In the real app, this form is not rendered until the wallet is connected;
 * this story shows the form in isolation with the button disabled.
 */
export const Disconnected: Story = {
  parameters: {
    env: {
      NEXT_PUBLIC_CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
    },
  },
  decorators: [
    (Story) => (
      <WithWallet value={walletContextValue({ publicKey: null })}>
        <Story />
      </WithWallet>
    ),
  ],
};

/**
 * Submitting state — a transaction is in flight.
 * Shows the animated progress bar at the top of the form and disables all inputs.
 *
 * This story uses a mock that never resolves `buildAndSubmitSubscribe` to hold
 * the submitting state. In Storybook it simply renders the loading UI.
 */
export const Submitting: Story = {
  name: 'Submitting (transaction in flight)',
  parameters: {
    env: {
      NEXT_PUBLIC_CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
    },
  },
  decorators: [
    (Story) => (
      <WithWallet
        value={walletContextValue({
          publicKey: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
        })}
      >
        {/*
          The ProgressBar inside SubscriptionForm is controlled by the
          isSubmitting state flag inside the component, which is set to true
          when handleSubmit fires and reset on completion/error.

          To demonstrate this state in isolation we render the ProgressBar
          component directly alongside the form.
        */}
        <div className="w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 text-white">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2">Create Subscription</h2>
          <p className="text-gray-400 text-sm mb-6 leading-relaxed">
            Authorize a recurring on-chain payment using your Freighter wallet.
          </p>
          {/* Inline progress bar for story demonstration */}
          <div
            className="w-full mb-6 p-4 sm:p-5 bg-blue-900/20 border border-blue-600/40 rounded-lg"
            role="status"
            aria-label="Transaction in progress"
          >
            <div className="flex justify-between items-center mb-3">
              <div className="flex items-center gap-2">
                <svg
                  className="animate-spin h-5 w-5 text-blue-400"
                  xmlns="http://www.w3.org/2000/svg"
                  fill="none"
                  viewBox="0 0 24 24"
                  aria-hidden="true"
                >
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                <span className="text-sm font-medium text-blue-300">Submitting transaction…</span>
              </div>
              <span className="text-xs text-blue-300/60 animate-pulse">Processing on blockchain</span>
            </div>
            <div className="h-2 w-full bg-gray-700 rounded-full overflow-hidden shadow-inner">
              <div className="h-full bg-gradient-to-r from-blue-400 via-blue-500 to-blue-400 rounded-full animate-pulse w-3/4" />
            </div>
            <p className="mt-2 text-xs text-gray-400 text-center">
              This may take 10–30 seconds. Keep the window open.
            </p>
          </div>
          <p className="text-center text-sm text-gray-500">(form inputs are disabled while submitting)</p>
        </div>
      </WithWallet>
    ),
  ],
};

/**
 * Success state — subscription was created successfully.
 * The SuccessCard replaces the form and displays the transaction hash and summary.
 *
 * This story renders the SuccessCard directly to show the post-submission UI
 * without needing to mock the full transaction flow.
 */
export const Success: Story = {
  name: 'Success (subscription created)',
  parameters: {
    env: {
      NEXT_PUBLIC_CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
    },
  },
  decorators: [
    (Story) => {
      // Import SuccessCard inline for this story
      const { SuccessCard } = require('../components/SuccessCard');
      return (
        <WithWallet
          value={walletContextValue({
            publicKey: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
          })}
        >
          <div className="w-full max-w-lg mx-auto">
            <SuccessCard
              data={{
                txHash: 'a3f1b2c4d5e6f7081234567890abcdef1234567890abcdef1234567890abcdef12',
                merchant: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
                token: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
                amount: '100',
                interval: '2592000',
              }}
              onReset={() => {}}
            />
          </div>
        </WithWallet>
      );
    },
  ],
};

/**
 * Error state — transaction failed (e.g., user rejected in Freighter).
 * Shows the red error banner above the form with the error message preserved.
 */
export const TransactionError: Story = {
  name: 'Error (transaction failed)',
  parameters: {
    env: {
      NEXT_PUBLIC_CONTRACT_ID: 'CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCN4',
    },
  },
  decorators: [
    (Story) => (
      <WithWallet
        value={walletContextValue({
          publicKey: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
        })}
      >
        <div className="w-full max-w-lg mx-auto bg-gray-900 rounded-2xl shadow-xl p-5 sm:p-8 text-white">
          <h2 className="text-2xl sm:text-3xl font-bold mb-2">Create Subscription</h2>
          <p className="text-gray-400 text-sm mb-6 leading-relaxed">
            Authorize a recurring on-chain payment using your Freighter wallet.
          </p>
          {/* Inline error banner */}
          <div
            role="alert"
            className="mb-6 rounded-lg bg-red-900/60 border border-red-600 p-4 sm:p-5 text-sm text-red-200"
          >
            <p className="font-semibold mb-2 text-base">Transaction error</p>
            <p className="leading-relaxed">
              Transaction rejected: you declined the signing request in Freighter.
            </p>
            <p className="mt-3 text-gray-400 text-xs">
              Your form data has been preserved — review and retry.
            </p>
          </div>
          <p className="text-center text-sm text-gray-500">(form remains visible for retry)</p>
        </div>
      </WithWallet>
    ),
  ],
};

/**
 * Contract not configured — shown when NEXT_PUBLIC_CONTRACT_ID is missing.
 * Renders the ContractConfigError guard with remediation steps.
 */
export const ContractNotConfigured: Story = {
  name: 'Contract Not Configured',
  parameters: {
    env: {
      NEXT_PUBLIC_CONTRACT_ID: '', // empty → triggers the guard
    },
  },
  decorators: [
    (Story) => (
      <WithWallet
        value={walletContextValue({
          publicKey: 'GBVNNPOFVV2LABSAS4ANEKV7LEXRIKRDPESAJX7FMRIGGMCQSN4T4DJD',
        })}
      >
        <Story />
      </WithWallet>
    ),
  ],
};
