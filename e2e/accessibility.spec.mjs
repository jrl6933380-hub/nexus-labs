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

async function stubRoomAuth(page, username = 'a11y-test') {
  await page.route('**/api/room-auth**', (route) => route.fulfill({ json: { username } }));
}

async function stubBoard(page, canvasId = 'a11y-test') {
  await page.route('**/api/board**', (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { canvas: { id: canvasId } } });
    return route.fulfill({ status: 503, json: { error: 'test offline' } });
  });
}

for (const file of pages) {
  test.describe(file, () => {
    test(`${file} has no serious/critical WCAG 2 A/AA violations`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await stubRoomAuth(page);
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
      await stubRoomAuth(page);
      await page.goto(pageUrl(file));
      const viewport = await page.locator('meta[name="viewport"]').getAttribute('content').catch(() => null);
      expect(viewport, `${file} is missing <meta name="viewport">`).not.toBeNull();
    });

    test(`${file} has no horizontal overflow at a 375px mobile width`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await stubRoomAuth(page);
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
  ['index.html', 12], ['canvas.html', 4], ['connectors.html', 1],
  ['memory.html', 4], ['mission-control.html', 4], ['nexus-canvas.html', 12],
  ['queue.html', 1], ['room.html', 1], ['story-studio.html', 1], ['tenants.html', 2],
];

async function expandPanelIfCollapsed(panel) {
  if (!(await panel.evaluate((element) => element.classList.contains('is-collapsed')))) return;
  const toggle = panel.locator('.nexus-canvas-panel-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).not.toHaveClass(/is-collapsed/);
}

test.describe('mobile canvas room interactions', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  for (const [file, expectedPanels] of canvasRooms) {
    test(`${file} keeps panels visible, bounded, and usable on mobile`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await stubRoomAuth(page, 'mobile-test');
      await stubBoard(page, 'mobile-test');
      await page.route('**/api/tenants**', (route) => route.fulfill({ json: { tenants: [] } }));
      await page.goto(pageUrl(file));
      await expect(page.locator('.nexus-canvas-panel'), `${file} page errors: ${pageErrors.join(' | ')}; body: ${(await page.locator('body').innerText()).slice(0, 240)}`).toHaveCount(expectedPanels);
      await expect(page.locator('.nexus-canvas-mobile-panels')).toHaveCount(0);
      const visiblePanels = page.locator('.nexus-canvas-panel:visible');
      expect(await visiblePanels.count()).toBeGreaterThan(0);
      const panel = visiblePanels.first();
      await expect(panel).toBeVisible();
      await expandPanelIfCollapsed(panel);
      const before = await panel.boundingBox();
      expect(before).not.toBeNull();
      expect(before.x).toBeGreaterThanOrEqual(0);
      expect(before.y).toBeGreaterThanOrEqual(0);
      expect(before.x + before.width).toBeLessThanOrEqual(393);
      expect(before.y + before.height).toBeLessThanOrEqual(852);
      if (await panel.evaluate((element) => element.classList.contains('is-workspace-locked'))) return;
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

  test('the Agents panel has a working touch resize grip and no mobile switcher buttons', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoard(page, 'dashboard');
    await page.goto('/index.html');
    const panel = page.locator('.nexus-canvas-panel[data-panel-id="agent-list"]');
    const handle = panel.locator('.nexus-canvas-resize-handle');
    await expect(panel).toBeVisible();
    await expandPanelIfCollapsed(panel);
    await expect(handle).toBeVisible();
    const handleBox = await handle.boundingBox();
    expect(handleBox.width).toBeGreaterThanOrEqual(44);
    expect(handleBox.height).toBeGreaterThanOrEqual(44);
    await expect(page.locator('.nexus-canvas-mobile-panel-button')).toHaveCount(0);
    const before = await panel.boundingBox();
    await handle.evaluate((element) => {
      element.setPointerCapture = () => {};
      element.hasPointerCapture = () => false;
      element.releasePointerCapture = () => {};
      const box = element.getBoundingClientRect();
      const init = {
        pointerId: 11, pointerType: 'touch', isPrimary: true,
        button: 0, buttons: 1, clientX: box.left + 8, clientY: box.top + 8,
      };
      element.dispatchEvent(new PointerEvent('pointerdown', { ...init, bubbles: true }));
      element.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: init.clientX - 40, clientY: init.clientY - 30, bubbles: true }));
      element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientX: init.clientX - 40, clientY: init.clientY - 30, bubbles: true }));
    });
    const after = await panel.boundingBox();
    expect(Math.abs(after.width - before.width)).toBeGreaterThan(5);
    expect(Math.abs(after.height - before.height)).toBeGreaterThan(5);
  });

  test('panels can use the full phone height below the old reserved dock strip', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoard(page, 'dashboard');
    await page.goto('/index.html');
    const panel = page.locator('.nexus-canvas-panel[data-panel-id="board-summary"]');
    await expandPanelIfCollapsed(panel);
    await panel.locator('.nexus-canvas-panel-header').evaluate((element) => {
      element.setPointerCapture = () => {};
      element.hasPointerCapture = () => false;
      element.releasePointerCapture = () => {};
      const box = element.getBoundingClientRect();
      const init = { pointerId: 21, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: box.left + 20, clientY: box.top + 20 };
      element.dispatchEvent(new PointerEvent('pointerdown', { ...init, bubbles: true }));
      element.dispatchEvent(new PointerEvent('pointermove', { ...init, clientY: init.clientY + 2000, bubbles: true }));
      element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientY: init.clientY + 2000, bubbles: true }));
    });
    const box = await panel.boundingBox();
    expect(box.y + box.height).toBeGreaterThan(820);
    expect(box.y + box.height).toBeLessThanOrEqual(844.5);
  });

  test('every board minimizes to a launcher tile and restores its full size', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoard(page, 'dashboard');
    await page.goto('/index.html');
    const panel = page.locator('.nexus-canvas-panel[data-panel-id="board-summary"]');
    const toggle = panel.locator('.nexus-canvas-panel-toggle');
    await expandPanelIfCollapsed(panel);
    const before = await panel.boundingBox();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await toggle.press('Enter');
    const minimized = await panel.boundingBox();
    await expect(panel).toHaveClass(/is-collapsed/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.locator('.nexus-canvas-panel-body')).toBeHidden();
    expect(minimized.height).toBeLessThan(before.height);
    expect(minimized.width).toBeLessThan(before.width);
    const minimizedToggle = await toggle.boundingBox();
    expect(minimizedToggle.width).toBeGreaterThanOrEqual(minimized.width - 2);
    expect(minimizedToggle.height).toBeGreaterThanOrEqual(minimized.height - 2);
    await toggle.press('Enter');
    const restored = await panel.boundingBox();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(Math.abs(restored.height - before.height)).toBeLessThanOrEqual(2.5);
  });

  test('locked workspace panels stay full-screen and keep their body visible on mobile', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoard(page, 'room-builder');
    await page.goto('/room.html');
    const panel = page.locator('.nexus-canvas-panel[data-panel-id="room-builder"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/is-workspace-locked/);
    await expect(panel.locator('.nexus-canvas-panel-header')).toBeHidden();
    await expect(panel.locator('.nexus-canvas-resize-handle')).toBeHidden();
    await expect(panel.locator('.nexus-canvas-panel-body')).toBeVisible();
    const box = await panel.boundingBox();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.y).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(392);
    expect(box.width).toBeLessThanOrEqual(393);
    expect(box.height).toBeGreaterThanOrEqual(851);
    expect(box.height).toBeLessThanOrEqual(852);
  });
});

test.describe('mobile build feedback', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  test('build feedback does not spawn a legacy floating mobile status pill', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoard(page, 'dashboard');
    await page.goto('/index.html');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus:build-feedback', {
      detail: { state: 'running', tool: 'testing', label: 'Running client preview tests' },
    })));
    await expect(page.locator('.nexus-build-feedback')).toHaveCount(0);
  });
});
