# Freighter Wallet Setup

SorobanPay uses [Freighter](https://www.freighter.app) — a non-custodial Stellar browser extension wallet — to sign transactions. This document covers supported browsers, installation, and configuration.

---

## Supported browsers

| Browser | Support | Store link |
|---------|---------|------------|
| **Chrome** | ✅ Supported | [Chrome Web Store](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk) |
| **Brave** | ✅ Supported | Same as Chrome (uses Chrome Web Store) |
| **Firefox** | ✅ Supported | [Firefox Add-ons](https://addons.mozilla.org/en-US/firefox/addon/freighter/) |
| Safari | ❌ Not supported | — |
| Edge | ⚠️ Untested | May work via Chrome Web Store |

> The app injects `@stellar/freighter-api ^3.0.0` to detect and communicate with the extension. It will show a yellow warning banner when Freighter is not detected.

---

## Install Freighter

### Chrome / Brave

1. Open the [Chrome Web Store listing](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk).
2. Click **Add to Chrome** → **Add extension**.
3. The Freighter icon appears in the browser toolbar.

### Firefox

1. Open the [Firefox Add-ons listing](https://addons.mozilla.org/en-US/firefox/addon/freighter/).
2. Click **Add to Firefox** → **Add**.
3. The Freighter icon appears in the browser toolbar.

---

## Initial wallet setup

After installing the extension:

1. Click the Freighter icon in the toolbar.
2. Choose **Create new wallet** (or **Import wallet** if you have a recovery phrase).
3. Follow the on-screen steps to set a password and back up your recovery phrase.

---

## Configure network

SorobanPay requires Freighter to be on the **same network** as the deployed contract. A mismatch causes transactions to be rejected.

1. Open Freighter and click the network name at the top-right (e.g., **Mainnet**).
2. Select the network matching your `.env.local`:

| `NEXT_PUBLIC_NETWORK_PASSPHRASE` | Freighter network |
|----------------------------------|-------------------|
| `Test SDF Network ; September 2015` | **Testnet** |
| `Public Global Stellar Network ; September 2015` | **Mainnet** |

---

## Connect to SorobanPay

1. Open the app at `http://localhost:3000` (or the deployed URL).
2. On first interaction Freighter will prompt you to **approve** the site connection.
3. Click **Connect** — the wallet badge in the form header turns green: **Connected**.

> Freighter blocks requests from `file://` origins. Always serve the app over `http://localhost` or `https://`.

---

## Fund your wallet (testnet)

Testnet accounts need XLM before they can sign transactions:

1. In Freighter, copy your public key (`G…`).
2. Visit [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test) and paste the key.
3. Click **Get test network lumens** — 10 000 XLM are credited instantly.

For mainnet, send at least **2 XLM** to your address to cover the base reserve and fees.

---

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Yellow "Freighter wallet not detected" banner | Install the extension and reload the page |
| Gray "Disconnected" badge | Open Freighter → approve the site under **Connected Sites** |
| Signing popup never appears | Serve over `http://localhost` or `https://`; disable conflicting wallet extensions |
| Popup closes before signing | Disable browser pop-up blockers for the app's origin |
| Transaction rejected — wrong network | Match Freighter's network to `NEXT_PUBLIC_NETWORK_PASSPHRASE` in `.env.local` |
| "Insufficient balance" error | Fund via Friendbot (testnet) or send XLM (mainnet) |

For the full frontend troubleshooting reference see [README.md → Troubleshooting Freighter](../README.md#troubleshooting-freighter).
