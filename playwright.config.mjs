// playwright.config.mjs
// Serves the public/ folder statically and points Playwright at it —
// this is the only config test/accessibility.spec.mjs needs. See that
// file's header for why this can't run in the dev sandbox and needs
// CI (or a local run by Justin) instead.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test',
  testMatch: /.*\.spec\.mjs/,
  webServer: {
    command: 'npx serve public -l 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://localhost:4173',
  },
});
