/**
 * freighter-mock.ts
 *
 * Playwright helpers for mocking the Freighter browser wallet extension in E2E tests.
 *
 * Strategy:
 *  1. `freighterInitScript` — injected via page.addInitScript() BEFORE any page
 *     script runs. Patches window.postMessage to intercept the
 *     FREIGHTER_EXTERNAL_MSG_REQUEST / FREIGHTER_EXTERNAL_MSG_RESPONSE protocol
 *     used by @stellar/freighter-api, and sets window.freighter = true to
 *     short-circuit the isConnected() check.
 *  2. `injectConnectedWallet` — calls page.addInitScript with the above script.
 *
 * FE-48: E2E tests with Playwright
 */

import type { Page } from '@playwright/test';

/** Mock Stellar public key returned by all Freighter API calls. */
export const MOCK_PUBLIC_KEY =
  'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

/** Sentinel signed XDR returned by SUBMIT_TRANSACTION mocks. */
export const MOCK_SIGNED_XDR = 'AAAA_MOCK_SIGNED_XDR_E2E==';

/**
 * Init script injected before page scripts run.
 * Patches window.postMessage to respond to all Freighter API message types.
 */
export const freighterInitScript = `
(function () {
  const MOCK_KEY = "${MOCK_PUBLIC_KEY}";
  const MOCK_XDR = "${MOCK_SIGNED_XDR}";

  // isConnected() checks window.freighter directly
  window.freighter = true;

  // @stellar/freighter-api postMessage protocol:
  // Request:  { source: 'FREIGHTER_EXTERNAL_MSG_REQUEST', messageId, type, ... }
  // Response: { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId, ... }
  // NOTE: "messagedId" (no 'g' typo) is how the library spells it.
  const _origPost = window.postMessage.bind(window);
  window.postMessage = function (data, origin, transfer) {
    if (data && data.source === 'FREIGHTER_EXTERNAL_MSG_REQUEST') {
      const id   = data.messageId;
      const type = data.type;
      let resp   = { source: 'FREIGHTER_EXTERNAL_MSG_RESPONSE', messagedId: id };

      switch (type) {
        case 'REQUEST_CONNECTION_STATUS': resp = { ...resp, isConnected: true };                                          break;
        case 'REQUEST_ALLOWED_STATUS':    resp = { ...resp, isAllowed: true };                                            break;
        case 'SET_ALLOWED_STATUS':        resp = { ...resp, isAllowed: true };                                            break;
        case 'REQUEST_ACCESS':            resp = { ...resp, publicKey: MOCK_KEY };                                        break;
        case 'REQUEST_PUBLIC_KEY':        resp = { ...resp, publicKey: MOCK_KEY };                                        break;
        case 'GET_ADDRESS':               resp = { ...resp, address: MOCK_KEY };                                          break;
        case 'SUBMIT_TRANSACTION':        resp = { ...resp, signedTransaction: MOCK_XDR, signerAddress: MOCK_KEY };       break;
        case 'SIGN_TRANSACTION':          resp = { ...resp, signedTransaction: MOCK_XDR };                                break;
        default:                          resp = { ...resp };
      }

      Promise.resolve().then(() => {
        window.dispatchEvent(new MessageEvent('message', { data: resp, source: window }));
      });
      return;
    }
    return _origPost(data, origin, transfer);
  };
})();
`;

/**
 * Inject the Freighter mock into the page before navigation.
 * Call this before page.goto() to ensure the script runs before any page code.
 */
export async function injectFreighterMock(page: Page): Promise<void> {
  await page.addInitScript(freighterInitScript);
}

/**
 * Navigate to a URL with Freighter already mocked.
 * Convenience wrapper that calls injectFreighterMock + page.goto().
 */
export async function gotoWithFreighterMock(
  page: Page,
  url: string,
): Promise<void> {
  await injectFreighterMock(page);
  await page.goto(url);
}
