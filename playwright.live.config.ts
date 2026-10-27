import { defineConfig, devices } from '@playwright/test';

// Runs tests/live against a real deployment: LIVE_URL=https://mummer-staging.example.workers.dev npx playwright test -c playwright.live.config.ts
// It needs a deployment whose Turnstile uses Cloudflare's public test keys (see workers/api/wrangler.staging.toml); a production
// deployment's real challenge needs a person. Nothing here starts a local server.
const url = process.env.LIVE_URL;
if (!url) throw new Error('Set LIVE_URL to the deployment to test (for example the staging origin).');

export default defineConfig({
  testDir: 'tests/live',
  outputDir: 'tests/e2e/.artifacts/live-results',
  timeout: 300_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: { baseURL: url, trace: 'retain-on-failure', screenshot: 'only-on-failure', actionTimeout: 60_000, navigationTimeout: 60_000 },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
