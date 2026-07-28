import { test, expect } from '@playwright/test';

const MOBILE = { width: 375, height: 812 };

test.describe('mobile viewport layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(MOBILE);
    await page.goto('/');
  });

  test('form is visible and not clipped at 375px width', async ({ page }) => {
    await expect(page.getByText('Create Subscription')).toBeVisible();
  });

  test('form container does not overflow viewport', async ({ page }) => {
    const form = page.locator('form').first();
    const box = await form.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x + box!.width).toBeLessThanOrEqual(MOBILE.width);
  });

  test('all inputs have minimum 44px touch target height', async ({ page }) => {
    const inputs = page.locator('input');
    const count = await inputs.count();
    for (let i = 0; i < count; i++) {
      const h = await inputs.nth(i).evaluate((el) => el.clientHeight);
      expect(h).toBeGreaterThanOrEqual(44);
    }
  });

  test('submit button has minimum 44px touch target height', async ({ page }) => {
    const btn = page.getByRole('button', { name: /authorize subscription/i });
    const h = await btn.evaluate((el) => (el as HTMLElement).clientHeight);
    expect(h).toBeGreaterThanOrEqual(44);
  });

  test('no horizontal scrollbar at 375px', async ({ page }) => {
    const overflows = await page.evaluate(() =>
      document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(overflows).toBe(false);
  });
});
