import { expect, test } from '@playwright/test';

async function mockNexus(page) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/nexus-auth') return route.fulfill({ json: { owner: { id: 'mrlopez' } } });
    if (url.pathname === '/api/ventures') return route.fulfill({ json: { ventures: [] } });
    if (url.pathname === '/api/board') {
      return route.fulfill({ json: {
        tasks: [], messages: [], agents: [], telemetry: { total_tasks: 0, completed_tasks: 0, needs_approval: 0, active_agents: 0 },
        canvas: { id: 'dashboard', panels: {} },
      } });
    }
    if (url.pathname === '/api/chat') return route.fulfill({ json: { messages: [] } });
    if (url.pathname === '/api/room-auth') return route.fulfill({ json: { username: 'owner' } });
    if (url.pathname === '/api/pinned-visuals') return route.fulfill({ json: { visual: null } });
    return route.fulfill({ status: 404, json: { error: 'not mocked' } });
  });
}

test('Thoughtspace focuses live rooms without leaving the owner dashboard', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mockNexus(page);
  await page.goto('/');

  await expect(page.locator('#nexus-canvas-root')).toHaveClass(/is-spatial/u);
  const unifiedDock = page.locator('#nexChatBar.nex-thoughtspace-dock');
  await expect(unifiedDock).toBeVisible();
  await expect(unifiedDock.locator('.nexus-canvas-cockpit')).toBeVisible();
  await expect(page.locator('#nexus-canvas-root > .nexus-canvas-cockpit')).toHaveCount(0);
  await expect(page.locator('#nexus-canvas-world')).not.toHaveCSS('transform', 'none');

  const command = page.locator('[data-panel-id="thoughtspace-mission"]');
  await expect(command).toHaveClass(/is-collapsed/u);
  await command.locator('.nexus-canvas-panel-toggle').click();
  await expect(command).not.toHaveClass(/is-collapsed/u);
  await expect(command).toHaveClass(/is-focused/u);
  await expect(command.locator('iframe.nexus-portal-frame')).toHaveAttribute('src', /mission-control\.html\?nexus_embed=1/u);
  await expect(page).toHaveURL(/\/#thoughtspace-mission$/u);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus:navigate', { detail: { room: 'Story Studio', url: '/story-studio.html' } })));
  const story = page.locator('[data-panel-id="thoughtspace-story"]');
  await expect(story).toHaveClass(/is-focused/u);
  await expect(story.locator('iframe.nexus-portal-frame')).toHaveAttribute('src', /story-studio\.html\?nexus_embed=1/u);
  await expect(page.locator('body > #nexChatBar')).toHaveCount(1);
  await expect(story.locator('iframe').contentFrame().locator('#nexChatBar')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('phone view keeps the launcher and static cockpit usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockNexus(page);
  await page.goto('/');

  await expect(page.locator('.nexus-canvas-cockpit .nexus-canvas-overview')).toBeVisible();
  await expect(page.locator('.nexus-canvas-cockpit .nexus-canvas-home')).toBeVisible();
  await expect(page.locator('.nexus-canvas-cockpit .nexus-canvas-zoom-in')).toBeHidden();
  await expect(page.locator('#nexChatBar.nex-thoughtspace-dock')).toHaveClass(/collapsed/u);
  const command = page.locator('[data-panel-id="thoughtspace-mission"]');
  await expect(command).toHaveClass(/is-collapsed/u);
  await command.locator('.nexus-canvas-panel-toggle').click();
  await expect(command).not.toHaveClass(/is-collapsed/u);
  await expect(command.locator('iframe')).toBeVisible();
});
