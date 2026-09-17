# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: accessibility.spec.mjs >> conference-room.html >> conference-room.html has no serious/critical WCAG 2 A/AA violations
- Location: e2e/accessibility.spec.mjs:48:5

# Error details

```
Error: conference-room.html has serious/critical accessibility violations — see log above

expect(received).toHaveLength(expected)

Expected length: 0
Received length: 1
Received array:  [{"description": "Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds", "help": "Elements must meet minimum color contrast ratio thresholds", "helpUrl": "https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=playwright", "id": "color-contrast", "impact": "serious", "nodes": [{"all": [], "any": [{"data": {"bgColor": "#121b2a", "contrastRatio": 4.36, "expectedContrastRatio": "4.5:1", "fgColor": "#71819a", "fontSize": "8.3pt (11px)", "fontWeight": "bold", "messageKey": null}, "id": "color-contrast", "impact": "serious", "message": "Element has insufficient color contrast of 4.36 (foreground color: #71819a, background color: #121b2a, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1", "relatedNodes": [{"html": "<div class=\"panel-head\">", "target": [".workshop-grid > .work-panel > .panel-head"]}]}], "failureSummary": "Fix any of the following:
  Element has insufficient color contrast of 4.36 (foreground color: #71819a, background color: #121b2a, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1", "html": "<div class=\"panel-title\">Project benches</div>", "impact": "serious", "none": [], "target": [".workshop-grid > .work-panel > .panel-head > div:nth-child(1) > .panel-title"]}, {"all": [], "any": [{"data": {"bgColor": "#121b2a", "contrastRatio": 4.36, "expectedContrastRatio": "4.5:1", "fgColor": "#71819a", "fontSize": "8.3pt (11px)", "fontWeight": "bold", "messageKey": null}, "id": "color-contrast", "impact": "serious", "message": "Element has insufficient color contrast of 4.36 (foreground color: #71819a, background color: #121b2a, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1", "relatedNodes": [{"html": "<div class=\"panel-head\"><div><div class=\"panel-title\">Agent toolbox</div><div class=\"panel-sub\">Assign, then route through real capability checks</div></div></div>", "target": ["aside > .work-panel:nth-child(1) > .panel-head"]}]}], "failureSummary": "Fix any of the following:
  Element has insufficient color contrast of 4.36 (foreground color: #71819a, background color: #121b2a, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1", "html": "<div class=\"panel-title\">Agent toolbox</div>", "impact": "serious", "none": [], "target": ["aside > .work-panel:nth-child(1) > .panel-head > div > .panel-title"]}, {"all": [], "any": [{"data": {"bgColor": "#121b2a", "contrastRatio": 4.36, "expectedContrastRatio": "4.5:1", "fgColor": "#71819a", "fontSize": "8.3pt (11px)", "fontWeight": "bold", "messageKey": null}, "id": "color-contrast", "impact": "serious", "message": "Element has insufficient color contrast of 4.36 (foreground color: #71819a, background color: #121b2a, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1", "relatedNodes": [{"html": "<div class=\"panel-head\"><div><div class=\"panel-title\">Safety rails</div><div class=\"panel-sub\">Parallel without turning the repo into soup</div></div></div>", "target": [".work-panel:nth-child(2) > .panel-head"]}]}], "failureSummary": "Fix any of the following:
  Element has insufficient color contrast of 4.36 (foreground color: #71819a, background color: #121b2a, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1", "html": "<div class=\"panel-title\">Safety rails</div>", "impact": "serious", "none": [], "target": [".work-panel:nth-child(2) > .panel-head > div > .panel-title"]}, {"all": [], "any": [{"data": {"bgColor": "#121b2a", "contrastRatio": 4.36, "expectedContrastRatio": "4.5:1", "fgColor": "#71819a", "fontSize": "8.3pt (11px)", "fontWeight": "bold", "messageKey": null}, "id": "color-contrast", "impact": "serious", "message": "Element has insufficient color contrast of 4.36 (foreground color: #71819a, background color: #121b2a, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1", "relatedNodes": [{"html": "<div class=\"panel-head\"><div><div class=\"panel-title\">Open the work</div><div class=\"panel-sub\">Jump straight to the operational surfaces</div></div></div>", "target": [".work-panel:nth-child(3) > .panel-head"]}]}], "failureSummary": "Fix any of the following:
  Element has insufficient color contrast of 4.36 (foreground color: #71819a, background color: #121b2a, font size: 8.3pt (11px), font weight: bold). Expected contrast ratio of 4.5:1", "html": "<div class=\"panel-title\">Open the work</div>", "impact": "serious", "none": [], "target": [".work-panel:nth-child(3) > .panel-head > div > .panel-title"]}], "tags": ["cat.color", "wcag2aa", "wcag143", "TTv5", "TT13.c", "EN-301-549", "EN-9.1.4.3", "ACT", "RGAAv4", "RGAA-3.2.1"]}]
```

# Page snapshot

```yaml
- generic [active] [ref=e1]:
  - main [ref=e2]:
    - generic [ref=e3]:
      - generic [ref=e4]:
        - generic [ref=e5]: Nexus Labs // Operational Workshop
        - heading "JUSTIN + NEX WORKSHOP" [level=1] [ref=e6]
      - generic [ref=e7]:
        - generic [ref=e8] [cursor=pointer]: ○ OFFLINE
        - link "Board" [ref=e9] [cursor=pointer]:
          - /url: /
        - button "＋ New task" [ref=e10] [cursor=pointer]
    - generic [ref=e11]:
      - generic [ref=e12]: ◎
      - generic [ref=e13]:
        - generic [ref=e14]: One thing now
        - generic [ref=e15]: Choose the next thing worth finishing
        - generic [ref=e16]: Start one clear task. Everything else can wait.
      - generic [ref=e17]:
        - generic [ref=e19]: No active focus
        - button "Do next action" [ref=e20] [cursor=pointer]
    - generic [ref=e21]:
      - generic [ref=e22]:
        - generic [ref=e23]:
          - generic [ref=e24]:
            - generic [ref=e25]: // Project benches
            - generic [ref=e26]: 0 open · 0 done
          - generic [ref=e27]:
            - button "Active" [ref=e28] [cursor=pointer]
            - button "Ours" [ref=e29] [cursor=pointer]
            - button "Needs attention" [ref=e30] [cursor=pointer]
            - button "All" [ref=e31] [cursor=pointer]
        - generic [ref=e32]: Nothing in this lane. A rare and suspiciously peaceful moment.
      - complementary [ref=e34]:
        - generic [ref=e35]:
          - generic [ref=e37]:
            - generic [ref=e38]: // Agent toolbox
            - generic [ref=e39]: Assign, then route through real capability checks
          - generic [ref=e40]: No worker telemetry available.
        - generic [ref=e42]:
          - generic [ref=e44]:
            - generic [ref=e45]: // Safety rails
            - generic [ref=e46]: Parallel without turning the repo into soup
          - generic [ref=e47]:
            - generic [ref=e48]:
              - generic [ref=e49]: ✓
              - generic [ref=e50]: Dispatcher checks availability and capability before work starts.
            - generic [ref=e51]:
              - generic [ref=e52]: ✓
              - generic [ref=e53]: Task leases and idempotency prevent two workers from silently doing the same job.
            - generic [ref=e54]:
              - generic [ref=e55]: ✓
              - generic [ref=e56]: Medium/high-risk actions stop for explicit approval.
            - generic [ref=e57]:
              - generic [ref=e58]: ✓
              - generic [ref=e59]: Merges, live changes, and destructive actions remain gated.
        - generic [ref=e60]:
          - generic [ref=e62]:
            - generic [ref=e63]: // Open the work
            - generic [ref=e64]: Jump straight to the operational surfaces
          - generic [ref=e65]:
            - link "Command" [ref=e66] [cursor=pointer]:
              - /url: /mission-control.html
            - link "Approvals" [ref=e67] [cursor=pointer]:
              - /url: /queue.html
            - link "Agents" [ref=e68] [cursor=pointer]:
              - /url: /connectors.html
            - link "Projects" [ref=e69] [cursor=pointer]:
              - /url: /tenants.html
  - text: // // // // // //
  - status
  - generic [ref=e71]:
    - generic [ref=e72]:
      - generic [ref=e73]:
        - generic [aria-hidden] [ref=e74]: ⠿
        - generic [ref=e76]: Nex
        - generic [ref=e77]: Operational
      - generic [ref=e78]:
        - button "Share the current tab visually with Nex" [ref=e79] [cursor=pointer]:
          - generic [aria-hidden] [ref=e80]: Vision
        - button "Toggle spoken replies" [ref=e81] [cursor=pointer]:
          - generic [aria-hidden] [ref=e82]: Audio
        - button "Toggle chat" [ref=e83] [cursor=pointer]:
          - generic [ref=e84]: ⌃
    - log "Conversation with Nex" [ref=e85]:
      - generic [ref=e86]:
        - generic [ref=e87]: now
        - generic [ref=e88]: Ready for input. Type below to send a task or question.
    - generic [ref=e89]:
      - combobox "Model" [ref=e90]:
        - option "Auto" [selected]
        - option "Haiku"
        - option "Sonnet"
        - option "Opus"
      - combobox "Effort" [ref=e91]:
        - option "Auto" [selected]
        - option "Low"
        - option "Medium"
        - option "High"
      - button "Toggle deep thought" [pressed] [ref=e92] [cursor=pointer]: Deep
    - generic [ref=e93]:
      - button "Add a picture for Nex to see" [ref=e94] [cursor=pointer]: Pic
      - textbox "Command or question…" [ref=e95]
      - button "Speak to Nex" [ref=e96] [cursor=pointer]: Mic
      - button "Send message" [ref=e97] [cursor=pointer]: →
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
> 62  |       expect(seriousOrWorse, `${file} has serious/critical accessibility violations — see log above`).toHaveLength(0);
      |                                                                                                       ^ Error: conference-room.html has serious/critical accessibility violations — see log above
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
```