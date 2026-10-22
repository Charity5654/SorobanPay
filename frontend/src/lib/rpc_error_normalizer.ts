/**
 * rpc_error_normalizer.ts
 *
 * Normalizes every Soroban RPC error shape — contract errors, RPC-layer
 * failures, Freighter signing rejections, and network faults — into a
 * single structured `NormalizedRpcError` used by both the frontend UI
 * (SubscriptionForm) and the transaction layer (transaction_builder).
 *
 * ## Error taxonomy
 *
 * | Category          | Source / pattern                                    |
 * |-------------------|-----------------------------------------------------|
 * | Contract errors   | `error(contract, #N)` or contract error name in msg |
 * | Simulation errors | `Transaction preparation failed`                    |
 * | Submission errors | `Transaction submission failed`                     |
 * | Polling timeout   | `confirmation timeout`                              |
 * | On-chain failure  | `Transaction failed on-chain`                       |
 * | Freighter signing | `user declined` / `rejected` / `signing failed`     |
 * | Wrong network     | `passphrase` / `network mismatch` / `wrong network` |
 * | Insufficient funds| `insufficient balance` / `not enough` / `underfunded`|
 * | Token allowance   | `allowance` / `transfer from` / `spend limit`       |
 * | Network / fetch   | `fetch` / `network` / `failed to fetch` / `rpc`     |
 * | Unknown           | anything else                                       |
 */

// ─── Public types ─────────────────────────────────────────────────────────────

/**
 * Canonical error categories emitted by the normalizer.
 *
 * Use `category` for programmatic branching (e.g. deciding whether to
 * re-enable the submit button immediately vs. prompting the user to act).
 */
export type RpcErrorCategory =
  | 'contract_error'       // on-chain ContractError (known code or name)
  | 'simulation_failed'    // prepareTransaction / simulation rejected
  | 'submission_failed'    // sendTransaction returned ERROR status
  | 'onchain_failed'       // transaction confirmed but returned FAILED status
  | 'confirmation_timeout' // polling timed out — tx may still confirm
  | 'signing_rejected'     // Freighter popup dismissed or declined
  | 'wrong_network'        // Freighter / app network passphrase mismatch
  | 'insufficient_funds'   // subscriber XLM or token balance too low
  | 'allowance_too_low'    // token allowance for contract is insufficient
  | 'network_error'        // fetch / RPC connection failure
  | 'unknown';             // catch-all

/**
 * Structured error produced by `normalizeRpcError`.
 *
 * All fields are safe to display in the UI.  Sensitive technical detail is
 * isolated in `rawMessage`, which is only shown in the "technical details"
 * collapsed section.
 */
export interface NormalizedRpcError {
  /** Machine-readable category for switch/if branching in UI and retry logic. */
  category: RpcErrorCategory;

  /**
   * Short, user-facing title.
   * Example: "Signing cancelled"
   */
  title: string;

  /**
   * One-sentence explanation of what happened.
   * Example: "The Freighter pop-up was dismissed."
   */
  summary: string;

  /**
   * Actionable step the user can take to resolve or retry.
   * May include code snippets or references to UI controls.
   */
  action: string;

  /**
   * When true the same inputs can be resubmitted without modification.
   * When false the user needs to change something before retrying.
   *
   * Used by the form to decide whether to show a "Retry" shortcut.
   */
  retryable: boolean;

  /**
   * When this is a known contract error, the numeric code (1–17).
   * Undefined for non-contract errors.
   */
  contractCode?: number;

  /**
   * The raw error message as a string.
   * Shown collapsed in the "technical details" section.
   */
  rawMessage: string;
}

// ─── Contract error code map ──────────────────────────────────────────────────

/**
 * Complete mapping of every ContractError code defined in
 * `contracts/subscription/src/error.rs` (codes 1–17).
 */
interface ContractErrorDef {
  title: string;
  summary: string;
  action: string;
  retryable: boolean;
}

const CONTRACT_ERROR_DEFS: Record<number, ContractErrorDef> = {
  1: {
    title: 'Invalid amount',
    summary: 'The contract rejected the amount — it must be greater than zero.',
    action: 'Enter a positive integer amount and resubmit.',
    retryable: false,
  },
  2: {
    title: 'Interval too short',
    summary:
      'The payment interval is below the 1-day minimum (86 400 seconds).',
    action:
      'Enter an interval of at least 86 400 seconds (1 day).',
    retryable: false,
  },
  3: {
    title: 'Interval too long',
    summary:
      'The payment interval exceeds the 1-year maximum (31 536 000 seconds).',
    action:
      'Enter an interval of at most 31 536 000 seconds (365 days).',
    retryable: false,
  },
  4: {
    title: 'No active subscription',
    summary:
      'No subscription was found for this subscriber / merchant pair.',
    action:
      'Check that the correct merchant address is entered, or create a new subscription.',
    retryable: false,
  },
  5: {
    title: 'Payment not due yet',
    summary:
      'The payment interval has not elapsed since the last collection.',
    action:
      'Wait until the next scheduled payment date before retrying.',
    retryable: false,
  },
  6: {
    title: 'Authorisation failed',
    summary: 'The contract rejected the transaction signature.',
    action:
      'Ensure the connected Freighter account matches the subscriber address and retry.',
    retryable: true,
  },
  7: {
    title: 'Transfer failed',
    summary:
      'The subscriber has insufficient token balance to cover this payment.',
    action:
      'Top up your token balance then retry.',
    retryable: false,
  },
  8: {
    title: 'Invalid timestamp',
    summary:
      'The ledger timestamp is zero or would overflow when computing the next payment date.',
    action:
      'This is a temporary chain condition. Retry in a few seconds.',
    retryable: true,
  },
  9: {
    title: 'Amount too large',
    summary:
      'The requested amount exceeds the contract maximum of 10¹⁸ token units.',
    action:
      'Enter a smaller amount and resubmit.',
    retryable: false,
  },
  10: {
    title: 'Self-subscription not allowed',
    summary: 'The subscriber and merchant addresses must be different accounts.',
    action: 'Use a different merchant address.',
    retryable: false,
  },
  11: {
    title: 'Invalid token address',
    summary:
      'The token address must not be the SorobanPay contract address itself.',
    action: 'Enter the correct SEP-41 token contract address.',
    retryable: false,
  },
  12: {
    title: 'Empty batch',
    summary:
      'batch_execute_payment was called with no subscribers.',
    action: 'Provide at least one subscriber address in the batch.',
    retryable: false,
  },
  13: {
    title: 'Batch too large',
    summary:
      'batch_execute_payment supports at most 50 subscribers per call.',
    action: 'Split the batch into chunks of 50 or fewer and retry each.',
    retryable: false,
  },
  14: {
    title: 'Insufficient allowance',
    summary:
      'The SEP-41 token allowance granted to this contract is below the subscription amount.',
    action:
      'Approve a higher token allowance by calling token.approve(contract_id, amount) before subscribing.',
    retryable: false,
  },
  15: {
    title: 'Contract already migrated',
    summary: 'The contract schema is already at the latest version.',
    action: 'No migration is needed.',
    retryable: false,
  },
  16: {
    title: 'Not admin',
    summary: 'Only the stored admin address may call migrate().',
    action: 'Sign with the admin account.',
    retryable: false,
  },
  17: {
    title: 'Contract not initialized',
    summary: 'The contract admin has not been set — initialize() must be called first.',
    action: 'Deploy or re-initialize the contract before use.',
    retryable: false,
  },
};

// ─── Contract error name → code map ──────────────────────────────────────────

/**
 * Allows matching error *names* as they appear in stringified SDK errors,
 * e.g. `"AmountMustBePositive"` or `"intervaltoo"` (lowercased substring).
 */
const CONTRACT_ERROR_NAME_MAP: Array<[RegExp, number]> = [
  [/amountmustbepositive/i,    1],
  [/intervaltoo\s*short/i,     2],
  [/intervaltoo\s*long/i,      3],
  [/intervaltoo/i,             2], // fallback when "short"/"long" absent
  [/noactivesubscription/i,    4],
  [/paymentnotdue/i,           5],
  [/\bunauthorized\b/i,        6],
  [/transferfailed/i,          7],
  [/invalidtimestamp/i,        8],
  [/amounttoolarge/i,          9],
  [/selfsubscription/i,        10],
  [/invalidtokenaddress/i,     11],
  [/emptybatch/i,              12],
  [/batchtoolarge/i,           13],
  [/insufficientallowance/i,   14],
  [/alreadymigrated/i,         15],
  [/notadmin/i,                16],
  [/notinitialized/i,          17],
];

// ─── Numeric code extraction ──────────────────────────────────────────────────

/**
 * Try to extract `N` from patterns like:
 *   - `error(contract, #N)`
 *   - `HostError: contract error #N`
 *   - `contract error code N`
 */
function extractContractCode(msg: string): number | undefined {
  const patterns = [
    /error\s*\(\s*contract\s*,\s*#(\d+)\s*\)/i,
    /contract\s+error\s+#(\d+)/i,
    /contract\s+error\s+code\s+(\d+)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(msg);
    if (m) {
      const code = parseInt(m[1], 10);
      if (code >= 1 && code <= 17) return code;
    }
  }
  return undefined;
}

// ─── Public normalizer ────────────────────────────────────────────────────────

/**
 * Convert any thrown value from the Soroban transaction pipeline into a
 * `NormalizedRpcError`.
 *
 * Pass the caught value directly — the function handles `Error` objects,
 * plain strings, and anything else.
 *
 * @example
 * ```ts
 * try {
 *   await buildAndSubmitSubscribe(…);
 * } catch (err) {
 *   const normalized = normalizeRpcError(err);
 *   // normalized.category, .title, .summary, .action, .retryable
 * }
 * ```
 */
export function normalizeRpcError(err: unknown): NormalizedRpcError {
  const rawMessage =
    err instanceof Error ? err.message : String(err ?? 'Unknown error');
  const msg = rawMessage.toLowerCase();

  // ── 1. Contract error by numeric code (highest-priority — most precise) ─────
  const contractCode = extractContractCode(rawMessage);
  if (contractCode !== undefined) {
    const def = CONTRACT_ERROR_DEFS[contractCode];
    if (def) {
      return {
        category: 'contract_error',
        contractCode,
        rawMessage,
        ...def,
      };
    }
  }

  // ── 2. Contract error by name ─────────────────────────────────────────────
  for (const [re, code] of CONTRACT_ERROR_NAME_MAP) {
    if (re.test(rawMessage)) {
      const def = CONTRACT_ERROR_DEFS[code];
      if (def) {
        return {
          category: 'contract_error',
          contractCode: code,
          rawMessage,
          ...def,
        };
      }
    }
  }

  // ── 3. Freighter signing rejection ────────────────────────────────────────
  if (
    msg.includes('user declined') ||
    msg.includes('user rejected') ||
    msg.includes('signing failed') ||
    msg.includes('rejected') // generic Freighter rejection
  ) {
    return {
      category: 'signing_rejected',
      title: 'Signing cancelled',
      summary:
        'The Freighter pop-up was dismissed or the signing request was rejected.',
      action:
        'Click "Authorize Subscription" again and approve the transaction in the Freighter pop-up. To use a different account, switch accounts in Freighter first.',
      retryable: true,
      rawMessage,
    };
  }

  // ── 4. Wrong network ──────────────────────────────────────────────────────
  if (
    msg.includes('wrong network') ||
    msg.includes('network mismatch') ||
    msg.includes('passphrase')
  ) {
    return {
      category: 'wrong_network',
      title: 'Wrong network',
      summary:
        'Freighter is configured for a different network than the app expects.',
      action:
        'Open Freighter, click the network selector, and switch to the network that matches NEXT_PUBLIC_NETWORK_PASSPHRASE in your .env.local, then retry.',
      retryable: true,
      rawMessage,
    };
  }

  // ── 5. Simulation failure (transaction_builder prepareTransaction) ─────────
  if (msg.includes('transaction preparation failed')) {
    return {
      category: 'simulation_failed',
      title: 'Simulation failed',
      summary:
        'The Soroban RPC could not simulate the transaction or inject resource fees.',
      action:
        'Check that the contract address and network are correct. If the problem persists, the RPC node may be congested — retry in a moment.',
      retryable: true,
      rawMessage,
    };
  }

  // ── 6. Submission failure (transaction_builder sendTransaction ERROR) ──────
  if (msg.includes('transaction submission failed')) {
    return {
      category: 'submission_failed',
      title: 'Transaction submission failed',
      summary:
        'The Soroban RPC rejected the transaction envelope at submission time.',
      action:
        'This is often a transient RPC issue. Retry the transaction. If it persists, inspect the XDR in the technical details for a specific cause.',
      retryable: true,
      rawMessage,
    };
  }

  // ── 7. On-chain failure (polling found FAILED status) ─────────────────────
  if (msg.includes('transaction failed on-chain')) {
    return {
      category: 'onchain_failed',
      title: 'Transaction failed on-chain',
      summary:
        'The transaction was included in the ledger but the contract invocation reverted.',
      action:
        'Inspect the result meta XDR in the technical details to identify the contract error, then correct the inputs.',
      retryable: false,
      rawMessage,
    };
  }

  // ── 8. Polling timeout ────────────────────────────────────────────────────
  if (
    msg.includes('confirmation timeout') ||
    msg.includes('timed out') ||
    msg.includes('timeout')
  ) {
    return {
      category: 'confirmation_timeout',
      title: 'Transaction timed out',
      summary:
        'The network did not confirm the transaction within the expected window.',
      action:
        'The transaction may still confirm — wait a minute before resubmitting to avoid a duplicate. You can look up the transaction hash in Stellar Expert to check its status.',
      retryable: true,
      rawMessage,
    };
  }

  // ── 9. Insufficient balance ───────────────────────────────────────────────
  if (
    msg.includes('insufficient balance') ||
    msg.includes('not enough') ||
    msg.includes('underfunded')
  ) {
    return {
      category: 'insufficient_funds',
      title: 'Insufficient balance',
      summary:
        'Your wallet does not have enough tokens or XLM to cover this transaction.',
      action:
        'Top up your account. On testnet use Stellar Friendbot; on mainnet transfer XLM or the relevant token to your address.',
      retryable: false,
      rawMessage,
    };
  }

  // ── 10. Token allowance ───────────────────────────────────────────────────
  if (
    msg.includes('allowance') ||
    msg.includes('transfer from') ||
    msg.includes('spend limit')
  ) {
    return {
      category: 'allowance_too_low',
      title: 'Token allowance too low',
      summary:
        'The contract is not authorized to transfer this token amount on your behalf.',
      action:
        'Approve a higher token allowance: call token.approve(contract_id, amount) from your wallet before subscribing.',
      retryable: false,
      rawMessage,
    };
  }

  // ── 11. Network / fetch error ─────────────────────────────────────────────
  if (
    msg.includes('failed to fetch') ||
    msg.includes('network request failed') ||
    msg.includes('fetch error') ||
    msg.includes('networkerror') ||
    (msg.includes('fetch') && !msg.includes('freighter')) ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('rpc')
  ) {
    return {
      category: 'network_error',
      title: 'Network error',
      summary: 'Could not reach the Soroban RPC endpoint.',
      action:
        'Check your internet connection and verify NEXT_PUBLIC_RPC_URL in .env.local. Retry in a moment.',
      retryable: true,
      rawMessage,
    };
  }

  // ── 12. Unknown / catch-all ───────────────────────────────────────────────
  return {
    category: 'unknown',
    title: 'Transaction failed',
    summary: 'An unexpected error occurred while submitting the transaction.',
    action:
      'Review the technical details below and retry. If the problem persists, consult the README troubleshooting section.',
    retryable: true,
    rawMessage,
  };
}
