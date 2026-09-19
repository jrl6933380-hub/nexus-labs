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
  ['canvas.html', 4], ['connectors.html', 1],
  ['memory.html', 4], ['mission-control.html', 4],
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

  test('the universal workspace keeps system views and the compact Nex dock usable on mobile', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await page.route(/\/api\/board(?:\?.*)?$/, (route) => route.fulfill({ json: { telemetry: { total_tasks: 8, completed_tasks: 5, needs_approval: 1, active_agents: 2 } } }));
    await page.route(/\/api\/pinned-visuals(?:\?.*)?$/, (route) => route.fulfill({ json: { visual: null } }));
    await page.goto('/index.html');
    await expect(page.locator('.workspace-card')).toHaveCount(6);
    await page.getByRole('button', { name: /AI Team/u }).click();
    await expect(page.getByRole('heading', { name: 'AI Team' })).toBeVisible();
    const dock = page.locator('#nexChatBar.nex-thoughtspace-dock');
    await expect(dock).toHaveClass(/collapsed/u);
    await expect(dock.locator('.nex-chat-input')).toBeVisible();
    const dockBox = await dock.boundingBox();
    expect(dockBox.height).toBeLessThanOrEqual(60);
  });

  test('the blank canvas uses the full visual stage above the universal dock', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await page.route(/\/api\/board(?:\?.*)?$/, (route) => route.fulfill({ json: { telemetry: {} } }));
    await page.route(/\/api\/pinned-visuals(?:\?.*)?$/, (route) => route.fulfill({ json: { visual: null } }));
    await page.goto('/index.html');
    await page.getByRole('button', { name: 'Blank Canvas' }).click();
    const blank = page.locator('.workspace-blank');
    await expect(blank).toBeVisible();
    const box = await page.locator('#nexus-visual-stage').boundingBox();
    expect(box.height).toBeGreaterThan(700);
  });

  test('Nexus home always returns from a system view to the visual overview', async ({ page }) => {
    await stubRoomAuth(page, 'mobile-test');
    await page.route(/\/api\/board(?:\?.*)?$/, (route) => route.fulfill({ json: { telemetry: {} } }));
    await page.route(/\/api\/pinned-visuals(?:\?.*)?$/, (route) => route.fulfill({ json: { visual: null } }));
    await page.goto('/index.html');
    await page.getByRole('button', { name: /Nexus Forge/u }).click();
    await expect(page.getByRole('heading', { name: 'Nexus Forge' })).toBeVisible();
    await page.locator('#nexHomeButton').click();
    await expect(page.getByRole('heading', { name: 'Your whole operation, tuned into one view.' })).toBeVisible();
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
