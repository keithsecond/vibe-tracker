'use strict';

const fs = require('fs');
const { defineConfig, devices } = require('@playwright/test');
const { DATA_FILE, DESCRIPTION_DIR } = require('./test/helpers/data');

const PORT = process.env.PORT || 3100;
const baseURL = `http://localhost:${PORT}`;

// In the managed sandbox a Chromium build is pre-installed at this path and
// "playwright install" must not run. Use it when present; otherwise (e.g. in
// GitHub Actions) fall back to Playwright's normal browser resolution, where
// the workflow installs the matching browser.
const PREINSTALLED_CHROMIUM = '/opt/pw-browsers/chromium';
const executablePath =
  process.env.PW_CHROMIUM_PATH ||
  (fs.existsSync(PREINSTALLED_CHROMIUM) ? PREINSTALLED_CHROMIUM : undefined);

module.exports = defineConfig({
  testDir: './test',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: {
    baseURL,
    trace: 'on-first-retry',
    ...(executablePath ? { launchOptions: { executablePath } } : {}),
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: 'node server.js',
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 30_000,
    env: {
      PORT: String(PORT),
      DATA_FILE,
      DESCRIPTION_DIR,
    },
  },
});
