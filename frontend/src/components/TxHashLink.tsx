"use client";

/**
 * TxHashLink.tsx
 *
 * Renders a transaction hash as a shortened, clickable link to Stellar Expert.
 *
 * Props:
 *   txHash   — full 64-character transaction hash
 *   network  — "testnet" | "mainnet"
 *
 * Output:
 *   An <a> tag showing the first 8 chars … last 8 chars of the hash,
 *   linking to https://stellar.expert/explorer/{network}/tx/{txHash}
 *   with target="_blank" rel="noopener noreferrer".
 */

export interface TxHashLinkProps {
  txHash: string;
  network: "testnet" | "mainnet";
}

export default function TxHashLink({ txHash, network }: TxHashLinkProps) {
  const explorerUrl = `https://stellar.expert/explorer/${network}/tx/${txHash}`;

  // Shorten the hash: first 8 chars … last 8 chars
  const shortened =
    txHash.length > 16
      ? `${txHash.slice(0, 8)}…${txHash.slice(-8)}`
      : txHash;

  return (
    <a
      href={explorerUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-blue-400 hover:text-blue-300 underline underline-offset-2
                 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded"
      aria-label={`View transaction ${txHash} on Stellar Expert`}
      title={txHash}
    >
      {shortened}
      {/* External link icon */}
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-3 w-3 flex-shrink-0"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden="true"
      >
        <path d="M11 3a1 1 0 100 2h2.586l-6.293 6.293a1 1 0 101.414 1.414L15 6.414V9a1 1 0 102 0V4a1 1 0 00-1-1h-5z" />
        <path d="M5 5a2 2 0 00-2 2v8a2 2 0 002 2h8a2 2 0 002-2v-3a1 1 0 10-2 0v3H5V7h3a1 1 0 000-2H5z" />
      </svg>
    </a>
  );
}
