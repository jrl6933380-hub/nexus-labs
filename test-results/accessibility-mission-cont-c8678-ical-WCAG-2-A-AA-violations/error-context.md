# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility.spec.mjs >> mission-control.html >> mission-control.html has no serious/critical WCAG 2 A/AA violations
- Location: e2e/accessibility.spec.mjs:48:5

# Error details

```
Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - main [ref=f1e2]:
    - region [ref=f1e3]:
      - generic [ref=f1e4]: Nexus Forge
      - heading "Your idea. A working site or app." [level=1] [ref=f1e5]: Your idea.A working site or app.
      - paragraph [ref=f1e6]: Describe what you want to Nex. He builds the first version, helps you improve it, and brings in additional AI models behind the scenes when the job needs more hands.
      - generic "How Nexus Forge works" [ref=f1e7]:
        - generic [ref=f1e8]:
          - generic [ref=f1e9]: "1"
          - generic [ref=f1e10]: Describe the result you want.
        - generic [ref=f1e11]:
          - generic [ref=f1e12]: "2"
          - generic [ref=f1e13]: Watch Nex build it live.
        - generic [ref=f1e14]:
          - generic [ref=f1e15]: "3"
          - generic [ref=f1e16]: Refine, preview, save, and export.
    - region "Nexus Forge account access" [ref=f1e17]:
      - generic [ref=f1e18]: AI Website & App Builder
      - generic [ref=f1e19]: Sign in to build with Nex.
      - generic [ref=f1e20]:
        - button "Sign in" [ref=f1e21] [cursor=pointer]
        - button "Create account" [ref=f1e22] [cursor=pointer]
      - generic [ref=f1e23]:
        - textbox "Username" [ref=f1e24]
        - textbox "Password" [ref=f1e25]
        - button "Sign in" [ref=f1e27] [cursor=pointer]
        - button "Forgot password?" [ref=f1e28] [cursor=pointer]
      - paragraph [ref=f1e29]:
        - strong [ref=f1e30]: Your work stays private to your account.
        - text: Creative credits are shown inside the builder, and complex builds stay automatic instead of becoming customer tickets.
  - text: ✓ ✓ ✓ ✓ ✓ ✓ ✓ ✓ ✓ ✓ ✓ ✓
```

# Test source

```ts
  1   | // e2e/accessibility.spec.mjs
  2   | // Real automated accessibility + mobile coverage for task 10.
  3   | //
  4   | // LIVES OUTSIDE test/ ON PURPOSE: Node's built-in test runner
  5   | // auto-discovers every file under test/ regardless of its name or
  6   | // extension, which broke the existing 246-test node:test suite the
  7   | // first time this file was placed there (Playwright's test()/expect
  8   | // aren't node:test's — confirmed by actually running node --test
  9   | // after adding it, not assumed safe). e2e/ keeps this Playwright suite
  10  | // completely separate from node --test's discovery.
  11  | //
  12  | // WHY THIS ISN'T A node:test FILE AT ALL: it needs an actual rendering
  13  | // engine. Two standard approaches were tried directly in the dev
  14  | // sandbox this project's agents use for verification, and BOTH
  15  | // reproducibly crash there — confirmed by isolated testing, not
  16  | // assumed:
  17  | //   1. Puppeteer/headless Chromium — the sandbox lacks the OS-level
  18  | //      shared libraries a spawned Chromium process needs (libnss3,
  19  | //      libatk-bridge2.0-0, etc.); even after installing them via
  20  | //      apt-get, the launch still failed with no diagnosable output,
  21  | //      suggesting a deeper resource constraint on spawning a native
  22  | //      GUI-class process there.
  23  | //   2. jsdom — segfaults on `new JSDOM(...)` in that same sandbox,
  24  | //      even in complete isolation with no other code involved.
  25  | // GitHub Actions' own Ubuntu runners reliably support
  26  | // `playwright install --with-deps`, which is the standard, correct
  27  | // place to run real browser-based tests — see
  28  | // .github/workflows/accessibility.yml. This file is real, structurally
  29  | // correct Playwright + axe-core code, written using the standard,
  30  | // officially-maintained @axe-core/playwright integration — it has not
  31  | // been run end-to-end by the agent that wrote it, because the dev
  32  | // sandbox cannot run it; it needs to run once in CI (or by Justin
  33  | // locally) to be verified for real.
  34  | 
  35  | import { test, expect } from '@playwright/test';
  36  | import AxeBuilder from '@axe-core/playwright';
  37  | import fs from 'node:fs';
  38  | import path from 'node:path';
  39  | import { fileURLToPath } from 'node:url';
  40  | 
  41  | const __dirname = path.dirname(fileURLToPath(import.meta.url));
  42  | const publicDir = path.join(__dirname, '..', 'public');
  43  | const pages = fs.readdirSync(publicDir).filter((file) => file.endsWith('.html'));
  44  | const pageUrl = (file) => file === 'canvas.html' ? '/canvas?id=mobile-test' : `/${file}`;
  45  | 
  46  | for (const file of pages) {
  47  |   test.describe(file, () => {
  48  |     test(`${file} has no serious/critical WCAG 2 A/AA violations`, async ({ page }) => {
  49  |       await page.emulateMedia({ reducedMotion: 'reduce' });
  50  |       await page.goto(pageUrl(file));
> 51  |       const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
      |                                                                                      ^ Error: page.evaluate: Execution context was destroyed, most likely because of a navigation
  52  |       const seriousOrWorse = results.violations.filter((v) => ['serious', 'critical'].includes(v.impact));
  53  |       if (seriousOrWorse.length > 0) {
  54  |         // Full detail in the CI log, not just a bare pass/fail —
  55  |         // someone fixing this shouldn't have to re-run it locally
  56  |         // just to see what's wrong.
  57  |         console.log(JSON.stringify(
  58  |           seriousOrWorse.map((v) => ({ id: v.id, impact: v.impact, help: v.help, affectedNodes: v.nodes.length })),
  59  |           null, 2,
  60  |         ));
  61  |       }
  62  |       expect(seriousOrWorse, `${file} has serious/critical accessibility violations — see log above`).toHaveLength(0);
  63  |     });
  64  | 
  65  |     test(`${file} declares a mobile viewport`, async ({ page }) => {
  66  |       await page.goto(pageUrl(file));
  67  |       const viewport = await page.locator('meta[name="viewport"]').getAttribute('content').catch(() => null);
  68  |       expect(viewport, `${file} is missing <meta name="viewport">`).not.toBeNull();
  69  |     });
  70  | 
  71  |     test(`${file} has no horizontal overflow at a 375px mobile width`, async ({ page }) => {
  72  |       await page.setViewportSize({ width: 375, height: 667 });
  73  |       await page.goto(pageUrl(file));
  74  |       const { scrollWidth, clientWidth } = await page.evaluate(() => ({
  75  |         scrollWidth: document.documentElement.scrollWidth,
  76  |         clientWidth: document.documentElement.clientWidth,
  77  |       }));
  78  |       // +1 tolerance for sub-pixel rounding, not to hide a real problem.
  79  |       expect(
  80  |         scrollWidth,
  81  |         `${file} overflows horizontally at 375px width (content is ${scrollWidth}px, viewport is ${clientWidth}px)`,
  82  |       ).toBeLessThanOrEqual(clientWidth + 1);
  83  |     });
  84  |   });
  85  | }
  86  | 
  87  | 
  88  | const canvasRooms = [
  89  |   ['index.html', 3], ['canvas.html', 1], ['connectors.html', 1],
  90  |   ['memory.html', 3], ['mission-control.html', 3], ['nexus-canvas.html', 3],
  91  |   ['queue.html', 1], ['room.html', 1], ['story-studio.html', 1], ['tenants.html', 2],
  92  | ];
  93  | 
  94  | test.describe('mobile canvas room interactions', () => {
  95  |   test.use({ viewport: { width: 393, height: 852 }, isMobile: true, hasTouch: true });
  96  | 
  97  |   for (const [file, expectedPanels] of canvasRooms) {
  98  |     test(`${file} keeps panels visible, bounded, and touch-draggable`, async ({ page }) => {
  99  |       const pageErrors = [];
  100 |       page.on('pageerror', (error) => pageErrors.push(error.message));
  101 |       await page.route('**/api/room-auth', (route) => route.fulfill({ json: { username: 'mobile-test' } }));
  102 |       await page.route('**/api/tenants**', (route) => route.fulfill({ json: { tenants: [] } }));
  103 |       await page.route('**/api/board**', (route) => {
  104 |         if (route.request().method() === 'POST') return route.fulfill({ json: { canvas: { id: 'mobile-test' } } });
  105 |         return route.fulfill({ status: 503, json: { error: 'test offline' } });
  106 |       });
  107 |       await page.goto(pageUrl(file));
  108 |       await expect(page.locator('.nexus-canvas-panel'), `${file} page errors: ${pageErrors.join(' | ')}; body: ${(await page.locator('body').innerText()).slice(0, 240)}`).toHaveCount(expectedPanels);
  109 |       await expect(page.locator('.nexus-canvas-panel:visible')).toHaveCount(expectedPanels);
  110 |       await expect(page.locator('.nexus-canvas-mobile-panels')).toHaveCount(0);
  111 |       const panel = page.locator('.nexus-canvas-panel:visible').first();
  112 |       await expect(panel).toBeVisible();
  113 |       const before = await panel.boundingBox();
  114 |       expect(before).not.toBeNull();
  115 |       expect(before.x).toBeGreaterThanOrEqual(0);
  116 |       expect(before.y).toBeGreaterThanOrEqual(0);
  117 |       expect(before.x + before.width).toBeLessThanOrEqual(393);
  118 |       expect(before.y + before.height).toBeLessThanOrEqual(852);
  119 |       await panel.locator('.nexus-canvas-panel-header').evaluate((element) => {
  120 |         element.setPointerCapture = () => {};
  121 |         element.hasPointerCapture = () => false;
  122 |         element.releasePointerCapture = () => {};
  123 |         const box = element.getBoundingClientRect();
  124 |         const startY = box.top + 20;
  125 |         const deltaY = box.top > 30 ? -30 : 30;
  126 |         const init = { pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: box.left + 20 };
  127 |         element.dispatchEvent(new PointerEvent('pointerdown', { ...init, clientY: startY, bubbles: true }));
  128 |         element.dispatchEvent(new PointerEvent('pointermove', { ...init, clientY: startY + deltaY, bubbles: true }));
  129 |         element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientY: startY + deltaY, bubbles: true }));
  130 |       });
  131 |       const after = await panel.boundingBox();
  132 |       expect(Math.abs(after.y - before.y)).toBeGreaterThan(5);
  133 |     });
  134 |   }
  135 | 
  136 |   test('the Agents panel has a working touch resize grip and no mobile switcher buttons', async ({ page }) => {
  137 |     await page.route('**/api/board**', (route) => {
  138 |       if (route.request().method() === 'POST') return route.fulfill({ json: { canvas: { id: 'dashboard' } } });
  139 |       return route.fulfill({ status: 503, json: { error: 'test offline' } });
  140 |     });
  141 |     await page.goto('/index.html');
  142 |     const panel = page.locator('.nexus-canvas-panel[data-panel-id="agent-list"]');
  143 |     const handle = panel.locator('.nexus-canvas-resize-handle');
  144 |     await expect(panel).toBeVisible();
  145 |     await expect(handle).toBeVisible();
  146 |     const handleBox = await handle.boundingBox();
  147 |     expect(handleBox.width).toBeGreaterThanOrEqual(44);
  148 |     expect(handleBox.height).toBeGreaterThanOrEqual(44);
  149 |     await expect(page.locator('.nexus-canvas-mobile-panel-button')).toHaveCount(0);
  150 |     const before = await panel.boundingBox();
  151 |     await handle.evaluate((element) => {
```