/**
 * 03-subscription-form.spec.ts
 *
 * E2E tests for the subscription form — filling, validating, and submitting.
 *
 * Tests:
 *  - All four fields are present
 *  - Inline help text is shown
 *  - Validation errors appear for empty submit
 *  - Confirmation modal appears with valid inputs + mocked wallet
 *  - Confirmation modal cancel returns to form with preserved data
 *  - Submit button has adequate touch target height (≥ 44px)
 *
 * FE-48: E2E tests with Playwright
 */

import { test, expect } from '@playwright/test';
import { injectFreighterMock } from './helpers/freighter-mock';

const MERCHANT =
  'GABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';
const TOKEN =
  'CABC1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890AB';

test.describe('SubscriptionForm', () => {
  test.beforeEach(async ({ page }) => {
    await injectFreighterMock(page);
    await page.goto('/');
    // Connect wallet so the form is visible
    await page.waitForSelector('button:has-text("Connect Freighter Wallet")', {
      timeout: 10_000,
    });
    await page.getByRole('button', { name: /connect freighter wallet/i }).click();
    // Wait for form to render
    await page.waitForSelector('#merchantAddress', { timeout: 8_000 });
  });

  test('all four form fields are present', async ({ page }) => {
    await expect(page.locator('#merchantAddress')).toBeVisible();
    await expect(page.locator('#tokenAddress')).toBeVisible();
    await expect(page.locator('#amount')).toBeVisible();
    await expect(page.locator('#interval')).toBeVisible();
  });

  test('inline help text is shown for all fields', async ({ page }) => {
    await expect(page.locator('#help-merchant')).toBeVisible();
    await expect(page.locator('#help-token')).toBeVisible();
    await expect(page.locator('#help-amount')).toBeVisible();
    await expect(page.locator('#help-interval')).toBeVisible();
  });

  test('validation errors appear when submitting empty form', async ({ page }) => {
    // Clear the pre-filled interval so all fields are empty
    await page.locator('#merchantAddress').clear();
    await page.locator('#tokenAddress').clear();
    await page.locator('#amount').clear();
    await page.locator('#interval').clear();

    await page.getByRole('button', { name: /authorize subscription/i }).click();

    await expect(page.locator('#err-merchant')).toBeVisible();
    await expect(page.locator('#err-token')).toBeVisible();
    await expect(page.locator('#err-amount')).toBeVisible();
  });

  test('confirmation modal appears with valid inputs', async ({ page }) => {
    await page.locator('#merchantAddress').fill(MERCHANT);
    await page.locator('#tokenAddress').fill(TOKEN);
    await page.locator('#amount').fill('100');
    await page.locator('#interval').fill('2592000');

    await page.getByRole('button', { name: /authorize subscription/i }).click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    await expect(page.getByText(/confirm subscription/i)).toBeVisible();
  });

  test('confirmation modal shows entered values', async ({ page }) => {
    await page.locator('#merchantAddress').fill(MERCHANT);
    await page.locator('#tokenAddress').fill(TOKEN);
    await page.locator('#amount').fill('250');
    await page.locator('#interval').fill('2592000');

    await page.getByRole('button', { name: /authorize subscription/i }).click();

    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
    // Merchant address should appear in the modal
    await expect(page.getByText(MERCHANT)).toBeVisible();
    // Amount should be visible
    await expect(page.getByText(/250 tokens/i)).toBeVisible();
  });

  test('confirmation modal "Go Back" returns to form with data preserved', async ({
    page,
  }) => {
    await page.locator('#merchantAddress').fill(MERCHANT);
    await page.locator('#tokenAddress').fill(TOKEN);
    await page.locator('#amount').fill('100');
    await page.locator('#interval').fill('2592000');

    await page.getByRole('button', { name: /authorize subscription/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });

    await page.getByRole('button', { name: /go back/i }).click();

    // Dialog should be gone
    await expect(page.getByRole('dialog')).not.toBeVisible();
    // Form data should be preserved
    await expect(page.locator('#merchantAddress')).toHaveValue(MERCHANT);
    await expect(page.locator('#tokenAddress')).toHaveValue(TOKEN);
    await expect(page.locator('#amount')).toHaveValue('100');
  });

  test('submit button has adequate touch target height (≥ 44px)', async ({
    page,
  }) => {
    const btn = page.getByRole('button', { name: /authorize subscription/i });
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(44);
  });

  test('fields have aria-describedby pointing to help text', async ({ page }) => {
    const merchantDescribedBy = await page
      .locator('#merchantAddress')
      .getAttribute('aria-describedby');
    expect(merchantDescribedBy).toContain('help-merchant');

    const tokenDescribedBy = await page
      .locator('#tokenAddress')
      .getAttribute('aria-describedby');
    expect(tokenDescribedBy).toContain('help-token');

    const amountDescribedBy = await page
      .locator('#amount')
      .getAttribute('aria-describedby');
    expect(amountDescribedBy).toContain('help-amount');

    const intervalDescribedBy = await page
      .locator('#interval')
      .getAttribute('aria-describedby');
    expect(intervalDescribedBy).toContain('help-interval');
  });

  test('interval validation error shown for out-of-range value', async ({
    page,
  }) => {
    await page.locator('#interval').fill('100'); // too short — less than 86400
    // Click elsewhere to trigger validation
    await page.locator('#amount').click();
    // Live validation should show error
    await expect(page.locator('#err-interval')).toBeVisible({ timeout: 3_000 });
  });
});
