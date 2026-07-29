import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration.
 *
 * Test directories:
 *  - ./tests    — original Playwright specs (kept for backwards compatibility)
 *  - ./e2e      — new E2E specs (FE-48: comprehensive user flow coverage)
 *
 * FE-48: E2E tests with Playwright
 */
export default defineConfig({
  // Run both legacy tests/ and new e2e/ directory
  testDir: './',
  testMatch: [
    'tests/**/*.spec.ts',
    'e2e/**/*.spec.ts',
  ],
  timeout: 30_000,
  // Retry once on CI for flakiness resilience
  retries: process.env.CI ? 1 : 0,
  // Limit parallelism on CI to avoid resource contention
  workers: process.env.CI ? 2 : undefined,
  reporter: [
    ['list'],
    // On CI, produce HTML report artifact
    ...(process.env.CI
      ? [['html', { outputFolder: 'playwright-report', open: 'never' }] as const]
      : []),
  ],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    // Capture screenshot and trace on first retry for debugging
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
    video: 'on-first-retry',
  },
  projects: [
    // Desktop browsers
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox',  use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit',   use: { ...devices['Desktop Safari'] } },
    // Mobile viewports
    { name: 'mobile-chrome',  use: { ...devices['Pixel 5'] } },
    { name: 'mobile-safari',  use: { ...devices['iPhone 12'] } },
    { name: 'tablet',         use: { ...devices['iPad (gen 7)'] } },
  ],
  outputDir: 'playwright-results',
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      // Provide a dummy contract address so the form renders in tests.
      // Without this CONTRACT_ID is empty and the app shows ContractConfigError.
      NEXT_PUBLIC_CONTRACT_ID:
        process.env.NEXT_PUBLIC_CONTRACT_ID ??
        'CAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD2KM',
    },
  },
});
