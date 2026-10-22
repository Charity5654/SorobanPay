'use client';

/**
 * ContractFooter.tsx
 *
 * Displays the deployed contract address with a direct link to the Soroban
 * block explorer for the configured network (Testnet or Mainnet).
 *
 * Explorer base URLs:
 *  - Testnet: https://stellar.expert/explorer/testnet/contract/<id>
 *  - Mainnet: https://stellar.expert/explorer/public/contract/<id>
 *
 * Issue: #16
 */

import { CONTRACT_ID, NETWORK_NAME } from '@/constants/network';

/** Returns the Stellar Expert explorer URL for a contract address. */
function explorerUrl(contractId: string, network: string): string {
  const net = network === 'Mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${net}/contract/${contractId}`;
}

/** Truncates a long Stellar address for display: first 8 … last 6 chars. */
function shortAddress(addr: string): string {
  if (addr.length <= 16) return addr;
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

export default function ContractFooter() {
  // Nothing to render when the contract is not yet configured.
  if (!CONTRACT_ID) return null;

  const url = explorerUrl(CONTRACT_ID, NETWORK_NAME);

  return (
    <footer
      aria-label="Contract details"
      className="w-full max-w-lg mx-auto mt-6 mb-2 px-4"
    >
      <div className="rounded-xl bg-gray-900/60 border border-gray-800 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-gray-400">
        {/* Contract ID */}
        <div className="flex items-center gap-2 min-w-0">
          <span
            aria-hidden="true"
            className="text-gray-500 shrink-0"
            title="Smart contract"
          >
            {/* Contract icon */}
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className="w-4 h-4 text-blue-400/70"
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M4.25 2A2.25 2.25 0 002 4.25v11.5A2.25 2.25 0 004.25 18h11.5A2.25 2.25 0 0018 15.75V4.25A2.25 2.25 0 0015.75 2H4.25zM6.5 7.5a.75.75 0 011.5 0v5a.75.75 0 01-1.5 0v-5zm3.5-.75a.75.75 0 00-.75.75v5a.75.75 0 001.5 0v-5A.75.75 0 0010 6.75zm2.75.75a.75.75 0 011.5 0v5a.75.75 0 01-1.5 0v-5z"
                clipRule="evenodd"
              />
            </svg>
          </span>
          <span className="text-gray-500 shrink-0">Contract:</span>
          <span
            className="font-mono text-gray-300 truncate"
            title={CONTRACT_ID}
            aria-label={`Contract address: ${CONTRACT_ID}`}
          >
            {shortAddress(CONTRACT_ID)}
          </span>
        </div>

        {/* Explorer link */}
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`View contract ${CONTRACT_ID} on Stellar Expert ${NETWORK_NAME} explorer (opens in new tab)`}
          className="inline-flex items-center gap-1.5 shrink-0 text-blue-400 hover:text-blue-300
                     underline-offset-2 hover:underline transition-colors
                     focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400
                     focus-visible:ring-offset-2 focus-visible:ring-offset-gray-950 rounded"
        >
          {/* Stellar Expert logo-ish icon */}
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="w-3.5 h-3.5"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M4.25 5.5a.75.75 0 00-.75.75v8.5c0 .414.336.75.75.75h8.5a.75.75 0 00.75-.75v-4a.75.75 0 011.5 0v4A2.25 2.25 0 0112.75 17h-8.5A2.25 2.25 0 012 14.75v-8.5A2.25 2.25 0 014.25 4h5a.75.75 0 010 1.5h-5z"
              clipRule="evenodd"
            />
            <path
              fillRule="evenodd"
              d="M6.194 12.753a.75.75 0 001.06.053L16.5 4.44v2.81a.75.75 0 001.5 0v-4.5a.75.75 0 00-.75-.75h-4.5a.75.75 0 000 1.5h2.553l-9.056 8.194a.75.75 0 00-.053 1.06z"
              clipRule="evenodd"
            />
          </svg>
          View on Stellar Expert ({NETWORK_NAME})
        </a>
      </div>
    </footer>
  );
}
