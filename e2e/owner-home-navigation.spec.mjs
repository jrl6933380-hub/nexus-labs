import { test, expect } from '@playwright/test';

async function stubWorkspace(page) {
  await page.addInitScript(() => localStorage.setItem('nexus:simple-view:owner', 'workspace'));
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path === '/api/nexus-auth' ? { authenticated: true, owner: { id: 'navigation-owner' } }
      : path === '/api/room-auth' ? { username: 'navigation-owner' }
      : path === '/api/nexus-messages' ? { specialists: [], groups: [], roles: {}, scopes: [], pinned_system_ids: [] }
      : path === '/api/room-history' ? { projects: [], workbench: { operator: true, canCreate: true } }
      : path === '/api/chat' ? { threads: [], messages: [] }
      : { items: [], tasks: [], agents: [], accounts: [], customers: [], pulses: [] };
    return route.fulfill({ json: data });
  });
}

function shortcut(page, name) {
  return page.locator('.homespace').filter({ has: page.getByText(name, { exact: true }) });
}

for (const width of [320, 393, 1280]) {
  test.describe(`Owner tools at ${width}px`, () => {
    test.use({ viewport: { width, height: 850 } });
    test('Home opens all six owner tools and keeps Phone and Lab reachable', async ({ page }) => {
      await stubWorkspace(page);
      for (const path of ['/forge-hub.html', '/ads.html', '/board.html']) {
        await page.route('**' + path, route => route.fulfill({ contentType: 'text/html', body: '<h1>Destination fixture</h1>' }));
      }
      const destinations = [
        ['Forge Ops', '/forge-hub.html#ops'],
        ['Templates', '/forge-hub.html#templates'],
        ['Agent Board', 'deck'],
        ['Ad Maker', '/ads.html'],
        ['Image Board', '/board.html'],
        ['Story Studio', 'story'],
      ];
      for (const [name, target] of destinations) {
        await page.goto('/workspace.html?view=messages');
        await expect(shortcut(page, 'Phone')).toBeVisible();
        await expect(shortcut(page, 'Nexus Lab')).toBeVisible();
        const item = shortcut(page, name);
        await expect(item).toBeVisible();
        expect((await item.boundingBox()).height).toBeGreaterThanOrEqual(44);
        await expect(page.locator('body')).toHaveJSProperty('scrollWidth', width);
        await item.click();
        if (target.startsWith('/')) {
          await expect(page).toHaveURL(new URL(target, 'http://127.0.0.1:4173').href);
        } else {
          await expect(page.locator('body')).toHaveAttribute('data-view', target);
          if (target === 'deck') await expect(page.locator('iframe[title="Agent Board"]')).toHaveAttribute('src', '/agent-board.html?embed=1');
          await page.locator('#backMessages').click();
          await expect(shortcut(page, name)).toBeVisible();
        }
      }
    });

    test('Forge summary distinguishes Ops, Templates and customer builder', async ({ page }) => {
      await stubWorkspace(page);
      for (const path of ['/forge-hub.html', '/forge.html']) {
        await page.route('**' + path, route => route.fulfill({ contentType: 'text/html', body: '<h1>Destination fixture</h1>' }));
      }
      for (const [label, target] of [
        ['Open Forge Ops', '/forge-hub.html#ops'],
        ['Templates', '/forge-hub.html#templates'],
        ['Open customer builder', '/forge.html'],
      ]) {
        await page.goto('/workspace.html?view=forge');
        await page.getByRole('button', { name: label, exact: true }).click();
        await expect(page).toHaveURL(new URL(target, 'http://127.0.0.1:4173').href);
      }
    });

    test('shared customer Home omits every owner shortcut', async ({ page }) => {
      await stubWorkspace(page);
      await page.route('**/__customer-home-test', route => route.fulfill({
        contentType: 'text/html',
        body: `<html><body><script type="module">
          import {renderMessages} from '/nexus-messages.js';
          const home=await renderMessages({customer:true,recentThreads:()=>[],go:()=>{},openConversation:()=>{}});
          document.body.append(home);
        </script></body></html>`,
      }));
      await page.goto('/__customer-home-test');
      await expect(shortcut(page, 'More')).toBeVisible();
      for (const name of ['Phone', 'Nexus Lab', 'Forge Ops', 'Templates', 'Agent Board', 'Ad Maker', 'Image Board', 'Story Studio']) {
        await expect(shortcut(page, name)).toHaveCount(0);
      }
    });
  });
}

test('signed-out owner page redirects before tools render', async ({ page }) => {
  await page.route('**/api/nexus-auth', route => route.fulfill({ status: 401, json: { authenticated: false } }));
  await page.route('**/index.html?**', route => route.fulfill({ contentType: 'text/html', body: '<h1>Owner sign in</h1>' }));
  await page.goto('/workspace.html?view=messages');
  await expect(page).toHaveURL(/index.html\?mode=owner&next=/);
  await expect(page.getByRole('heading', { name: 'Owner sign in' })).toBeVisible();
  await expect(page.locator('.homespace')).toHaveCount(0);
});
