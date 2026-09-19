import { expect, test } from '@playwright/test';

async function mockNexus(page, visual = null, hooks = {}) {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/nexus-auth') return route.fulfill({ json: { owner: { id: 'mrlopez' } } });
    if (url.pathname === '/api/board') return route.fulfill({ json: { tasks: [], messages: [], agents: [], telemetry: { total_tasks: 8, completed_tasks: 5, needs_approval: 1, active_agents: 2 } } });
    if (url.pathname === '/api/chat') {
      if (route.request().method() === 'POST') hooks.onChatPost?.();
      return route.fulfill({ json: { messages: [] } });
    }
    if (url.pathname === '/api/pinned-visuals') return route.fulfill({ json: { visual } });
    if (url.pathname === '/api/nex/action') return route.fulfill({ json: { ok: true, snapshot: { tasks: [], agents: [], approvals: [], telemetry: {} } } });
    return route.fulfill({ status: 404, json: { error: 'not mocked' } });
  });
}

test('Thoughtspace uses one visual surface and tunes systems in place', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await mockNexus(page);
  await page.goto('/');

  await expect(page.locator('#nexus-visual-stage')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your whole operation, tuned into one view.' })).toBeVisible();
  await expect(page.locator('#nexChatBar.nex-thoughtspace-dock')).toBeVisible();
  await expect(page.locator('#nexChatBar .nex-chat-input')).toBeVisible();
  await expect(page.locator('#nexHomeButton')).toBeVisible();

  await page.getByRole('button', { name: /Nexus Forge/u }).click();
  await expect(page.getByRole('heading', { name: 'Nexus Forge' })).toBeVisible();
  await expect(page.getByText('Intent & Scope')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open live panel' }).first()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Change this' }).first()).toBeVisible();
  await expect(page).toHaveURL(/#forge$/u);

  await page.evaluate(() => window.dispatchEvent(new CustomEvent('nexus:navigate', { detail: { room: 'Story Studio', url: '/story-studio.html' } })));
  await expect(page.getByRole('heading', { name: 'Story Studio' })).toBeVisible();
  await expect(page).toHaveURL(/#story$/u);
  expect(pageErrors).toEqual([]);
});

test('phone view keeps one compact dock and a usable blank canvas', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockNexus(page);
  await page.goto('/');

  const dock = page.locator('#nexChatBar.nex-thoughtspace-dock');
  await expect(dock).toHaveClass(/collapsed/u);
  await expect(dock.locator('.nex-chat-input')).toBeVisible();
  await page.getByRole('button', { name: 'Blank Canvas' }).click();
  await expect(page.getByRole('heading', { name: 'Start with nothing.' })).toBeVisible();
  await expect(page.locator('#nexus-visual-stage')).toBeVisible();
});

test('known system commands move Thoughtspace without calling an AI', async ({ page }) => {
  let chatPosts = 0;
  await mockNexus(page, null, { onChatPost: () => { chatPosts += 1; } });
  await page.goto('/');

  const input = page.locator('#nexChatBar .nex-chat-input');
  await input.fill('show deployments');
  await input.press('Enter');

  await expect(page.getByRole('heading', { name: 'Command Deck' })).toBeVisible();
  await expect(page.locator('[data-section-title="Deployments"]')).toHaveClass(/is-focused/u);
  await expect(page.getByText('Deployments is in focus.')).toBeVisible();
  expect(chatPosts).toBe(0);
});
