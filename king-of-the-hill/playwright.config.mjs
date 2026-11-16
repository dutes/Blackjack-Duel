import { defineConfig, devices } from '@playwright/test';

// Set CHROME_PATH to use an installed Chrome instead of Playwright's bundled browser.
const launchOptions = process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {};

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 30_000,
  fullyParallel: true,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3100',
    ...devices['Desktop Chrome'],
    launchOptions,
    trace: 'retain-on-failure'
  },
  webServer: {
    command: 'node src/server.js',
    env: { PORT: '3100' },
    url: 'http://localhost:3100',
    reuseExistingServer: !process.env.CI
  }
});
