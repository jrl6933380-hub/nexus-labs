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

async function stubRoomAuth(page, username = 'a11y-test', { owner = true } = {}) {
  await page.route(/\/api\/room-auth(?:\?.*)?$/, (route) => route.fulfill({ json: { username } }));
  if (owner) {
    await page.route(/\/api\/nexus-auth(?:\?.*)?$/, (route) => route.fulfill({
      json: { authenticated: true, owner: { id: username } },
    }));
  }
}

async function stubBoardCreate(page, canvasId = 'a11y-test') {
  await page.route(/\/api\/board(?:\?.*)?$/, (route) => {
    if (route.request().method() === 'POST') return route.fulfill({ json: { canvas: { id: canvasId } } });
    return route.fallback();
  });
}

async function stubBoardOffline(page) {
  await page.route(/\/api\/board(?:\?.*)?$/, (route) => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 503, json: { error: 'test offline' } });
    return route.fallback();
  });
}

for (const file of pages) {
  test.describe(file, () => {
    test(`${file} has no serious/critical WCAG 2 A/AA violations`, async ({ page }) => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await stubRoomAuth(page, 'a11y-test', { owner: file !== 'nexus-login.html' });
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
      await stubRoomAuth(page, 'a11y-test', { owner: file !== 'nexus-login.html' });
      await page.goto(pageUrl(file));
      const viewport = await page.locator('meta[name="viewport"]').getAttribute('content').catch(() => null);
      expect(viewport, `${file} is missing <meta name="viewport">`).not.toBeNull();
    });

    test(`${file} has no horizontal overflow at a 375px mobile width`, async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await stubRoomAuth(page, 'a11y-test', { owner: file !== 'nexus-login.html' });
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
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).not.toHaveClass(/is-collapsed/);
}

async function dragLocator(page, locator, { dx = 0, dy = 0, offsetX = 20, offsetY = 20 } = {}) {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  const startX = box.x + Math.min(offsetX, Math.max(8, box.width / 2));
  const startY = box.y + Math.min(offsetY, Math.max(8, box.height / 2));
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + dx, startY + dy, { steps: 8 });
  await page.mouse.up();
}

test.describe('mobile canvas room interactions', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  for (const [file, expectedPanels] of canvasRooms) {
    test(`${file} keeps panels visible, bounded, and usable on mobile`, async ({ page }) => {
      const pageErrors = [];
      page.on('pageerror', (error) => pageErrors.push(error.message));
      await stubRoomAuth(page, 'mobile-test');
      await stubBoardOffline(page);
      await stubBoardCreate(page, 'mobile-test');
      await page.route('**/api/tenants**', (route) => route.fulfill({ json: { tenants: [] } }));
      await page.goto(pageUrl(file));
      const panels = page.locator('.nexus-canvas-panel');
      await expect(panels, `${file} page errors: ${pageErrors.join(' | ')}; body: ${(await page.locator('body').innerText()).slice(0, 240)}`).toHaveCount(expectedPanels);
      await expect(page.locator('.nexus-canvas-mobile-panels')).toHaveCount(0);
      const usablePanels = await panels.evaluateAll((elements) => elements.filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return !element.hidden
          && style.display !== 'none'
          && style.visibility !== 'hidden'
          && rect.width > 0
          && rect.height > 0;
      }).length);
      expect(usablePanels).toBe(expectedPanels);
      const visiblePanels = page.locator('.nexus-canvas-panel:visible');
      const panel = visiblePanels.first();
      await expect(panel).toBeVisible();
      await expandPanelIfCollapsed(panel);
      const before = await panel.boundingBox();
      expect(before).not.toBeNull();
      expect(before.x).toBeGreaterThanOrEqual(0);
      expect(before.y).toBeGreaterThanOrEqual(0);
      expect(before.x + before.width).toBeLessThanOrEqual(393);
      expect(before.y + before.height).toBeLessThanOrEqual(852);
      if (!(await panel.evaluate((element) => element.classList.contains('is-workspace-locked')))) {
        const header = panel.locator('.nexus-canvas-panel-header');
        const headerBox = await header.boundingBox();
        expect(headerBox).not.toBeNull();
        const deltaY = headerBox.top > 30 ? -30 : 30;
        await dragLocator(page, header, { dy: deltaY });
        const after = await panel.boundingBox();
        expect(Math.abs(after.y - before.y)).toBeGreaterThan(5);
      }
    });
  }

  test('the Agents panel has a working touch resize grip and no mobile switcher buttons', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoardOffline(page);
    await stubBoardCreate(page, 'dashboard');
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
    await panel.locator('.nexus-canvas-panel-header').click({ position: { x: 24, y: 24 } });
    await page.mouse.move(handleBox.x + handleBox.width - 4, handleBox.y + handleBox.height - 4);
    await page.mouse.down();
    await page.mouse.move(handleBox.x + handleBox.width - 44, handleBox.y + handleBox.height - 34, { steps: 8 });
    await page.mouse.up();
    const after = await panel.boundingBox();
    expect(Math.abs(after.width - before.width)).toBeGreaterThan(5);
    expect(Math.abs(after.height - before.height)).toBeGreaterThan(5);
  });

  test('panels can use the full phone height below the old reserved dock strip', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoardOffline(page);
    await stubBoardCreate(page, 'dashboard');
    await page.goto('/index.html');
    const panel = page.locator('.nexus-canvas-panel[data-panel-id="board-summary"]');
    await expandPanelIfCollapsed(panel);
    await dragLocator(page, panel.locator('.nexus-canvas-panel-header'), { dy: 2000 });
    const box = await panel.boundingBox();
    const viewportHeight = page.viewportSize()?.height ?? 852;
    expect(box.y + box.height).toBeGreaterThan(820);
    expect(box.y + box.height).toBeLessThanOrEqual(viewportHeight);
  });

  test('every board minimizes to a launcher tile and restores its full size', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoardOffline(page);
    await stubBoardCreate(page, 'dashboard');
    await page.goto('/index.html');
    const panel = page.locator('.nexus-canvas-panel[data-panel-id="board-summary"]');
    const toggle = panel.locator('.nexus-canvas-panel-toggle');
    await expandPanelIfCollapsed(panel);
    const before = await panel.boundingBox();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await panel.locator('.nexus-canvas-panel-header').click({ position: { x: 24, y: 24 } });
    await toggle.click();
    const minimized = await panel.boundingBox();
    await expect(panel).toHaveClass(/is-collapsed/);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(panel.locator('.nexus-canvas-panel-body')).toBeHidden();
    expect(minimized.height).toBeLessThan(before.height);
    expect(minimized.width).toBeLessThan(before.width);
    const minimizedToggle = await toggle.boundingBox();
    expect(minimizedToggle).not.toBeNull();
    expect(minimizedToggle.width).toBeGreaterThanOrEqual(minimized.width - 2);
    expect(minimizedToggle.height).toBeGreaterThanOrEqual(minimized.height - 2);
    await toggle.click();
    const restored = await panel.boundingBox();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(Math.abs(restored.height - before.height)).toBeLessThanOrEqual(2.5);
    expect(Math.abs(restored.width - before.width)).toBeLessThanOrEqual(2.5);
  });

  test('locked workspace panels stay full-screen and keep their body visible on mobile', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoardOffline(page);
    await stubBoardCreate(page, 'room-builder');
    await page.goto('/room.html');
    const panel = page.locator('.nexus-canvas-panel[data-panel-id="room-builder"]');
    await expect(panel).toBeVisible();
    await expect(panel).toHaveClass(/is-workspace-locked/);
    await expect(panel.locator('.nexus-canvas-panel-header')).toBeHidden();
    await expect(panel.locator('.nexus-canvas-resize-handle')).toBeHidden();
    await expect(panel.locator('.nexus-canvas-panel-body')).toBeVisible();
    const box = await panel.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x).toBeLessThanOrEqual(1);
    expect(box.y).toBeLessThanOrEqual(1);
    expect(box.width).toBeGreaterThanOrEqual(viewport.width - 1);
    expect(box.width).toBeLessThanOrEqual(viewport.width);
    expect(box.height).toBeGreaterThanOrEqual(viewport.height - 1);
    expect(box.height).toBeLessThanOrEqual(viewport.height);
  });
});

test.describe('mobile build feedback', () => {
  test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });

  test('build feedback does not spawn a legacy floating mobile status pill', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await stubBoardOffline(page);
    await stubBoardCreate(page, 'dashboard');
    await page.goto('/index.html');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus:build-feedback', {
      detail: { state: 'running', tool: 'testing', label: 'Running client preview tests' },
    })));
    await expect(page.locator('.nexus-build-feedback')).toHaveCount(0);
  });
});
