import { test, expect } from '@playwright/test';

const routes = [
  ['/memory.html', 'Memory', 'memory'],
  ['/nexus-canvas.html', 'Home', 'messages'],
  ['/queue.html', 'Approvals', 'approvals'],
  ['/connectors.html', 'Skills', 'skills'],
  ['/tenants.html', 'Forge', 'forge'],
];
for (const width of [393, 1280]) {
  test.describe('Legacy compatibility pages at ' + width + 'px', () => {
    test.use({ viewport: { width, height: 852 } });
    for (const [oldPath, label, view] of routes) {
      test(oldPath + ' redirects before making legacy API calls', async ({ page }) => {
        const calls = [];
        await page.route('**/api/**', route => { calls.push(route.request().url()); return route.abort(); });
        await page.route('**/workspace.html?view=' + view, route => route.fulfill({
          contentType: 'text/html', body: '<!doctype html><html><body><h1>Canonical destination</h1></body></html>'
        }));
        await page.goto(oldPath);
        await expect(page).toHaveURL(url => url.pathname === '/workspace.html' && url.searchParams.get('view') === view);
        await expect(page.getByRole('heading', {name: 'Canonical destination'})).toBeVisible();
        expect(calls).toEqual([]);
      });
      test(oldPath + ' offers the destination without JavaScript', async ({ browser, baseURL }) => {
        const context = await browser.newContext({ javaScriptEnabled: false, viewport: {width, height: 852} });
        try {
          const page = await context.newPage();
          await page.goto(baseURL + oldPath);
          const link = page.getByRole('link', { name: 'Open ' + label + ' in Nexus' });
          await expect(link).toBeVisible();
          await expect(link).toHaveAttribute('href', '/workspace.html?view=' + view);
          await expect(page.locator('main')).toBeVisible();
          const overflow = await page.locator('html').evaluate(el => el.scrollWidth > el.clientWidth);
          expect(overflow).toBe(false);
        } finally { await context.close(); }
      });
    }
  });
}
