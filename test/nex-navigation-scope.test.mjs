import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chatBar = await readFile(new URL('../public/nex-chat-bar.js', import.meta.url), 'utf8');
const nexusSpace = await readFile(new URL('../public/nexus-space.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');

test('shared Nex dock only sends room navigation to the in-place room switcher', () => {
  assert.match(
    chatBar,
    /data\.navigation\?\.type === 'room'[\s\S]*&& window\.NexusSpace\)/,
  );
  assert.match(chatBar, /window\.dispatchEvent\(event\)/);
  assert.doesNotMatch(chatBar, /window\.location\.assign\(data\.navigation\.url\)/);
  assert.match(dashboard, /await import\('\/nex-chat-bar\.js\?v=20260919-1'\);/);
});

test('NexusSpace still handles deliberate in-place room navigation', () => {
  assert.match(nexusSpace, /window\.addEventListener\('nexus:navigate'/);
  assert.match(nexusSpace, /window\.NexusSpace\.open\(room\)/);
});

test('dashboard delegates navigation to one visual workspace', () => {
  assert.match(dashboard, /nexus-workspace\.js/u);
  assert.match(dashboard, /id="nexus-visual-stage"/u);
  assert.doesNotMatch(dashboard, /canvas\.addPanel|portalHref/u);
});
