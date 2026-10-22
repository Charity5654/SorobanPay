/**
 * 01-landing-page.spec.ts
 *
 * E2E tests for the landing page initial state (no wallet connected).
 *
 * Tests:
 *  - Page title and main heading render
 *  - Wallet disconnected state is shown
 *  - Connect Freighter Wallet button is present
 *  - Subscription form locked state renders when wallet not connected
 *  - No horizontal overflow (layout integrity)
 *  - Keyboard shortcut trigger button is present
 *
 * FE-48: E2E tests with Playwright
 */

import { test, expect } from '@playwright/test';

test.describe('Landing page — no wallet connected', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    // Wait for the page to hydrate past the skeleton state
    await page.waitForSelector('h1:has-text("SorobanPay")', { timeout: 10_000 });
  });

  test('page has correct title', async ({ page }) => {
    await expect(page).toHaveTitle(/SorobanPay/i);
  });

  test('main heading is visible', async ({ page }) => {
    await expect(page.getByRole('heading', { name: /SorobanPay/i, level: 1 })).toBeVisible();
  });

  test('tagline is shown', async ({ page }) => {
    await expect(page.getByText(/decentralized recurring payments on stellar/i)).toBeVisible();
  });

  test('Connect Freighter Wallet button is visible', async ({ page }) => {
    // Wait for hydration — the skeleton is replaced by the real button after mount
    const connectBtn = page.getByRole('button', { name: /connect freighter wallet/i });
    await expect(connectBtn).toBeVisible({ timeout: 8_000 });
  });

  test('subscription section shows locked / wallet-required state', async ({ page }) => {
    // Without a wallet the form section shows a "Connect your wallet" message
    const lockedText = page.getByText(/connect your wallet to get started/i);
    await expect(lockedText).toBeVisible({ timeout: 8_000 });
  });

  test('keyboard shortcuts trigger button is present', async ({ page }) => {
    const shortcutsBtn = page.getByRole('button', { name: /keyboard shortcuts/i });
    await expect(shortcutsBtn).toBeVisible();
  });

  test('layout has no horizontal overflow', async ({ page }) => {
    const bodyScrollWidth = await page.evaluate(() => document.body.scrollWidth);
    const viewportWidth   = await page.evaluate(() => window.innerWidth);
    expect(bodyScrollWidth).toBeLessThanOrEqual(viewportWidth + 1); // 1px tolerance
  });

  test('page is keyboard-navigable (tab through interactive elements)', async ({ page }) => {
    // Tab 3 times and check that focus moves to a reachable interactive element
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    const focused = await page.evaluate(() => document.activeElement?.tagName ?? '');
    expect(['BUTTON', 'A', 'INPUT', 'SELECT']).toContain(focused);
  });
});
