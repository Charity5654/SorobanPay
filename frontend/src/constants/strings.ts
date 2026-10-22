/**
 * strings.ts
 *
 * Issue #1152 – Extract localized core strings
 *
 * Central registry of all user-facing UI copy for SorobanPay.
 *
 * Design decisions:
 *  - Flat namespace organized by UI region — avoids deep nesting while
 *    keeping related strings co-located.
 *  - Every string is a plain string constant (no template literals at
 *    definition time) so it can be replaced by an i18n library later
 *    (e.g., react-i18next) with minimal diff.
 *  - Parametric strings are exported as functions that accept a plain
 *    object — e.g., `UI_STRINGS.interval.days({ days: 30 })`.
 *  - The `LOCALE` export signals the active locale; currently "en-US" only.
 *
 * Adding a new locale:
 *   1. Copy this file to `strings.es.ts` (or similar).
 *   2. Export the same `UI_STRINGS` shape with translated values.
 *   3. Import the correct file based on the user's locale preference.
 */

// ─── Active locale identifier ─────────────────────────────────────────────────

export const LOCALE = "en-US" as const;

// ─── String catalogue ─────────────────────────────────────────────────────────

export const UI_STRINGS = {
  // ── Page-level ───────────────────────────────────────────────────────────
  page: {
    title: "SorobanPay",
    subtitle: "Decentralized recurring payments on Stellar",
  },

  // ── Wallet connection ─────────────────────────────────────────────────────
  wallet: {
    connected: "Connected",
    disconnected: "Disconnected",
    connecting: "Connecting…",
    connect: "Connect Freighter Wallet",
    disconnect: "Disconnect",
    sessionLostTitle: "Wallet session lost",
    sessionLostBody:
      "Freighter is no longer available. Disconnect and reconnect to restore your session.",
    sessionLostAction: "Disconnect & reconnect",
    notInstalledAlert:
      "Freighter wallet is not installed.",
    notInstalledLink: "Install Freighter",
    connectedPrefix: "Connected:",
    copyKeyLabel: (publicKey: string) => `Copy full public key: ${publicKey}`,
  },

  // ── Freighter detection (inside SubscriptionForm) ─────────────────────────
  freighter: {
    notDetectedTitle: "Freighter wallet not detected",
    notDetectedBody:
      "Install the Freighter browser extension to create subscriptions.",
    installLink: "Install Freighter",
  },

  // ── Form ─────────────────────────────────────────────────────────────────
  form: {
    heading: "Create Subscription",
    description:
      "Authorize a recurring on-chain payment using your Freighter wallet.",
    contractLabel: "Contract",

    merchantLabel: "Merchant address",
    merchantPlaceholder: "GABC…",
    merchantRequired: "(required)",

    tokenLabel: "Token contract address",
    tokenPlaceholder: "CABC…",
    tokenRequired: "(required)",

    amountLabel: "Amount",
    amountUnit: "(token units)",
    amountRequired: "(required)",
    amountHelp:
      "Whole token units per payment cycle. Each unit equals the token's smallest indivisible unit (stroops for XLM, 1×10⁻⁷). Examples: 10 ≈ 10 USDC, 500 ≈ 500 USDC. Must be a positive integer.",

    intervalLabel: "Interval",
    intervalUnit: "(seconds)",
    intervalRequired: "(required)",
    intervalHelp:
      "Time between each payment, in seconds. Common values: 86 400 = 1 day, 604 800 = 1 week, 2 592 000 = 30 days (default), 31 536 000 = 1 year (maximum).",

    submitIdle: "Authorize Subscription",
    submitBusy: "Submitting…",
    walletHint: "Connect your Freighter wallet to enable submission.",
  },

  // ── Confirmation modal ────────────────────────────────────────────────────
  confirm: {
    heading: "Confirm subscription",
    description:
      "Review the details before authorizing the on-chain transaction.",
    labelMerchant: "Merchant",
    labelToken: "Token",
    labelAmount: "Amount",
    labelInterval: "Interval",
    goBack: "Go Back",
    confirm: "Confirm & Authorize",
  },

  // ── Progress indicator ────────────────────────────────────────────────────
  progress: {
    ariaLabel: "Transaction in progress",
    submitting: "Submitting transaction…",
    processing: "Processing on blockchain",
    patience: "This may take 10-30 seconds. Keep the window open.",
  },

  // ── Success card ──────────────────────────────────────────────────────────
  success: {
    heading: "Subscription created successfully!",
    txHashLabel: "Transaction hash",
    amountLabel: "Amount",
    intervalLabel: "Interval",
    merchantLabel: "Merchant",
    nextStepsHeading: "What happens next",
    nextStep1: "The merchant can collect the first payment immediately.",
    nextStep2: ({ days }: { days: number }) =>
      `Subsequent payments are collectible every ${days} day${days !== 1 ? "s" : ""}.`,
    nextStep3Cancel:
      "To cancel, call cancel(subscriber, merchant) on the contract, or revoke the token allowance via your wallet.",
    nextStep4:
      "Your wallet remains non-custodial — the contract never holds your funds.",
    createAnother: "Create Another Subscription",
    days: ({ days }: { days: number }) =>
      `every ${days} day${days !== 1 ? "s" : ""}`,
    amountTokens: ({ amount }: { amount: string }) => `${amount} tokens`,
    intervalDisplay: ({ days, interval }: { days: number; interval: string }) =>
      `every ${days} day${days !== 1 ? "s" : ""} (${interval} s)`,
  },

  // ── Error card ────────────────────────────────────────────────────────────
  error: {
    dismissAriaLabel: "Dismiss error",
    showDetails: "Show technical details",
    hideDetails: "Hide technical details",
    dataPreserved:
      "Your form data has been preserved — review and retry.",

    // Error titles
    signingCancelled: "Signing cancelled",
    insufficientBalance: "Insufficient balance",
    allowanceTooLow: "Token allowance too low",
    timedOut: "Transaction timed out",
    networkError: "Network error",
    wrongNetwork: "Wrong network",
    invalidAmount: "Invalid amount",
    invalidInterval: "Invalid interval",
    authFailed: "Authorisation failed",
    genericFailed: "Transaction failed",

    // Error summaries
    signingCancelledSummary:
      "You declined the transaction in Freighter.",
    insufficientBalanceSummary:
      "Your wallet does not have enough tokens or XLM to cover this transaction.",
    allowanceSummary:
      "The contract is not authorized to transfer this token amount on your behalf.",
    timedOutSummary:
      "The network did not confirm the transaction within the expected time.",
    networkSummary:
      "Could not reach the Soroban RPC endpoint.",
    wrongNetworkSummary:
      "Freighter is set to a different network than the app expects.",
    invalidAmountSummary:
      "The contract rejected the amount — it must be greater than zero.",
    invalidIntervalSummary:
      "The payment interval is outside the allowed range (1 day – 1 year).",
    authFailedSummary:
      "The contract rejected the transaction signature.",
    genericFailedSummary:
      "An unexpected error occurred while submitting the transaction.",

    // Fixes
    signingCancelledFix:
      'Click "Authorize Subscription" again and approve the request in the Freighter pop-up.',
    insufficientBalanceFix:
      "Top up your account. On testnet use Stellar Friendbot; on mainnet send XLM to your address.",
    allowanceFix:
      "Approve a higher token allowance by calling token.approve(contract_id, amount) before subscribing.",
    timedOutFix:
      "Check your connection and retry. The transaction may still confirm — wait a minute before resubmitting.",
    networkFix:
      "Check your internet connection and verify NEXT_PUBLIC_RPC_URL in .env.local. Retry in a moment.",
    wrongNetworkFix: (networkName: string) =>
      `Open Freighter, switch to ${networkName}, and try again.`,
    invalidAmountFix:
      "Enter a positive integer amount and resubmit.",
    invalidIntervalFix:
      "Enter a value between 86 400 s (1 day) and 31 536 000 s (1 year).",
    authFailedFix:
      "Ensure the connected wallet matches the subscriber address and retry.",
    genericFix:
      "Review the technical details below and retry. If the problem persists, check the README troubleshooting section.",
  },

  // ── Contract config error card ────────────────────────────────────────────
  contractConfig: {
    heading: "Contract not configured",
    description:
      "The app cannot find a valid Soroban contract address. This is an environment setup issue, not a wallet problem.",
    remediationHeading: "Remediation steps:",
    step1: "Deploy the contract:",
    step1Code: "bash deploy/deploy.sh",
    step2prefix: "Copy the printed address into",
    step2file: "frontend/.env.local",
    step2Code: "NEXT_PUBLIC_CONTRACT_ID=C…your_address…",
    step3: "Restart the dev server:",
    step3Code: "npm run dev",
    labelRpcUrl: "RPC URL",
    labelNetworkPassphrase: "Network passphrase",
    labelContractId: "Contract ID",
    notConfigured: "Not configured",
    readmeRef:
      "README.md → Frontend → Environment variables",
    readmeSuffix: "For full details, see",
  },

  // ── Network badge ─────────────────────────────────────────────────────────
  network: {
    statusChecking: "Checking…",
    statusReachable: "Contract reachable",
    statusUnreachable: "RPC unreachable",
    badgeAriaLabel: (networkName: string, statusLabel: string) =>
      `Network: ${networkName}. Status: ${statusLabel}`,
  },

  // ── Payment history placeholder ───────────────────────────────────────────
  history: {
    heading: "Payment History",
    description:
      "Executed payments and subscription activity will appear here once on-chain event indexing is available. Payments are recorded as executed events on the Soroban ledger.",
    comingSoon: "Coming soon",
  },

  // ── Wallet disconnected / locked empty state ──────────────────────────────
  emptyState: {
    lockEmoji: "🔒",
    connectPrompt: "Connect your wallet to get started",
    installFreighter: "Freighter",
    connectAction: "Connect Freighter Wallet",
    envVar: "NEXT_PUBLIC_CONTRACT_ID",
    envFile: "frontend/.env.local",
    quickStartLabel: "Quick Start guide",
  },
} as const;
