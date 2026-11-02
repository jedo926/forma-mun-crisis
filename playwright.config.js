// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './test/e2e',
  timeout: 30_000,
  retries: 1,
  workers: 1,               // run serially — all tests share the same live site
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL || 'https://forma-mun-crisis.vercel.app',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
    // Tolerate slow cold-start on serverless
    actionTimeout: 15_000,
    navigationTimeout: 20_000,
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
  ]
});
