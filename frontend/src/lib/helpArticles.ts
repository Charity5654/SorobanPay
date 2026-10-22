/**
 * helpArticles.ts — in-app help content store.
 *
 * Versioned alongside the app. Each article has:
 *  - id: stable slug used for deep links
 *  - title: short display title
 *  - summary: one-line teaser shown in search results
 *  - content: full markdown-compatible body
 *  - tags: for search/filtering
 *  - videoUrl: optional YouTube embed URL
 *  - page: which app page this article belongs to
 *  - version: app version when this article was last updated
 *
 * Issue #745: searchable help articles, versioned with app.
 */

export interface HelpArticle {
  id: string;
  title: string;
  summary: string;
  content: string;
  tags: string[];
  videoUrl?: string;
  page: "home" | "subscribe" | "dashboard" | "settings" | "global";
  version: string;
}

export const HELP_CONTENT_VERSION = "1.0.0";

export const helpArticles: HelpArticle[] = [
  {
    id: "what-is-sorobanpay",
    title: "What is SorobanPay?",
    summary: "A non-custodial recurring payments protocol built on Stellar Soroban.",
    content: `SorobanPay is a decentralised, non-custodial recurring payments protocol built on Stellar's Soroban smart contract platform.

**Key facts:**
- Your funds never leave your wallet until a payment is due
- Every payment requires a fresh authorisation — no stored sessions
- Cancel anytime by revoking your SEP-41 token allowance
- Payments are enforced by the smart contract, not a central server

The contract lives on-chain; SorobanPay cannot intercept or redirect your funds.`,
    tags: ["intro", "overview", "soroban", "stellar"],
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    page: "global",
    version: "1.0.0",
  },
  {
    id: "connect-freighter",
    title: "Connecting Freighter Wallet",
    summary: "How to install and connect the Freighter browser extension.",
    content: `**Freighter** is the Stellar browser wallet used by SorobanPay to sign transactions.

**Steps:**
1. Install the [Freighter extension](https://www.freighter.app) for Chrome/Brave or Firefox.
2. Create or import a wallet and set a password.
3. Click the network selector (top-right) and choose **Testnet** for development or **Mainnet** for live use.
4. Open SorobanPay and click **Connect Freighter Wallet** — approve the connection prompt.
5. The status badge turns green when connected.

**Common issues:**
- "Wallet not connected" → Open Freighter and approve the site under Connected Sites.
- "Wrong network" → Match Freighter's network to the app's \`NEXT_PUBLIC_NETWORK_PASSPHRASE\`.
- Popup never appears → Disable pop-up blockers for localhost.`,
    tags: ["freighter", "wallet", "connect", "setup"],
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    page: "home",
    version: "1.0.0",
  },
  {
    id: "create-subscription",
    title: "Creating a Subscription",
    summary: "Step-by-step guide to authorising your first recurring payment.",
    content: `**Creating a subscription** locks an on-chain agreement between you (subscriber) and a merchant.

**Fields explained:**
- **Merchant Address** — The Stellar G-address of the recipient. Must be a valid 56-character address starting with G.
- **Token Contract** — The SEP-41 token contract address (C-address). Commonly the USDC contract on testnet.
- **Amount** — How many token units to transfer per interval (must be positive, max 10¹⁸).
- **Interval (seconds)** — How often payments recur. Minimum 86,400 s (1 day), maximum 31,536,000 s (365 days).

**Before submitting:**
1. Ensure your wallet has sufficient token balance **and** a sufficient SEP-41 allowance granted to the contract.
2. Freighter will prompt you to sign — review the transaction details carefully.
3. On success you'll see a green card with the transaction hash.

**Note:** The first payment is collectable immediately after subscription.`,
    tags: ["subscribe", "payment", "form", "merchant", "token", "amount", "interval"],
    videoUrl: "https://www.youtube.com/embed/dQw4w9WgXcQ",
    page: "subscribe",
    version: "1.0.0",
  },
  {
    id: "merchant-address",
    title: "What is a Merchant Address?",
    summary: "The Stellar public key of the payment recipient.",
    content: `The **Merchant Address** is the Stellar public key (G-address) of whoever will receive your recurring payments.

- It must be a valid Stellar address: 56 characters, starting with G.
- You cannot subscribe to yourself (subscriber and merchant must differ).
- The merchant does not need to be online or approve the subscription — they collect payments by calling \`execute_payment\` when a payment is due.

**Example:**
\`GABC...MERCHANT\` (56-character Stellar G-address)`,
    tags: ["merchant", "address", "stellar", "g-address"],
    page: "subscribe",
    version: "1.0.0",
  },
  {
    id: "token-contract",
    title: "Token Contract Address",
    summary: "Which SEP-41 token to use for your subscription payments.",
    content: `The **Token Contract** is the on-chain address of the SEP-41 token used for payments.

**Finding your token:**
- Testnet USDC: Check [Stellar Laboratory](https://laboratory.stellar.org) or ask the dApp provider.
- Any SAC-wrapped asset or native Soroban token is valid.
- The token must **not** be the SorobanPay contract itself.

**Allowance requirement:**
Before subscribing, you (the subscriber) must grant the SorobanPay contract an **SEP-41 allowance** of at least the subscription amount. This is what allows the contract to pull payments on the merchant's behalf.`,
    tags: ["token", "contract", "sep41", "usdc", "allowance"],
    page: "subscribe",
    version: "1.0.0",
  },
  {
    id: "payment-interval",
    title: "Payment Interval",
    summary: "How often your subscription payment recurs (in seconds).",
    content: `The **interval** determines how frequently the merchant can collect a payment.

**Limits:**
- Minimum: 86,400 seconds (1 day)
- Maximum: 31,536,000 seconds (365 days)

**Common intervals:**
| Interval (s) | Description |
|---|---|
| 86,400 | Daily |
| 604,800 | Weekly |
| 2,592,000 | Monthly (~30 days) |
| 7,776,000 | Quarterly (~90 days) |
| 31,536,000 | Annually (365 days) |

**Important:** The first payment can be collected immediately after subscribing. Subsequent payments become due after each interval elapses.`,
    tags: ["interval", "schedule", "recurring", "frequency"],
    page: "subscribe",
    version: "1.0.0",
  },
  {
    id: "cancel-subscription",
    title: "Cancelling a Subscription",
    summary: "How to stop recurring payments to a merchant.",
    content: `**To cancel** a subscription you have two options:

**Option 1 — On-chain cancel (recommended):**
Call the \`cancel\` entry point via the Stellar CLI or a supported dApp interface. This removes the subscription from the ledger immediately.

**Option 2 — Revoke allowance:**
Reduce your SEP-41 token allowance for the SorobanPay contract to 0. Future \`execute_payment\` calls will fail with \`TransferFailed\`. Note: The subscription record remains on-chain but cannot collect payments.

**After cancellation:**
- The merchant can no longer collect payments.
- Any future \`execute_payment\` attempts return \`NoActiveSubscription\` (error 4).
- You may re-subscribe at any time.`,
    tags: ["cancel", "stop", "subscription", "allowance"],
    page: "global",
    version: "1.0.0",
  },
  {
    id: "transaction-fees",
    title: "Transaction Fees",
    summary: "How Soroban resource fees work for subscription operations.",
    content: `SorobanPay transactions incur two types of fees on the Stellar network:

**1. Inclusion fee** — paid to validators for ordering your transaction (usually 100–10,000 stroops).

**2. Resource fee** — paid for CPU instructions, memory, and ledger reads/writes consumed by your transaction.

**Fee comparison by operation:**
- \`cancel\` — cheapest (~50,000 instructions)
- \`subscribe\` — moderate (~150,000 instructions)
- \`execute_payment\` — most expensive (~500,000 instructions, due to cross-contract token transfer)

**Best practice:** Always simulate your transaction before broadcasting to get exact fee estimates. The Stellar SDK's \`simulateTransaction\` returns the minimum resource fee.

Failed transactions still consume fees for work performed up to the point of failure.`,
    tags: ["fees", "gas", "stroops", "resource", "cost"],
    page: "global",
    version: "1.0.0",
  },
  {
    id: "storage-ttl",
    title: "Subscription Storage TTL",
    summary: "Why subscriptions can expire and how TTL is managed.",
    content: `Soroban persistent storage entries have a **Time-To-Live (TTL)** measured in ledgers. When a subscription entry expires, it is garbage-collected — it cannot be read or paid against.

**SorobanPay's TTL management:**
- Every \`subscribe\` and successful \`execute_payment\` call extends the TTL to ~365 days.
- A subscription that goes a full year without a successful payment will expire naturally.

**If a subscription expires:**
- \`execute_payment\` returns \`NoActiveSubscription\` (error 4).
- The subscriber must call \`subscribe\` again to recreate the record.

**Ledger timing:** TTL is measured in ledgers (~5 seconds each on mainnet). The stated "30 days" and "365 days" are approximations.`,
    tags: ["ttl", "expiry", "storage", "ledger", "soroban"],
    page: "global",
    version: "1.0.0",
  },
];

/** Look up an article by ID. */
export function getArticle(id: string): HelpArticle | undefined {
  return helpArticles.find((a) => a.id === id);
}

/** Return articles for a given page (including global articles). */
export function getArticlesForPage(page: HelpArticle["page"]): HelpArticle[] {
  return helpArticles.filter((a) => a.page === page || a.page === "global");
}

/**
 * Full-text search across title, summary, content, and tags.
 * Returns articles sorted by relevance (title/tag matches first).
 */
export function searchArticles(query: string): HelpArticle[] {
  const q = query.trim().toLowerCase();
  if (!q) return helpArticles;

  const scored = helpArticles.map((article) => {
    let score = 0;
    if (article.title.toLowerCase().includes(q)) score += 10;
    if (article.summary.toLowerCase().includes(q)) score += 5;
    if (article.tags.some((t) => t.includes(q))) score += 8;
    if (article.content.toLowerCase().includes(q)) score += 2;
    return { article, score };
  });

  return scored
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ article }) => article);
}
