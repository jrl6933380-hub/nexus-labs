import { expect, test } from '@playwright/test';

const visual = {
  room_id: 'conference-room',
  widget_code: '<main style="padding:24px"><h1 id="visual-title">Launch map</h1><button id="inside-widget">Inspect</button></main>',
  source: 'nex',
  locked: false,
  history: [
    { id: 'visual-1', widget_code: '<h1>Launch map</h1>', source: 'nex', created_at: '2026-09-18T12:00:00.000Z' },
  ],
  updated_at: '2026-09-18T12:00:00.000Z',
};

test('room panel renders a sandboxed visual and supports lock and minimize controls', async ({ page }) => {
  const pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route(/\/api\/room-auth(?:\?.*)?$/u, (route) => route.fulfill({ json: { username: 'owner' } }));
  await page.route(/\/api\/pinned-visuals(?:\?.*)?$/u, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON();
      if (body.action === 'set_lock') visual.locked = body.locked;
    }
    await route.fulfill({ json: { visual } });
  });

  await page.goto('/conference-room.html');
  const panel = page.locator('#nexPinnedVisualPanel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.pvp-history summary span')).toHaveText('1');
  await expect(panel.locator('iframe')).toHaveAttribute('sandbox', 'allow-scripts');
  await expect(panel.locator('iframe')).not.toHaveAttribute('sandbox', /allow-same-origin/u);
  await expect(panel.locator('iframe').contentFrame().locator('#visual-title')).toHaveText('Launch map');

  await panel.locator('.pvp-lock').click();
  await expect(panel).toHaveClass(/is-locked/u);
  await panel.locator('.pvp-minimize').click();
  await expect(panel).toHaveClass(/is-minimized/u);
  await expect(pageErrors).toEqual([]);
});
