// playwright.config.mjs
// Serves the public/ folder statically and points Playwright at
// e2e/ (deliberately NOT test/, which node --test auto-discovers —
// see e2e/accessibility.spec.mjs's header for why that matters). This
// is the only config that spec file needs.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.mjs/,
  webServer: {
    command: 'npm run dev -- --host 127.0.0.1 --port 4173',
    port: 4173,
    reuseExistingServer: !process.env.CI,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    launchOptions: process.env.NEXUS_TEST_BROWSER_PATH ? {executablePath:process.env.NEXUS_TEST_BROWSER_PATH,args:['--no-sandbox','--disable-dev-shm-usage']} : {},
  },
});
