import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [root, login, forge, forgeViews, room] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/room-login.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge-views.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/room.html', import.meta.url), 'utf8'),
]);

test('root preserves the owner launch station and opens the guest-capable builder', () => {
  assert.match(root, /fetch\('\/api\/nexus-auth'/u);
  assert.match(root, /location\.replace\('\/workspace\.html'\)/u);
  assert.doesNotMatch(root, /fetch\('\/api\/room-auth'/u);
  assert.match(root, /location\.replace\('\/room\.html'\)/u);
  assert.match(root, /href="\/room\.html"/u);
  assert.doesNotMatch(root, /location\.replace\('\/room-login\.html/u);
  assert.doesNotMatch(root, /http-equiv="refresh"/u);
});

test('new customer signup enters Builder Brain onboarding before returning to work', () => {
  assert.match(login, /new Set\(\['\/forge\.html', '\/room\.html', '\/story-studio\.html'\]\)/u);
  assert.match(login, /const onboardingPath = `\/forge\.html\?onboarding=1&return=/u);
  assert.match(login, /window\.location\.href = onboardingPath/u);
  assert.match(forge, /startupParams\.get\('onboarding'\) === '1'/u);
  assert.match(forge, /await showView\('brain'\)/u);
  assert.match(forge, /forge:onboarding:return/u);
});

test('Forge conversation is classified before any build starts', () => {
  assert.match(forge, /async function askNex/u);
  assert.match(forge, /fetch\('\/api\/room-assistant'/u);
  assert.match(forge, /decision\.kind === 'reply'/u);
  assert.match(forge, /decision\.kind !== 'build'/u);
  assert.match(forge, /await ensureBriefForBuild\(raw\)/u);
  assert.match(forge, /async function dockAsk[\s\S]*fetch\('\/api\/room-assistant'/u);
  assert.doesNotMatch(forge, /async function dockAsk[\s\S]*?fetch\('\/api\/room-chat'[\s\S]*?el\('dockSend'\)/u);
});

test('missing Builder Brain responses provide a real setup action in both customer shells', () => {
  for (const source of [forge, room]) {
    assert.match(source, /BRAIN_REQUIRED/u);
    assert.match(source, /Connect Builder Brain/u);
  }
  assert.match(room, /id="brain-setup-btn"/u);
  assert.doesNotMatch(room, /Building as a guest — free daily credits/u);
});

test('saved projects open directly instead of becoming a new build prompt', () => {
  assert.match(forgeViews, /onClick: \(\) => ctx\.openBuild\(field\(build, 'latestBuildId', 'id'\)\)/u);
  assert.match(forge, /openBuild: async \(id\)/u);
  assert.match(forge, /\/api\/room-history\?id=/u);
  assert.match(forge, /currentBuild = data\.build\.html/u);
  assert.match(forge, /currentProjectId = data\.build\.projectId \|\| data\.build\.id/u);
  assert.match(forge, /projectId: currentProjectId/u);
  assert.doesNotMatch(forgeViews, /ctx\.ask\(`Open/u);
});
