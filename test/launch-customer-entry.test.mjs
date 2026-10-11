import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const [root, login, forge, forgeViews, room] = await Promise.all([
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/index.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge.html', import.meta.url), 'utf8'),
  readFile(new URL('../public/forge-views.js', import.meta.url), 'utf8'),
  readFile(new URL('../public/room.html', import.meta.url), 'utf8'),
]);

test('root provides one stable entry for customers and the owner', () => {
  assert.match(root, /sessionCheck\('\/api\/nexus-auth'\)/u);
  assert.match(root, /sessionCheck\('\/api\/room-auth'\)/u);
  assert.match(root, /id="owner-form"/u);
  assert.match(root, /button.onclick=\(\)=>location.assign/u);
  assert.doesNotMatch(root, /pin_login|set_pin|pin-setup/u);
});

test('Builder Brain explains a 401 and offers Forge sign-in instead of an outage message', () => {
  assert.match(forgeViews, /needsSignIn = \/returned 401\\b\/\.test/u);
  assert.match(forgeViews, /Sign in to your Forge account/u);
  assert.match(forgeViews, /run: \(\) => ctx\.signIn\(\)/u);
  assert.match(forge, /connectBrain: async \(tier\) => \{\s*if \(!signedIn\) \{ goSignIn\(\); return; \}/u);
});

test('customer sign-in returns directly to work without mandatory provider setup', () => {
  assert.match(login, /location.assign\(nextPath\)/u);
  assert.match(login, /social=complete/u);
  assert.match(login, /simple-signup/u);
});

test('Free plan returns to current Forge chat from direct and legacy sign-ins', () => {
  const start = login.indexOf('  const requested = new URLSearchParams');
  const end = login.indexOf('  // Forge Field', start);
  assert.ok(start > 0 && end > start);
  const destination = (query) => runInNewContext(login.slice(start, end) + '\nnextPath', {
    URL, URLSearchParams,
    window: { location: { origin: 'https://nexus.test', search: query } },
    location: { search: query },
    sessionStorage: { getItem: () => null },
  });
  assert.equal(destination(''), '/forge.html?view=chat');
  assert.equal(destination('?next=%2Froom.html'), '/forge.html?view=chat');
  assert.equal(destination('?next=%2Froom.html%3Fbuilder%3D1'), '/forge.html?view=chat');
  assert.equal(destination('?next=%2Fstory-studio.html'), '/story-studio.html');
  assert.equal(destination('?next=https%3A%2F%2Fother.test'), '/forge.html?view=chat');
  assert.match(login, /continueFree.addEventListener\('click',[\s\S]*window.location.href = nextPath/u);
});

test('Forge conversation is classified before any build starts', () => {
  assert.match(forge, /async function askNex/u);
  assert.match(forge, /fetch\('\/api\/room-assistant'/u);
  assert.match(forge, /decision\.kind === 'reply'/u);
  assert.match(forge, /decision\.kind !== 'build'/u);
  assert.match(forge, /await runBuild\(decision\.instruction, raw, false\)/u);
  assert.match(forge, /showView\(featureUnlocked\(connectionSnapshot\(\), 'brief'\) \? 'brief' : 'chat'\)/u);
  assert.doesNotMatch(forge, /ensureBriefForBuild/u);
  assert.match(forgeViews, /unavailable\?\.code === 'TIER_REQUIRED'/u);
  assert.match(forgeViews, /Build with Free/u);
  assert.match(forge, /async function dockAsk[\s\S]*fetch\('\/api\/room-assistant'/u);
  assert.doesNotMatch(forge, /async function dockAsk[\s\S]*?fetch\('\/api\/room-chat'[\s\S]*?el\('dockSend'\)/u);
});

test('missing Builder Brain responses provide a real setup action in the customer shell', () => {
  // public/room.html was retired (it now forwards to /forge.html), so only the
  // Forge shell is checked.
  assert.match(forge, /BRAIN_REQUIRED/u);
  assert.match(forge, /Connect Builder Brain/u);
  assert.doesNotMatch(room, /Building as a guest/u);
});

test('saved projects open directly instead of becoming a new build prompt', () => {
  assert.match(forgeViews, /open\.onclick = \(\) => ctx\.openBuild\(buildId\)/u);
  assert.match(forge, /openBuild: async \(id, destination = 'overview'/u);
  assert.match(forge, /\/api\/room-history\?id=/u);
  assert.match(forge, /currentBuild = data\.build\.html/u);
  assert.match(forge, /currentProjectId = data\.build\.projectId \|\| data\.build\.id/u);
  assert.match(forge, /projectId: currentProjectId/u);
  assert.doesNotMatch(forgeViews, /ctx\.ask\(`Open/u);
});
