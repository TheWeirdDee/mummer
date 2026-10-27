import { defineConfig, devices } from '@playwright/test';

const port = process.env.E2E_PORT ?? '8788';

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'tests/e2e/.artifacts/results',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Requests arrive without a Cloudflare client address locally; each browser context sets its own so rate limits are per person.
  },
  // Chromium is the default and the reference run. Firefox and WebKit run only when asked: E2E_ALL_BROWSERS=1 npx playwright test
  // (add --project=firefox or --project=webkit to pick one). npx playwright install firefox webkit downloads them once.
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ...(process.env.E2E_ALL_BROWSERS
      ? [
          { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
          { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        ]
      : []),
  ],
  webServer: [
    {
      command: 'node scripts/e2e-server.mjs',
      url: `http://127.0.0.1:${port}/api/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
    {
      // The separate human-check origin, served locally exactly as in production (its own Worker, its own port).
      command: `npx wrangler dev --local --port 8789 --ip 127.0.0.1 -c workers/human-check/wrangler.toml --var PARENT_ORIGIN:http://127.0.0.1:${port}`,
      url: 'http://127.0.0.1:8789/',
      reuseExistingServer: !process.env.CI,
      timeout: 240_000,
      stdout: 'ignore',
      stderr: 'pipe',
    },
  ],
});
