import { test, expect } from '@playwright/test';

const paused = { reply: 'Progress saved.', runState: { state: 'waiting', runId: 'nex-turn-12345678', blocker: 'runaway_safety_ceiling_hit', nextSafeAction: 'Run tests.' } };
const stream = data => `event: result\ndata: ${JSON.stringify(data)}\n\n`;
async function fixture(page, handler) {
  await page.route('**/recovery-test', route => route.fulfill({ contentType: 'text/html', body: '<html><body style="background:#101820"><script type="module" src="/nex-chat-bar.js"></script></body></html>' }));
  await page.route('**/api/chat**', handler);
  await page.goto('/recovery-test');
  if (await page.locator('#nexChatBar').evaluate(el => el.classList.contains('collapsed'))) await page.getByRole('button', { name: 'Toggle chat' }).click();
  await expect(page.locator('#nexSend')).toBeVisible();
}

test('one current activity, bounded milestones, pause and Continue send the saved run id once', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const posts = [];
  await fixture(page, route => {
    if (route.request().method() === 'GET') return route.fulfill({ json: { messages: [] } });
    posts.push(route.request().postDataJSON());
    const stages = Array.from({ length: 30 }, (_, i) => `event: stage\ndata: ${JSON.stringify({ state: i % 2 ? 'complete' : 'running', label: 'Patching file', tool: 'patch_repo_file' })}\n\n`).join('');
    return route.fulfill({ contentType: 'text/event-stream', body: stages + stream(paused) });
  });
  await page.locator('.nex-chat-input').fill('Start the build');
  await page.locator('#nexSend').click();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await expect(page.locator('[data-nex-activity]')).toHaveCount(1);
  await expect(page.locator('[data-nex-milestones] > div')).toHaveCount(5);
  await expect(page.locator('[data-nex-milestones]')).not.toHaveAttribute('open');
  await page.getByRole('button', { name: 'Continue', exact: true }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(350);
  await page.screenshot({ path: 'test-results/nex-recovery-mobile.png' });
  await page.getByRole('button', { name: 'Continue', exact: true }).click();
  await expect.poll(() => posts.length).toBe(2);
  expect(posts[1].resumeRunId).toBe(paused.runState.runId);
});

test('reload recovers finished request and Continue without replaying a POST', async ({ page }) => {
  let posts = 0;
  await fixture(page, route => {
    if (route.request().method() === 'POST') { posts++; return route.abort(); }
    if (route.request().url().includes('requestId=')) return route.fulfill({ json: { request: { state: 'finished', response: paused } } });
    return route.fulfill({ json: { messages: [{ role: 'assistant', content: paused.reply }] } });
  });
  await page.locator('.nex-chat-input').fill('Build it');
  await page.locator('#nexSend').click();
  await expect(page.getByRole('button', { name: 'Check status' })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  expect(posts).toBe(1);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  expect(posts).toBe(1);
});

test('running status never replays work or offers Continue', async ({ page }) => {
  let posts = 0;
  await fixture(page, route => {
    if (route.request().method() === 'POST') { posts++; return route.abort(); }
    if (route.request().url().includes('requestId=')) return route.fulfill({ json: { request: { state: 'running', updatedAt: Date.now() } } });
    return route.fulfill({ json: { messages: [] } });
  });
  await page.locator('.nex-chat-input').fill('Build it');
  await page.locator('#nexSend').click();
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.locator('[data-nex-activity]')).toContainText('still processing');
  await page.locator('.nex-chat-input').fill('Again');
  await page.locator('#nexSend').click();
  expect(posts).toBe(1);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
});
