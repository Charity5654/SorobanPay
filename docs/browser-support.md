# Browser, Accessibility, and Freighter Support

SorobanPay can be browsed without a wallet. The [Freighter](https://www.freighter.app) browser extension is required to connect an account and sign transactions. RPC reads, simulation, and transaction submission use the configured Soroban RPC endpoint; Freighter is used for wallet access and signing.

## Browser and wallet support

| Browser | App support | Freighter signing | Notes |
|---|---|---|---|
| Chrome | Supported | Supported with the Freighter extension | Chromium is included in the Playwright projects; tests use a mocked wallet. |
| Brave | Supported | Supported with the Freighter extension | Shields or extension settings may block injection. Real extension behavior is not covered by the Playwright mock. |
| Firefox | Supported | Supported with the Freighter add-on | The app polls for the extension because Firefox may inject it after initial page load. |
| Edge (Chromium) | Not officially verified | Not officially verified | Chromium compatibility does not guarantee Freighter compatibility. |
| Safari (desktop) | Browser UI can be viewed | Not supported by the current Freighter integration | Playwright WebKit coverage uses a mock and does not verify a real wallet extension. |
| Mobile browsers | Responsive UI can be viewed | Not supported | Mobile browser extension signing is not available in the supported setup. Playwright mobile projects are viewport/device emulation, not real phones with Freighter. |

No minimum browser versions are claimed: the repository does not define or verify a version-specific support floor. Use a current browser release. The configured Playwright projects are Chromium, Firefox, WebKit, mobile Chrome, mobile Safari, and tablet emulation. This is automated UI coverage, not certification of every browser/version or extension combination.

Serve the app from `http://localhost` during development or `https://` in production. Do not open it from `file://`; extension access and browser APIs require a served origin.

## Keyboard support

Interactive controls use native browser keyboard behavior, and `frontend/src/app/globals.css` provides a visible `:focus-visible` outline. On the landing and app pages, the keyboard-shortcuts dialog lists these shortcuts:

| Key | Action |
|---|---|
| `?` | Open or close the shortcut help dialog |
| `N` | Focus the new subscription form |
| `H` | Jump to payment history |
| `M` | Jump to the merchant portal |
| `D` | Jump to the dashboard section when present; the help currently labels this as coming soon |
| `Escape` | Close an open dialog or cancel the current modal action |

Navigation shortcuts are disabled while focus is in a form control. Dialogs provide keyboard close behavior and focus handling. The section-jump shortcuts request smooth scrolling; see the reduced-motion note below.

## Screen readers

The interface uses semantic form labels and table headers, accessible names for wallet/status controls, and ARIA dialog, alert, status, and live-region roles for dynamic feedback. The Playwright accessibility spec checks selected roles, labels, and keyboard flows. It does not run a screen reader or establish WCAG conformance. Screen-reader and browser combinations have not been formally certified; report a specific control, browser, and assistive technology when an announcement or navigation issue occurs.

## Reduced motion

The global stylesheet responds to `prefers-reduced-motion: reduce` by shortening CSS animations and transitions and disabling CSS smooth scrolling. Components including the confirmation modal and empty state also use Framer Motion's reduced-motion preference. This is not a blanket guarantee for every third-party animation: keyboard section navigation explicitly requests smooth scrolling and may still animate. Follow the operating system's reduced-motion setting and report remaining motion with the browser and action that triggered it.

## Installing Freighter

### Chrome and Brave

1. Open the [Chrome Web Store listing](https://chrome.google.com/webstore/detail/freighter/bcacfldlkkdogcmkkibnjlakofdplcbk).
2. Install Freighter and confirm its icon appears in the browser toolbar.

### Firefox

1. Open the [Firefox Add-ons listing](https://addons.mozilla.org/en-US/firefox/addon/freighter/).
2. Install Freighter and confirm its icon appears in the toolbar.

For first-time setup, create or import a wallet in the extension and store its recovery phrase securely. Never share a recovery phrase or enter it into SorobanPay.

## Connect and select a network

1. Set `NEXT_PUBLIC_NETWORK_PASSPHRASE` in `frontend/.env.local` to the network of the deployed contract. Restart the dev server after changing configuration.
2. Set Freighter to the same network:

| Network | Passphrase in `.env.local` | Freighter selector |
|---|---|---|
| Testnet | `Test SDF Network ; September 2015` | Testnet |
| Mainnet | `Public Global Stellar Network ; September 2015` | Mainnet |

3. Open SorobanPay from `http://localhost:3000` or the deployed HTTPS site and select **Connect**.
4. Approve the connection in Freighter. The wallet badge should show **Connected**; the public key is used as the subscriber address.

Use [Stellar Friendbot](https://laboratory.stellar.org/#account-creator?network=test) to fund a Testnet account. Mainnet accounts need sufficient XLM for the network reserve and fees, as well as the token being used. To change accounts, remove the site under Freighter's connected-site settings and reconnect.

## Verify and recover

Start the app from the repository root:

```bash
cd frontend
npm run dev
```

Expected result: the app is available at `http://localhost:3000`. For the existing browser-based accessibility smoke spec, run this from `frontend/`:

```bash
npm run test:e2e -- e2e/05-accessibility.spec.ts
```

Expected result: the selected Playwright browser projects exercise keyboard help, dialog attributes, form error announcements, and related UI checks using the Freighter mock. A passing run does not verify a real extension or replace manual screen-reader checks. If Playwright reports missing browser binaries, install the configured browsers with `npx playwright install` from `frontend/` and retry. Tests were not run while preparing this support record.

| Symptom | Recovery |
|---|---|
| Freighter is not detected | Confirm the extension is installed and enabled, reload the served app, and allow a few seconds for Firefox injection. Do not use a `file://` URL. |
| Freighter popup is blocked | Allow extension popups for the app origin and temporarily disable conflicting wallet extensions. In Brave, check Shields for that site. |
| Transaction reports a network mismatch | Match Freighter's selected network to `NEXT_PUBLIC_NETWORK_PASSPHRASE` and the deployed contract. |
| Keyboard shortcut does not run while typing | This is intentional for shortcuts that navigate the page; move focus outside the form control and retry. Use the visible controls as an alternative. |
| Motion remains when reduced motion is enabled | Check the OS/browser reduced-motion setting. If section navigation still animates, report the shortcut and browser because that scroll currently requests smooth behavior explicitly. |
| Screen-reader output is missing or confusing | Verify the browser/assistive-technology pair and report the control and expected versus actual announcement; the automated spec checks only selected ARIA behavior. |

The wallet integration is isolated in `frontend/src/lib/wallet_manager.ts`; it detects Freighter, requests site access, and signs transactions. Other chain operations use the RPC endpoint configured through `NEXT_PUBLIC_RPC_URL`.
