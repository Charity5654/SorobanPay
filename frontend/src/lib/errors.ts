/**
 * errors.ts
 *
 * Human-readable error mapping for SorobanPay.
 *
 * Maps raw contract error codes, RPC errors, and Freighter errors to:
 *  - A user-facing message
 *  - A suggested action
 *  - An optional doc link
 *
 * Coverage:
 *  - All 11 on-chain contract errors (codes 1–11)
 *  - User declined / Freighter errors
 *  - RPC timeout / network errors
 *  - Wrong network errors
 *  - Generic fallback
 */

// ─── Types ────────────────────────────────────────────────────────────────────

export interface MappedError {
  /** Short, human-readable description of what went wrong */
  message: string;
  /** Actionable guidance on what the user should do next */
  action: string;
  /** Optional link to troubleshooting documentation */
  docsUrl?: string;
}

// ─── Contract error code → description ───────────────────────────────────────

const CONTRACT_ERROR_MAP: Record<number, MappedError> = {
  1: {
    message: 'The payment amount must be greater than zero.',
    action: 'Enter a positive amount and try again.',
  },
  2: {
    message: 'The payment interval is too short (minimum is 1 day).',
    action: 'Set the interval to at least 86,400 seconds (1 day).',
  },
  3: {
    message: 'The payment interval is too long (maximum is 365 days).',
    action: 'Set the interval to at most 31,536,000 seconds (365 days).',
  },
  4: {
    message: 'No active subscription was found for this pair.',
    action: 'Create a new subscription before trying to execute a payment.',
  },
  5: {
    message: 'This payment isn\'t due yet.',
    action: 'Wait until the next scheduled payment date and try again.',
  },
  6: {
    message: 'Authorization failed — you are not permitted to perform this action.',
    action: 'Make sure you are connected with the correct wallet and try again.',
  },
  7: {
    message: 'Your token balance is too low to complete this payment.',
    action: 'Top up your wallet and try again.',
    docsUrl: 'https://laboratory.stellar.org/#account-creator?network=test',
  },
  8: {
    message: 'Invalid ledger timestamp detected.',
    action: 'This may be a temporary network issue. Wait a moment and try again.',
  },
  9: {
    message: 'The amount entered is too large.',
    action: 'Enter an amount less than 10¹⁸ tokens.',
  },
  10: {
    message: 'You cannot subscribe to yourself.',
    action: 'Enter a merchant address that is different from your own wallet address.',
  },
  11: {
    message: 'Invalid token address — the token cannot be the SorobanPay contract itself.',
    action: 'Enter the address of the token contract (e.g. a USDC or XLM wrapped contract).',
  },
};

// ─── Keyword patterns for non-contract errors ─────────────────────────────────

interface PatternRule {
  pattern: RegExp;
  mapped: MappedError;
}

const PATTERN_RULES: PatternRule[] = [
  // User declined in Freighter
  {
    pattern: /user (declined|rejected|cancelled|dismissed|denied)/i,
    mapped: {
      message: 'You cancelled the transaction in Freighter.',
      action: 'Re-submit the form and approve the transaction when Freighter prompts you.',
    },
  },
  // Wrong network
  {
    pattern: /wrong network|network mismatch|passphrase/i,
    mapped: {
      message: 'Freighter is connected to the wrong network.',
      action: 'Open Freighter, click the network selector, and switch to the correct network (Testnet or Mainnet) to match the app.',
    },
  },
  // RPC timeout / slow network
  {
    pattern: /timeout|timed out|confirmation timeout/i,
    mapped: {
      message: 'The network is slow or the transaction timed out.',
      action: 'Wait a moment and try again. Your form data has been preserved.',
    },
  },
  // RPC 5xx / service unavailable
  {
    pattern: /503|502|504|service unavailable|bad gateway|temporarily unavailable/i,
    mapped: {
      message: 'The Soroban RPC endpoint is temporarily unavailable.',
      action: 'Wait a moment and try again. If this persists, check the Stellar network status.',
      docsUrl: 'https://status.stellar.org',
    },
  },
  // Connection / fetch failure
  {
    pattern: /failed to fetch|network error|networkerror|econnrefused|socket/i,
    mapped: {
      message: 'Could not connect to the network.',
      action: 'Check your internet connection and try again.',
    },
  },
  // Transaction preparation / simulation failure
  {
    pattern: /transaction preparation failed|simulation failed/i,
    mapped: {
      message: 'Transaction simulation failed before signing.',
      action: 'Review your inputs and try again. Ensure your wallet has enough XLM for fees.',
    },
  },
  // Insufficient balance catch-all
  {
    pattern: /insufficient (balance|funds)/i,
    mapped: {
      message: 'Your wallet does not have enough balance.',
      action: 'Top up your wallet and retry.',
      docsUrl: 'https://laboratory.stellar.org/#account-creator?network=test',
    },
  },
  // Invalid address
  {
    pattern: /invalid (subscriber|merchant|token|address)/i,
    mapped: {
      message: 'One or more addresses are invalid.',
      action: 'Double-check the merchant address and token contract address.',
    },
  },
  // Freighter not installed
  {
    pattern: /freighter (is )?not (installed|found|available|detected)/i,
    mapped: {
      message: 'Freighter wallet is not installed or not detected.',
      action: 'Install the Freighter browser extension and reload the page.',
      docsUrl: 'https://www.freighter.app',
    },
  },
];

// ─── Fallback ─────────────────────────────────────────────────────────────────

const FALLBACK_ERROR: MappedError = {
  message: 'An unexpected error occurred.',
  action: 'Please try again. If the problem persists, check the browser console for details.',
  docsUrl: 'https://github.com/Chrisland58/SorobanPay#troubleshooting',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Map any thrown error value to a user-friendly MappedError.
 *
 * Handles:
 *  1. Contract errors with numeric codes embedded in the message
 *  2. Known keyword patterns (user declined, timeouts, RPC failures, …)
 *  3. Generic fallback
 */
export function mapError(err: unknown): MappedError {
  const raw = err instanceof Error ? err.message : String(err);

  // 1. Try to extract a contract error code (e.g. "Contract error: 7" or "Error(Contract, #7)")
  const contractCodeMatch = raw.match(
    /contract\s+error[:\s#]+(\d+)|Error\(Contract,\s*#(\d+)\)|ContractError\((\d+)\)/i,
  );
  if (contractCodeMatch) {
    const code = parseInt(
      contractCodeMatch[1] ?? contractCodeMatch[2] ?? contractCodeMatch[3],
      10,
    );
    const mapped = CONTRACT_ERROR_MAP[code];
    if (mapped) return mapped;
  }

  // 2. Pattern-match the raw message string
  for (const rule of PATTERN_RULES) {
    if (rule.pattern.test(raw)) {
      return rule.mapped;
    }
  }

  // 3. Fallback — include the raw message so developers can diagnose
  return {
    ...FALLBACK_ERROR,
    message: raw.length > 0 ? raw : FALLBACK_ERROR.message,
  };
}
