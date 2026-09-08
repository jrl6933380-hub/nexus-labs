// e2e/accessibility.spec.mjs
// Real automated accessibility + mobile coverage for task 10.
//
// LIVES OUTSIDE test/ ON PURPOSE: Node's built-in test runner
// auto-discovers every file under test/ regardless of its name or
// extension, which broke the existing 246-test node:test suite the
// first time this file was placed there (Playwright's test()/expect
// aren't node:test's — confirmed by actually running node --test
// after adding it, not assumed safe). e2e/ keeps this Playwright suite
// completely separate from node --test's discovery.
//
// WHY THIS ISN'T A node:test FILE AT ALL: it needs an actual rendering
// engine. Two standard approaches were tried directly in the dev
// sandbox this project's agents use for verification, and BOTH
// reproducibly crash there — confirmed by isolated testing, not
// assumed:
//   1. Puppeteer/headless Chromium — the sandbox lacks the OS-level
//      shared libraries a spawned Chromium process needs (libnss3,
//      libatk-bridge2.0-0, etc.); even after installing them via
//      apt-get, the launch still failed with no diagnosable output,
//      suggesting a deeper resource constraint on spawning a native
//      GUI-class process there.
//   2. jsdom — segfaults on `new JSDOM(...)` in that same sandbox,
//      even in complete isolation with no other code involved.
// GitHub Actions' own Ubuntu runners reliably support
// `playwright install --with-deps`, which is the standard, correct
// place to run real browser-based tests — see
// .github/workflows/accessibility.yml. This file is real, structurally
// correct Playwright + axe-core code, written using the standard,
// officially-maintained @axe-core/playwright integration — it has not
// been run end-to-end by the agent that wrote it, because the dev
// sandbox cannot run it; it needs to run once in CI (or by Justin
// locally) to be verified for real.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
const pages = fs.readdirSync(publicDir).filter((file) => file.endsWith('.html'));
const pageUrl = (file) => file === 'canvas.html' ? '/canvas?id=mobile-test' : `/${file}`;

for (const file of pages) {
  test.describe(file, () => {
    test(`${file} has no serious/critical WCAG 2 A/AA violations`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.goto(pageUrl(file));
      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      const seriousOrWorse = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
      if (seriousOrWorse.length > 0) {
        // Full detail in the CI log, not just a bare pass/fail —
        // someone fixing this shouldn't have to re-run it locally
        // just to see what's wrong.
        console.log(JSON.stringify(
          seriousOrWorse.map((v) => ({ id: v.id, impact: v.impact, help: v.help, affectedNodes: v.nodes.length })),
          null, 2,
        ));
      }
      expect(seriousOrWorse, `${file} has serious/critical accessibility violations — see log above`).toHaveLength(0);
    });

    test(`${file} declares a mobile viewport`, async ({ page }) => {
      await page.goto(pageUrl(file));
      const viewport = await page.locator('meta[name="viewport"]').getAttribute('content').catch(() => null);
      expect(viewport, `${file} is missing <meta name="viewport">`).not.toBeNull();
    });

    test(`${file} has no horizontal overflow at a 375px mobile width`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(pageUrl(file));
      const { scrollWidth, clientWidth } = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
      }));
      // +1 tolerance for sub-pixel rounding, not to hide a real problem.
      expect(
        scrollWidth,
        `${file} overflows horizontally at 375px width (content is ${scrollWidth}px, viewport is ${clientWidth}px)`,
      ).toBeLessThanOrEqual(clientWidth + 1);
    });
  });
}


const canvasRooms = [
  ['index.html', 3], ['canvas.html', 1], ['connectors.html', 1],
  ['memory.html', 3], ['mission-control.html', 3], ['nexus-canvas.html', 3],
  ['queue.html', 1], ['room.html', 1], ['tenants.html', 2],
];

test.describe('mobile canvas room interactions', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  for (const [file, expectedPanels] of canvasRooms) {
    test(`${file} keeps panels visible, bounded, and touch-draggable`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await page.route('**/api/room-auth', (route) => route.fulfill({ json: { username: 'mobile-test' } }));
      await page.route('**/api/tenants**', (route) => route.fulfill({ json: { tenants: [] } }));
      await page.route('**/api/board**', (route) => {
        if (route.request().method() === 'POST') return route.fulfill({ json: { canvas: { id: 'mobile-test' } } });
        return route.fulfill({ status: 503, json: { error: 'test offline' } });
      });
      await page.goto(pageUrl(file));
      await expect(page.locator('.nexus-canvas-panel'), `${file} page errors: ${pageErrors.join(' | ')}; body: ${(await page.locator('body').innerText()).slice(0, 240)}`).toHaveCount(expectedPanels);
      const panel = page.locator('.nexus-canvas-panel:visible').first();
      await expect(panel).toBeVisible();
      const before = await panel.boundingBox();
      expect(before).not.toBeNull();
      expect(before.x).toBeGreaterThanOrEqual(0);
      expect(before.y).toBeGreaterThanOrEqual(0);
      expect(before.x + before.width).toBeLessThanOrEqual(393);
      expect(before.y + before.height).toBeLessThanOrEqual(852);
      await panel.locator('.nexus-canvas-panel-header').evaluate((element) => {
        element.setPointerCapture = () => {};
        element.hasPointerCapture = () => false;
        element.releasePointerCapture = () => {};
        const box = element.getBoundingClientRect();
        const startY = box.top + 20;
        const deltaY = box.top > 30 ? -30 : 30;
        const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: box.left + 20 };
        element.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientY: startY, bubbles: true }));
        element.dispatchEvent(new PointerEvent('pointermove', { ...init, clientY: startY + deltaY, bubbles: true }));
        element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientY: startY + deltaY, bubbles: true }));
      });
      const after = await panel.boundingBox();
      expect(Math.abs(after.y - before.y)).toBeGreaterThan(5);
    });
  }
});
