# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility.spec.mjs >> mobile canvas room interactions >> nexus-canvas.html keeps panels visible, bounded, and touch-draggable
- Location: e2e/accessibility.spec.mjs:98:5

# Error details

```
Error: nexus-canvas.html page errors: ; body: ⠿
Nex
Vision
⌃
N
Operations
+
Agent Network
+
Command Deck
+
Conference Room
+
Forge Builder
+
Story Studio
+
Memory Archive
+
Approval Queue
+
Connector Bay
+
Tenant Hub
+
New Venture
+
All Apps
+
Appearance

expect(locator).toHaveCount(expected) failed

Locator:  locator('.nexus-canvas-panel')
Expected: 3
Received: 12
Timeout:  5000ms

Call log:
  - nexus-canvas.html page errors: ; body: ⠿
Nex
Vision
⌃
N
Operations
+
Agent Network
+
Command Deck
+
Conference Room
+
Forge Builder
+
Story Studio
+
Memory Archive
+
Approval Queue
+
Connector Bay
+
Tenant Hub
+
New Venture
+
All Apps
+
Appearance locator('.nexus-canvas-panel') with timeout 5000ms
  - waiting for locator('.nexus-canvas-panel')
    14 × locator resolved to 12 elements
       - unexpected value "12"

```

# Page snapshot

```yaml
- generic [active] [ref=f1e1]:
  - generic [ref=f1e4]:
    - generic [ref=f1e5]:
      - generic [aria-hidden] [ref=f1e6]: ⠿
      - generic [ref=f1e8]: Nex
    - generic [ref=f1e9]:
      - button "Share the current tab visually with Nex" [ref=f1e10] [cursor=pointer]:
        - generic [aria-hidden] [ref=f1e11]: Vision
      - button "Toggle chat" [ref=f1e12] [cursor=pointer]:
        - generic [ref=f1e13]: ⌃
  - generic [ref=f1e14]:
    - generic "Nexus — Venture Factory":
      - generic [aria-hidden]: "N"
    - generic [ref=f1e17] [cursor=pointer]:
      - generic [ref=f1e18]: ▥ Operations
      - button "Restore Operations" [ref=f1e20]:
        - generic [aria-hidden] [ref=f1e21]: +
    - generic [ref=f1e23] [cursor=pointer]:
      - generic [ref=f1e24]: ◎ Agent Network
      - button "Restore Agent Network" [ref=f1e26]:
        - generic [aria-hidden] [ref=f1e27]: +
    - generic [ref=f1e29] [cursor=pointer]:
      - generic [ref=f1e30]: C Command Deck
      - button "Restore Command Deck" [ref=f1e32]:
        - generic [aria-hidden] [ref=f1e33]: +
    - generic [ref=f1e35] [cursor=pointer]:
      - generic [ref=f1e36]: C Conference Room
      - button "Restore Conference Room" [ref=f1e38]:
        - generic [aria-hidden] [ref=f1e39]: +
    - generic [ref=f1e41] [cursor=pointer]:
      - generic [ref=f1e42]: F Forge Builder
      - button "Restore Forge Builder" [ref=f1e44]:
        - generic [aria-hidden] [ref=f1e45]: +
    - generic [ref=f1e47] [cursor=pointer]:
      - generic [ref=f1e48]: S Story Studio
      - button "Restore Story Studio" [ref=f1e50]:
        - generic [aria-hidden] [ref=f1e51]: +
    - generic [ref=f1e53] [cursor=pointer]:
      - generic [ref=f1e54]: M Memory Archive
      - button "Restore Memory Archive" [ref=f1e56]:
        - generic [aria-hidden] [ref=f1e57]: +
    - generic [ref=f1e59] [cursor=pointer]:
      - generic [ref=f1e60]: A Approval Queue
      - button "Restore Approval Queue" [ref=f1e62]:
        - generic [aria-hidden] [ref=f1e63]: +
    - generic [ref=f1e65] [cursor=pointer]:
      - generic [ref=f1e66]: C Connector Bay
      - button "Restore Connector Bay" [ref=f1e68]:
        - generic [aria-hidden] [ref=f1e69]: +
    - generic [ref=f1e71] [cursor=pointer]:
      - generic [ref=f1e72]: T Tenant Hub
      - button "Restore Tenant Hub" [ref=f1e74]:
        - generic [aria-hidden] [ref=f1e75]: +
    - generic [ref=f1e77] [cursor=pointer]:
      - generic [ref=f1e78]: + New Venture
      - button "Restore New Venture" [ref=f1e80]:
        - generic [aria-hidden] [ref=f1e81]: +
    - generic [ref=f1e83] [cursor=pointer]:
      - generic [ref=f1e84]: A All Apps
      - button "Restore All Apps" [ref=f1e86]:
        - generic [aria-hidden] [ref=f1e87]: +
  - group [ref=f1e88]:
    - generic "◐Appearance" [ref=f1e89] [cursor=pointer]
```

# Test source

```ts
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
  51  |       const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze();
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
> 108 |       await expect(page.locator('.nexus-canvas-panel'), `${file} page errors: ${pageErrors.join(' | ')}; body: ${(await page.locator('body').innerText()).slice(0, 240)}`).toHaveCount(expectedPanels);
      |                                                                                                                                                                            ^ Error: nexus-canvas.html page errors: ; body: ⠿
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
  152 |       element.setPointerCapture = () => {};
  153 |       element.hasPointerCapture = () => false;
  154 |       element.releasePointerCapture = () => {};
  155 |       const box = element.getBoundingClientRect();
  156 |       const init = {
  157 |         pointerId: 11, pointerType: 'touch', isPrimary: true,
  158 |         button: 0, buttons: 1, clientX: box.left + 8, clientY: box.top + 8,
  159 |       };
  160 |       element.dispatchEvent(new PointerEvent('pointerdown', { ...init, bubbles: true }));
  161 |       element.dispatchEvent(new PointerEvent('pointermove', { ...init, clientX: init.clientX - 40, clientY: init.clientY - 30, bubbles: true }));
  162 |       element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientX: init.clientX - 40, clientY: init.clientY - 30, bubbles: true }));
  163 |     });
  164 |     const after = await panel.boundingBox();
  165 |     expect(Math.abs(after.width - before.width)).toBeGreaterThan(5);
  166 |     expect(Math.abs(after.height - before.height)).toBeGreaterThan(5);
  167 |   });
  168 | 
  169 |   test('panels can use the full phone height below the old reserved dock strip', async ({ page }) => {
  170 |     await page.route('**/api/board**', (route) => {
  171 |       if (route.request().method() === 'POST') return route.fulfill({ json: { canvas: { id: 'dashboard' } } });
  172 |       return route.fulfill({ status: 503, json: { error: 'test offline' } });
  173 |     });
  174 |     await page.goto('/index.html');
  175 |     const panel = page.locator('.nexus-canvas-panel').first();
  176 |     await panel.locator('.nexus-canvas-panel-header').evaluate((element) => {
  177 |       element.setPointerCapture = () => {};
  178 |       element.hasPointerCapture = () => false;
  179 |       element.releasePointerCapture = () => {};
  180 |       const box = element.getBoundingClientRect();
  181 |       const init = { pointerId: 21, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1, clientX: box.left + 20, clientY: box.top + 20 };
  182 |       element.dispatchEvent(new PointerEvent('pointerdown', { ...init, bubbles: true }));
  183 |       element.dispatchEvent(new PointerEvent('pointermove', { ...init, clientY: init.clientY + 2000, bubbles: true }));
  184 |       element.dispatchEvent(new PointerEvent('pointerup', { ...init, buttons: 0, clientY: init.clientY + 2000, bubbles: true }));
  185 |     });
  186 |     const box = await panel.boundingBox();
  187 |     expect(box.y + box.height).toBeGreaterThan(820);
  188 |     expect(box.y + box.height).toBeLessThanOrEqual(844.5);
  189 |   });
  190 | 
  191 |   test('every board minimizes to its name bar and restores its full size', async ({ page }) => {
  192 |     await page.route('**/api/board**', (route) => {
  193 |       if (route.request().method() === 'POST') return route.fulfill({ json: { canvas: { id: 'dashboard' } } });
  194 |       return route.fulfill({ status: 503, json: { error: 'test offline' } });
  195 |     });
  196 |     await page.goto('/index.html');
  197 |     const panel = page.locator('.nexus-canvas-panel').first();
  198 |     const toggle = panel.locator('.nexus-canvas-panel-toggle');
  199 |     const before = await panel.boundingBox();
  200 |     await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  201 |     await toggle.click();
  202 |     const minimized = await panel.boundingBox();
  203 |     await expect(panel).toHaveClass(/is-collapsed/);
  204 |     await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  205 |     await expect(panel.locator('.nexus-canvas-panel-body')).toBeHidden();
  206 |     expect(minimized.height).toBeLessThan(70);
  207 |     // Chromium can report the panel's border-box two physical pixels wider
  208 |     // after the first style/layout flush; the content width must stay stable.
```