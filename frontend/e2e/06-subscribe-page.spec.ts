/**
 * 06-subscribe-page.spec.ts
 *
 * E2E tests for the /subscribe page (pre-filled subscription via URL params).
 *
 * Tests:
 *  - /subscribe page loads without errors
 *  - Valid query params pre-fill the form fields
 *  - Invalid query params are silently ignored (fields remain blank)
 *  - Pre-filled banner is shown when params are present
 *  - Connect wallet on /subscribe page works
 *
 * FE-48: E2E tests with Playwright
 */

import { test, expect } from '@playwright/test';
import { injectFreighterMock } from './helpers/freighter-mock';

const MERCHANT =
  'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';
const TOKEN =
  'CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

const SUBSCRIBE_URL = `/subscribe?merchant=${MERCHANT}&token=${TOKEN}&amount=500&interval=2592000`;

test.describe('/subscribe page', () => {
  test('page loads without error', async ({ page }) => {
    await page.goto('/subscribe');
    await expect(page.getByRole('heading', { name: /SorobanPay/i })).toBeVisible({
      timeout: 10_000,
    });
  });

  test('pre-filled banner is shown when query params are present', async ({
    page,
  }) => {
    await injectFreighterMock(page);
    await page.goto(SUBSCRIBE_URL);

    // Connect wallet to see the form
    await page.waitForSelector('button:has-text("Connect Freighter Wallet")', {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    await page.waitForSelector('#merchantAddress', { timeout: 8_000 });

    await expect(page.getByText(/pre-filled via share link/i)).toBeVisible();
  });

  test('valid query params pre-fill form fields', async ({ page }) => {
    await injectFreighterMock(page);
    await page.goto(SUBSCRIBE_URL);

    await page.waitForSelector('button:has-text("Connect Freighter Wallet")', {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    await page.waitForSelector('#merchantAddress', { timeout: 8_000 });

    await expect(page.locator('#merchantAddress')).toHaveValue(MERCHANT);
    await expect(page.locator('#tokenAddress')).toHaveValue(TOKEN);
    await expect(page.locator('#amount')).toHaveValue('500');
    await expect(page.locator('#interval')).toHaveValue('2592000');
  });

  test('invalid merchant param is ignored (field stays blank)', async ({ page }) => {
    await injectFreighterMock(page);
    await page.goto('/subscribe?merchant=INVALID_ADDRESS&token=&amount=100&interval=2592000');

    await page.waitForSelector('button:has-text("Connect Freighter Wallet")', {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    await page.waitForSelector('#merchantAddress', { timeout: 8_000 });

    // Invalid address should result in empty field
    await expect(page.locator('#merchantAddress')).toHaveValue('');
  });

  test('page without params shows no pre-filled banner', async ({ page }) => {
    await injectFreighterMock(page);
    await page.goto('/subscribe');

    await page.waitForSelector('button:has-text("Connect Freighter Wallet")', {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    await page.waitForSelector('#merchantAddress', { timeout: 8_000 });

    await expect(page.getByText(/pre-filled via share link/i)).not.toBeVisible();
  });
});
