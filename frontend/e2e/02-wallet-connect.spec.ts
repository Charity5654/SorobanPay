/**
 * 02-wallet-connect.spec.ts
 *
 * E2E tests for wallet connection flow with mocked Freighter extension.
 *
 * Tests:
 *  - Connect button triggers Freighter (mocked) and shows connected state
 *  - Public key is truncated and displayed after connecting
 *  - Subscription form becomes available after wallet connect
 *  - Disconnect button returns to disconnected state
 *
 * FE-48: E2E tests with Playwright
 */

import { test, expect } from '@playwright/test';
import { injectFreighterMock, MOCK_PUBLIC_KEY } from './helpers/freighter-mock';

/** Short form of the mock public key as displayed in the UI. */
const SHORT_KEY = `${MOCK_PUBLIC_KEY.slice(0, 6)}…${MOCK_PUBLIC_KEY.slice(-4)}`;

test.describe('Wallet connection — mocked Freighter', () => {
  test.beforeEach(async ({ page }) => {
    await injectFreighterMock(page);
    await page.goto('/');
    // Wait for the page to hydrate
    await page.waitForSelector('button:has-text("Connect Freighter Wallet")', {
      timeout: 10_000,
    });
  });

  test('Connect button is visible and enabled before connecting', async ({ page }) => {
    const btn = page.getByRole('button', { name: /connect freighter wallet/i });
    await expect(btn).toBeVisible();
    await expect(btn).toBeEnabled();
  });

  test('clicking Connect shows connected wallet state', async ({ page }) => {
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    // After mock connect the wallet state chip should read "Connected"
    const chip = page.locator('[aria-label="Wallet connected"]');
    await expect(chip).toBeVisible({ timeout: 8_000 });
  });

  test('short public key is displayed after connecting', async ({ page }) => {
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    await expect(page.getByText(SHORT_KEY)).toBeVisible({ timeout: 8_000 });
  });

  test('subscription form becomes visible after wallet connect', async ({ page }) => {
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    // The form heading should now appear
    await expect(
      page.getByRole('heading', { name: /create subscription/i }),
    ).toBeVisible({ timeout: 8_000 });
  });

  test('Disconnect button returns to disconnected state', async ({ page }) => {
    // Connect first
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    await expect(page.locator('[aria-label="Wallet connected"]')).toBeVisible({ timeout: 8_000 });

    // Then disconnect
    await page.getByRole('button', { name: /disconnect/i }).click();

    // Should be back to disconnected state
    await expect(
      page.getByRole('button', { name: /connect freighter wallet/i }),
    ).toBeVisible({ timeout: 5_000 });
  });
});
