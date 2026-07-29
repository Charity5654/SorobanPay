'use client';

/**
 * SuccessCard.tsx
 *
 * Standalone success confirmation card shown after a subscription is created.
 * Extracted from SubscriptionForm to allow isolated Storybook documentation.
 *
 * Displays:
 *  - Transaction hash
 *  - Subscription summary (amount, interval, merchant)
 *  - "What happens next" guidance
 *  - A button to create another subscription
 */

export interface SuccessCardData {
  /** Stellar transaction hash (hex or base64) */
  txHash: string;
  /** Merchant's Stellar public key */
  merchant: string;
  /** SEP-41 token contract address */
  token: string;
  /** Payment amount in token units */
  amount: string;
  /** Billing interval in seconds */
  interval: string;
}

export interface SuccessCardProps {
  /** Subscription data to display */
  data: SuccessCardData;
  /** Callback when user clicks "Create another subscription" */
  onReset?: () => void;
}

export function SuccessCard({ data, onReset }: SuccessCardProps) {
  const days = Math.round(Number(data.interval) / 86400);

  return (
    <div
      role="alert"
      className="w-full max-w-lg mx-auto rounded-xl bg-gradient-to-br from-green-900/60 to-green-800/30 border-2 border-green-600/60 p-5 sm:p-6 text-sm space-y-4 shadow-lg text-white"
    >
      {/* Header */}
      <div className="flex items-center gap-3">
        <span className="text-2xl flex-shrink-0" aria-hidden="true">✓</span>
        <p className="font-semibold text-green-300 text-base sm:text-lg">
          Subscription created successfully!
        </p>
      </div>

      {/* Tx hash */}
      <div className="bg-gray-800/50 rounded-lg p-3 border border-gray-700/50">
        <p className="text-gray-400 text-xs mb-1.5 font-medium">Transaction hash</p>
        <p className="text-gray-200 break-all font-mono text-xs leading-relaxed">
          {data.txHash}
        </p>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs text-gray-300 bg-gray-800/30 rounded-lg p-3">
        <span className="text-gray-400 font-medium">Amount</span>
        <span className="font-medium">{data.amount} tokens</span>
        <span className="text-gray-400 font-medium">Interval</span>
        <span className="font-medium">
          every {days} day{days !== 1 ? 's' : ''}
        </span>
        <span className="text-gray-400 font-medium break-all">Merchant</span>
        <span className="break-all font-mono text-xs">{data.merchant}</span>
      </div>

      {/* Next steps */}
      <div className="border-t border-green-800/60 pt-4 space-y-2.5">
        <p className="text-green-300 font-semibold text-xs uppercase tracking-widest">
          What happens next
        </p>
        <ul className="list-disc list-inside space-y-2 text-gray-300 text-xs leading-relaxed">
          <li>The merchant can collect the first payment immediately.</li>
          <li>
            Subsequent payments are collectible every {days} day
            {days !== 1 ? 's' : ''}.
          </li>
          <li>
            To cancel, call{' '}
            <code className="bg-gray-800 px-1.5 py-0.5 rounded text-green-300 text-xs">
              cancel(subscriber, merchant)
            </code>{' '}
            on the contract, or revoke the token allowance via your wallet.
          </li>
          <li>Your wallet remains non-custodial — the contract never holds your funds.</li>
        </ul>
      </div>

      <button
        onClick={onReset}
        className="w-full rounded-lg border-2 border-green-600/70 text-green-300
                   hover:bg-green-900/40 active:bg-green-900/60
                   py-3 sm:py-4 text-sm font-semibold transition-all duration-150
                   min-h-[48px] focus:outline-none focus:ring-2 focus:ring-green-500
                   hover:shadow-lg"
      >
        Create another subscription
      </button>
    </div>
  );
}

export default SuccessCard;
