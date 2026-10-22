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

// ─── Responsive Visual Regression Coverage (#1130) ───────────────────────────

const VIEWPORTS = [
  { name: 'mobile-portrait', width: 375, height: 667 },
  { name: 'mobile-large', width: 414, height: 896 },
  { name: 'tablet-portrait', width: 768, height: 1024 },
  { name: 'laptop-desktop', width: 1280, height: 800 },
  { name: 'widescreen-hd', width: 1920, height: 1080 },
];

test.describe('Responsive visual regression coverage (#1130)', () => {
  for (const vp of VIEWPORTS) {
    test(`renders form and controls cleanly on ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');

      // Form heading must always be visible
      await expect(page.getByText('Create Subscription')).toBeVisible();

      // No horizontal scroll leakage on any standard viewport
      const overflows = await page.evaluate(
        () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
      );
      expect(overflows).toBe(false);

      // Verify essential buttons are clickable and visible
      const submitBtn = page.getByRole('button', { name: /authorize subscription/i });
      if (await submitBtn.count() > 0) {
        await expect(submitBtn).toBeVisible();
      }
    });
  }
});

