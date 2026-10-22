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
 *
 * Also exports:
 *  - ContractLifecycleErrorCode — typed enum of transaction lifecycle phases
 *  - ContractLifecycleError    — typed Error subclass carrying a lifecycle phase
 *  - isContractLifecycleError  — type guard
 *  - lifecycleErrorMessage     — human-readable label per phase
 *
 * Issue #45 — Add a centralized error enum for backend failures
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

// ─── ContractLifecycleErrorCode enum ─────────────────────────────────────────

/**
 * Typed error codes covering every phase of the transaction lifecycle used by
 * the SorobanPay frontend and any backend indexer service.
 *
 * Phases in order:
 *   1. PREPARATION  — building the transaction, simulating against RPC
 *   2. SIGNING      — presenting the transaction to the wallet for user approval
 *   3. SUBMISSION   — broadcasting the signed transaction to the Soroban RPC
 *   4. CONFIRMATION — polling the RPC until the transaction is finalized
 *
 * Additional codes cover validation (input guards), contract-specific errors
 * (on-chain ContractError codes), and an explicit user-cancellation signal.
 *
 * UI consumers should switch on this enum rather than pattern-matching raw
 * error strings; the enum values are stable across releases.
 */
export const ContractLifecycleErrorCode = {
  // ── Transaction lifecycle phases ─────────────────────────────────────────

  /**
   * Failed to build or simulate the transaction before it was signed.
   * Common causes: invalid addresses, RPC simulation failure, insufficient
   * XLM for resource fees.
   */
  PREPARATION_FAILED: 'PREPARATION_FAILED',

  /**
   * The wallet rejected or failed to sign the transaction.
   * Includes both user-declined actions and technical signing failures.
   */
  SIGNING_FAILED: 'SIGNING_FAILED',

  /**
   * The signed transaction was rejected by the Soroban RPC node on submission.
   * Common causes: fee too low, malformed XDR, node errors.
   */
  SUBMISSION_FAILED: 'SUBMISSION_FAILED',

  /**
   * The transaction was submitted but did not reach SUCCESS or FAILED status
   * within the polling timeout window.
   */
  CONFIRMATION_TIMEOUT: 'CONFIRMATION_TIMEOUT',

  /**
   * The transaction was finalized but the on-chain execution result was FAILED
   * (i.e. the contract returned an error or the transaction was rejected
   * by ledger-level rules).
   */
  CONFIRMATION_FAILED: 'CONFIRMATION_FAILED',

  // ── User action ───────────────────────────────────────────────────────────

  /**
   * The user explicitly cancelled the transaction — typically by dismissing
   * the wallet signing popup.  Not a system error; no retry is needed unless
   * the user chooses to.
   */
  USER_CANCELLED: 'USER_CANCELLED',

  // ── Input validation ──────────────────────────────────────────────────────

  /**
   * One or more input parameters failed client-side validation before any
   * network call was made (e.g., invalid Stellar address format, amount = 0).
   */
  VALIDATION_ERROR: 'VALIDATION_ERROR',

  // ── On-chain contract error codes ─────────────────────────────────────────
  // These mirror contracts/subscription/src/error.rs ContractError variants.

  /** Contract error code 1 — subscribe called with amount ≤ 0 */
  AMOUNT_MUST_BE_POSITIVE: 'AMOUNT_MUST_BE_POSITIVE',
  /** Contract error code 2 — interval < 86400 s (1 day) */
  INTERVAL_TOO_SHORT: 'INTERVAL_TOO_SHORT',
  /** Contract error code 3 — interval > 31536000 s (365 days) */
  INTERVAL_TOO_LONG: 'INTERVAL_TOO_LONG',
  /** Contract error code 4 — no active subscription for the pair */
  NO_ACTIVE_SUBSCRIPTION: 'NO_ACTIVE_SUBSCRIPTION',
  /** Contract error code 5 — execute_payment called before next_payment */
  PAYMENT_NOT_DUE: 'PAYMENT_NOT_DUE',
  /** Contract error code 6 — authorization check failed */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Contract error code 7 — insufficient subscriber balance at payment time */
  TRANSFER_FAILED: 'TRANSFER_FAILED',
  /** Contract error code 8 — ledger timestamp is zero or overflows */
  INVALID_TIMESTAMP: 'INVALID_TIMESTAMP',
  /** Contract error code 9 — amount exceeds 10^18 */
  AMOUNT_TOO_LARGE: 'AMOUNT_TOO_LARGE',
  /** Contract error code 10 — subscriber == merchant */
  SELF_SUBSCRIPTION: 'SELF_SUBSCRIPTION',
  /** Contract error code 11 — token is the contract's own address */
  INVALID_TOKEN_ADDRESS: 'INVALID_TOKEN_ADDRESS',
  /** Contract error code 12 — payment attempted while subscription is paused */
  SUBSCRIPTION_PAUSED: 'SUBSCRIPTION_PAUSED',
  /** Contract error code 13 — batch_execute_payment called with empty list */
  EMPTY_BATCH: 'EMPTY_BATCH',
  /** Contract error code 14 — batch exceeds BATCH_MAX_SIZE (50) */
  BATCH_TOO_LARGE: 'BATCH_TOO_LARGE',
  /** Contract error code 15 — strict mode: allowance < amount */
  INSUFFICIENT_ALLOWANCE: 'INSUFFICIENT_ALLOWANCE',
  /** Contract error code 16 — contract already at current schema version */
  ALREADY_MIGRATED: 'ALREADY_MIGRATED',
  /** Contract error code 17 — caller is not the admin */
  NOT_ADMIN: 'NOT_ADMIN',
  /** Contract error code 18 — amount exceeds admin-configured cap */
  AMOUNT_EXCEEDS_LIMIT: 'AMOUNT_EXCEEDS_LIMIT',
  /** Contract error code 19 — grace period has not expired yet */
  GRACE_PERIOD_ACTIVE: 'GRACE_PERIOD_ACTIVE',

  // ── Network / infrastructure ──────────────────────────────────────────────

  /** Soroban RPC node returned an error or is unreachable */
  RPC_ERROR: 'RPC_ERROR',
  /** Wrong Stellar network selected in the wallet */
  WRONG_NETWORK: 'WRONG_NETWORK',

  // ── Catch-all ─────────────────────────────────────────────────────────────

  /** Unknown / unclassified error that does not fit any specific category */
  UNKNOWN: 'UNKNOWN',
} as const;

/** Union type of all ContractLifecycleErrorCode values */
export type ContractLifecycleErrorCode =
  (typeof ContractLifecycleErrorCode)[keyof typeof ContractLifecycleErrorCode];

// ─── Human-readable labels ────────────────────────────────────────────────────

/**
 * Short human-readable label for each {@link ContractLifecycleErrorCode}.
 * Suitable for toast notifications, error cards, and logging.
 */
export const lifecycleErrorMessage: Record<ContractLifecycleErrorCode, string> = {
  PREPARATION_FAILED:     'Transaction preparation failed',
  SIGNING_FAILED:         'Transaction signing failed',
  SUBMISSION_FAILED:      'Transaction submission failed',
  CONFIRMATION_TIMEOUT:   'Transaction confirmation timed out',
  CONFIRMATION_FAILED:    'Transaction confirmed as failed',
  USER_CANCELLED:         'Transaction cancelled by user',
  VALIDATION_ERROR:       'Input validation failed',

  AMOUNT_MUST_BE_POSITIVE: 'Amount must be greater than zero',
  INTERVAL_TOO_SHORT:      'Payment interval is too short (minimum 1 day)',
  INTERVAL_TOO_LONG:       'Payment interval is too long (maximum 365 days)',
  NO_ACTIVE_SUBSCRIPTION:  'No active subscription found',
  PAYMENT_NOT_DUE:         'Payment is not due yet',
  UNAUTHORIZED:            'Authorization failed',
  TRANSFER_FAILED:         'Token transfer failed (insufficient balance)',
  INVALID_TIMESTAMP:       'Invalid ledger timestamp',
  AMOUNT_TOO_LARGE:        'Amount exceeds the maximum allowed value',
  SELF_SUBSCRIPTION:       'Cannot subscribe to yourself',
  INVALID_TOKEN_ADDRESS:   'Invalid token contract address',
  SUBSCRIPTION_PAUSED:     'Subscription is currently paused',
  EMPTY_BATCH:             'Batch subscriber list is empty',
  BATCH_TOO_LARGE:         'Batch exceeds maximum size of 50',
  INSUFFICIENT_ALLOWANCE:  'Token allowance is below the required amount',
  ALREADY_MIGRATED:        'Contract is already at the current schema version',
  NOT_ADMIN:               'Caller is not the contract admin',
  AMOUNT_EXCEEDS_LIMIT:    'Amount exceeds the admin-configured limit',
  GRACE_PERIOD_ACTIVE:     'Grace period has not yet expired',

  RPC_ERROR:     'Soroban RPC error',
  WRONG_NETWORK: 'Wrong Stellar network',
  UNKNOWN:       'An unexpected error occurred',
};

// ─── ContractLifecycleError class ─────────────────────────────────────────────

/**
 * Typed Error subclass that carries a {@link ContractLifecycleErrorCode}.
 *
 * Use this when throwing errors from the transaction builder or backend
 * services so that UI consumers can switch on a stable code rather than
 * pattern-matching raw error strings.
 *
 * @example
 * ```ts
 * throw new ContractLifecycleError(
 *   ContractLifecycleErrorCode.PREPARATION_FAILED,
 *   `Transaction preparation failed: ${originalError.message}`,
 *   originalError,
 * );
 * ```
 */
export class ContractLifecycleError extends Error {
  /** Stable lifecycle phase / error code for programmatic handling */
  readonly code: ContractLifecycleErrorCode;
  /** Original error that triggered this lifecycle error, if any */
  readonly cause?: unknown;

  constructor(code: ContractLifecycleErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ContractLifecycleError';
    this.code = code;
    this.cause = cause;

    // Maintain correct prototype chain in environments that transpile classes
    Object.setPrototypeOf(this, ContractLifecycleError.prototype);
  }

  /**
   * Short human-readable label for this error's code.
   * Equivalent to `lifecycleErrorMessage[this.code]`.
   */
  get label(): string {
    return lifecycleErrorMessage[this.code];
  }
}

// ─── Type guard ───────────────────────────────────────────────────────────────

/**
 * Type guard: returns `true` if `err` is a {@link ContractLifecycleError}.
 *
 * @example
 * ```ts
 * try {
 *   await buildAndSubmitSubscribe(...);
 * } catch (err) {
 *   if (isContractLifecycleError(err)) {
 *     switch (err.code) {
 *       case ContractLifecycleErrorCode.USER_CANCELLED: return; // silent
 *       case ContractLifecycleErrorCode.PREPARATION_FAILED: ...
 *     }
 *   }
 * }
 * ```
 */
export function isContractLifecycleError(err: unknown): err is ContractLifecycleError {
  return err instanceof ContractLifecycleError;
}

/**
 * Map a {@link ContractLifecycleErrorCode} to a {@link MappedError} suitable
 * for the toast / error card system.  Falls back to mapError() for non-lifecycle
 * errors so callers do not need to branch.
 */
export function mapLifecycleError(err: unknown): MappedError {
  if (!isContractLifecycleError(err)) {
    return mapError(err);
  }

  // Return a richer MappedError from the existing CONTRACT_ERROR_MAP where
  // we have a direct mapping, otherwise build one from the lifecycle label.
  const code = err.code;

  // Map lifecycle codes that directly correspond to contract error codes
  const CONTRACT_CODE_MAP: Partial<Record<ContractLifecycleErrorCode, number>> = {
    AMOUNT_MUST_BE_POSITIVE: 1,
    INTERVAL_TOO_SHORT:      2,
    INTERVAL_TOO_LONG:       3,
    NO_ACTIVE_SUBSCRIPTION:  4,
    PAYMENT_NOT_DUE:         5,
    UNAUTHORIZED:            6,
    TRANSFER_FAILED:         7,
    INVALID_TIMESTAMP:       8,
    AMOUNT_TOO_LARGE:        9,
    SELF_SUBSCRIPTION:       10,
    INVALID_TOKEN_ADDRESS:   11,
  };

  const contractCode = CONTRACT_CODE_MAP[code];
  if (contractCode !== undefined) {
    // Re-use the existing rich message from mapError by synthesising a
    // contract-code string that its regex will match.
    return mapError(new Error(`Contract error: ${contractCode}`));
  }

  return {
    message: err.message || lifecycleErrorMessage[code],
    action: getActionForCode(code),
    docsUrl: getDocsUrlForCode(code),
  };
}

function getActionForCode(code: ContractLifecycleErrorCode): string {
  switch (code) {
    case 'PREPARATION_FAILED':
      return 'Check your inputs and ensure your wallet has enough XLM for fees, then retry.';
    case 'SIGNING_FAILED':
      return 'Re-submit the form and approve the transaction in your wallet.';
    case 'SUBMISSION_FAILED':
      return 'Check your internet connection and the RPC endpoint, then retry.';
    case 'CONFIRMATION_TIMEOUT':
      return 'The transaction may still confirm. Wait a moment before retrying.';
    case 'CONFIRMATION_FAILED':
      return 'Review the transaction details and try again.';
    case 'USER_CANCELLED':
      return 'Re-submit and approve the transaction in your wallet when prompted.';
    case 'VALIDATION_ERROR':
      return 'Correct the highlighted form fields and resubmit.';
    case 'TRANSFER_FAILED':
      return 'Top up your wallet balance and retry.';
    case 'INSUFFICIENT_ALLOWANCE':
      return 'Approve a higher token allowance for the contract and retry.';
    case 'RPC_ERROR':
      return 'Check your RPC URL configuration and network connection, then retry.';
    case 'WRONG_NETWORK':
      return 'Open your wallet and switch to the correct Stellar network, then retry.';
    default:
      return 'Please try again. If the problem persists, check the browser console for details.';
  }
}

function getDocsUrlForCode(code: ContractLifecycleErrorCode): string | undefined {
  switch (code) {
    case 'TRANSFER_FAILED':
    case 'INSUFFICIENT_ALLOWANCE':
      return 'https://laboratory.stellar.org/#account-creator?network=test';
    case 'WRONG_NETWORK':
    case 'RPC_ERROR':
    case 'SUBMISSION_FAILED':
      return 'https://github.com/Chrisland58/SorobanPay#troubleshooting';
    default:
      return undefined;
  }
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
      action:
        'The transaction may still confirm — check the explorer link for the current status. Your form data has been preserved.',
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

  // 1. Try to extract a contract error code from various message formats:
  //    - "contract error: 7"
  //    - "Error(Contract, #7)"
  //    - "ContractError(7)"
  //    - "contract error #7" (emitted by useTransactionPoller extractFailureMessage)
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

// ─── Unified Error Language (UX-114) ──────────────────────────────────────────

export interface UnifiedErrorPresentation {
  title: string;
  message: string;
  action: string;
  docsUrl?: string;
}

/**
 * Normalizes error phrasing so inline alert banners and toast notifications
 * present identical user-facing explanations and actionable recovery instructions.
 */
export function formatUnifiedError(err: unknown): UnifiedErrorPresentation {
  const mapped = isContractLifecycleError(err)
    ? mapLifecycleError(err)
    : mapError(err);

  return {
    title: 'Action required',
    message: mapped.message,
    action: mapped.action,
    docsUrl: mapped.docsUrl,
  };
}

/** Format error suitable for inline alert banner components */
export function formatInlineError(err: unknown): { title: string; body: string; action: string; docsUrl?: string } {
  const unified = formatUnifiedError(err);
  return {
    title: unified.title,
    body: unified.message,
    action: unified.action,
    docsUrl: unified.docsUrl,
  };
}

/** Format error suitable for toast notifications */
export function formatToastError(err: unknown): { title: string; message: string; action: string; docsUrl?: string } {
  const unified = formatUnifiedError(err);
  return {
    title: unified.title,
    message: unified.message,
    action: unified.action,
    docsUrl: unified.docsUrl,
  };
}

