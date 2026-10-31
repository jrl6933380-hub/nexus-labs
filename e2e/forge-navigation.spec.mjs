import { test, expect } from '@playwright/test';

for (const width of [320, 393, 1280]) {
  test.describe(`Forge navigation at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } });

    test('owner can restore tabs, use keyboard and return home', async ({ page }) => {
      await page.route('**/api/room-history', route => route.fulfill({ json: { workbench: { operator: true } } }));
      await page.route('**/forge-dashboard.html', route => route.fulfill({ body: '<h1>Ops fixture</h1>', contentType: 'text/html' }));
      await page.route('**/forge-caller.html', route => route.fulfill({ body: '<h1>Field fixture</h1>', contentType: 'text/html' }));
      await page.route('**/forge-templates.html', route => route.fulfill({ body: '<h1>Templates fixture</h1>', contentType: 'text/html' }));
      await page.route('**/workspace.html?view=messages', route => route.fulfill({ body: '<h1>Home fixture</h1>', contentType: 'text/html' }));
      await page.goto('/forge-hub.html#templates');
      const templates = page.getByRole('tab', { name: 'Templates', exact: true });
      await expect(templates).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('#templates-frame')).toHaveAttribute('src', '/forge-templates.html');
      await templates.focus();
      await page.keyboard.press('Home');
      await expect(page.getByRole('tab', { name: 'Owner · Ops' })).toBeFocused();
      await page.keyboard.press('ArrowRight');
      await expect(page.getByRole('tab', { name: 'Caller · Field' })).toHaveAttribute('aria-selected', 'true');
      await page.reload();
      await expect(page.getByRole('tab', { name: 'Caller · Field' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
      const home = page.getByRole('link', { name: 'Nexus Home' });
      await expect(home).toBeVisible();
      expect((await home.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await home.click();
      await expect(page).toHaveURL(/workspace\.html\?view=messages$/);
    });

    test('admin opens outside the Ops iframe and returns to the hub', async ({ page }) => {
      await page.route('**/api/room-history', route => route.fulfill({ json: { workbench: { operator: true } } }));
      const dashboard = await page.request.get('/forge-dashboard.html');
      const adminLink = (await dashboard.text()).match(/<a href="\/forge-admin.html"[^>]*>Forge Admin<\/a>/)?.[0];
      expect(adminLink).toContain('target="_top"');
      await page.route('**/forge-dashboard.html', route => route.fulfill({
        body: adminLink, contentType: 'text/html'
      }));
      await page.goto('/forge-hub.html#ops');
      await page.frameLocator('#ops-frame').getByRole('link', { name: 'Forge Admin' }).click();
      await expect(page).toHaveURL(/forge-admin\.html$/);
      const back = page.getByRole('link', { name: 'Back to Forge Ops' });
      await expect(back).toHaveAttribute('target', '_top');
      expect((await back.boundingBox()).height).toBeGreaterThanOrEqual(44);
      await back.click();
      await expect(page).toHaveURL(/forge-hub\.html#ops$/);
      await expect(page.getByRole('tab', { name: 'Owner · Ops' })).toHaveAttribute('aria-selected', 'true');
      await expect(page.frameLocator('#ops-frame').getByRole('link', { name: 'Forge Admin' })).toBeVisible();
    });

    for (const status of [401, 200, 500]) {
      test(`denied or failed access (${status}) does not expose owner navigation or load panels`, async ({ page }) => {
        await page.route('**/api/room-history', route => route.fulfill({ status, json: { workbench: { operator: false } } }));
        await page.goto('/forge-hub.html');
        await expect(page.locator('#state')).not.toHaveText('Opening your Forge workspace…');
        await expect(page.getByRole('link', { name: 'Nexus Home' })).toBeHidden();
        await expect(page.locator('#tabs')).toBeHidden();
        await expect(page.locator('iframe[src]')).toHaveCount(0);
      });
    }
  });
}
