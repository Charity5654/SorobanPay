# Browser Support & Freighter Wallet Setup

SorobanPay requires the [Freighter](https://www.freighter.app) browser extension for transaction signing. Freighter injects a JavaScript API that the frontend uses to request signatures — the app will not function without it.

---

## Supported Browsers

| Browser | Supported | Notes |
|---------|-----------|-------|
| Chrome (≥ 92) | ✅ | Recommended |
| Brave (≥ 1.30) | ✅ | Fully supported; disable Brave Shields for `localhost` if the extension does not connect |
| Firefox (≥ 91) | ✅ | Supported via Firefox Add-ons |
| Edge (Chromium-based) | ⚠️ | Install the Chrome Web Store version; not officially tested |
| Safari | ❌ | Freighter does not support Safari |
| Mobile browsers | ❌ | Browser extensions are not available on mobile; use a desktop browser |

The app is served over `http://localhost` (dev) or `https://` (production). Freighter blocks requests from `file://` origins — always use a proper dev server (`npm run dev`).

---

## Installing Freighter

### Chrome / Brave

1. Open the [Chrome Web Store listing](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk).
2. Click **Add to Chrome** → **Add extension**.
3. The Freighter icon appears in the browser toolbar.

### Firefox

1. Open the [Firefox Add-ons listing](https://addons.mozilla.org/en-US/firefox/addon/freighter/).
2. Click **Add to Firefox** → **Add**.
3. The Freighter icon appears in the toolbar.

### First-time wallet setup

After installing:

1. Click the Freighter icon in the toolbar.
2. Choose **Create a new wallet** (or **Import** if you have an existing seed phrase).
3. Write down and store your seed phrase securely — it cannot be recovered.
4. Set a password for local access.

---

## Configuring Freighter for SorobanPay

### 1. Select the correct network

Freighter must be set to the same network as your deployed contract.

1. Click the Freighter icon.
2. Click the network name at the **top-right** of the extension popup.
3. Select the network that matches your `NEXT_PUBLIC_NETWORK_PASSPHRASE` in `frontend/.env.local`:

| Network | Passphrase in `.env.local` | Freighter selector |
|---------|---------------------------|--------------------|
| Testnet | `Test SDF Network ; September 2015` | **Testnet** |
| Mainnet | `Public Global Stellar Network ; September 2015` | **Mainnet** |

> A network mismatch causes transactions to be rejected immediately. The app's error card will show "Wrong network" with the current passphrase to help you diagnose this.

### 2. Fund your wallet

**Testnet (free)**

Use [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test) to add test XLM:

```
https://friendbot.stellar.org?addr=<YOUR_PUBLIC_KEY>
```

Or via the Stellar CLI:

```bash
stellar keys fund alice --network testnet
```

**Mainnet**

Transfer at least **2 XLM** to your address to cover the base reserve and transaction fees. The `subscribe` call costs roughly 1,000–10,000 stroops (0.0001–0.001 XLM) in network fees on top of the base reserve.

### 3. Connect to the app

On the first page load the app calls Freighter's `requestAccess()` API. Freighter will show a connection prompt asking you to approve the site.

1. Click **Connect** in the Freighter popup.
2. The wallet badge in the top-right of the subscription form turns **green** ("Connected").
3. Your public key is now used as the `subscriber` address on all transactions.

To disconnect or switch accounts, open Freighter, go to **Settings → Connected Sites**, and remove the site. Then reload the page to reconnect with a different account.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| "Freighter wallet not detected" warning in the form | Extension not installed or disabled | Install Freighter from the links above; ensure the extension is enabled in your browser's extension manager |
| Wallet badge stays gray ("Disconnected") after page load | Site not approved in Freighter | Click the Freighter icon → approve the connection prompt; reload the page |
| Freighter popup never appears | App served from `file://` origin, or pop-up blocker active | Run `npm run dev` and open `http://localhost:3000`; disable pop-up blockers for `localhost` |
| Transaction rejected — "wrong network" | Freighter network ≠ app network | Open Freighter → network selector → match the network to `NEXT_PUBLIC_NETWORK_PASSPHRASE` |
| Transaction rejected — "user declined" | Signing popup dismissed | Resubmit the form and approve in the Freighter popup |
| "Insufficient balance" error | Not enough XLM or tokens | Fund via Friendbot (testnet) or send XLM (mainnet); ensure you hold the token being subscribed |
| Signing popup closes before you can sign | Browser pop-up blocker | Disable pop-up blockers for `localhost` in your browser settings |
| Extension conflicts (popup does not appear) | Multiple wallet extensions installed | Temporarily disable other wallet extensions (MetaMask, etc.) and reload |
| Brave Shields blocking the extension | Brave's content blocking | Click the Brave Shields icon in the address bar and disable Shields for `localhost` |

---

## How the App Detects Freighter

The `useWallet` hook (in `frontend/src/hooks/useWallet.ts`) checks for the Freighter-injected API on mount:

- `freighterInstalled` — `true` if `window.freighter` is present.
- `isCheckingFreighter` — `true` while the initial detection is in progress.
- `publicKey` — set after the user approves the connection; `null` when disconnected.

If `freighterInstalled` is `false` after the check completes, the form renders a yellow warning banner with a direct link to `https://www.freighter.app`.

The `transaction_builder.ts` module uses Freighter only for signing (`signTx`). All other operations (fetching account state, simulation, submission) talk directly to the Soroban RPC endpoint configured in `NEXT_PUBLIC_RPC_URL`.
