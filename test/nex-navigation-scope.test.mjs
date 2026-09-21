import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const chatBar = await readFile(new URL('../public/nex-chat-bar.js', import.meta.url), 'utf8');
const nexusSpace = await readFile(new URL('../public/nexus-space.js', import.meta.url), 'utf8');
const dashboard = await readFile(new URL('../public/workspace.html', import.meta.url), 'utf8');

test('shared Nex dock only sends room navigation to the in-place room switcher', () => {
  assert.match(
    chatBar,
    /data\.navigation\?\.type === 'room'[\s\S]*&& window\.NexusSpace\)/,
  );
  assert.match(chatBar, /window\.dispatchEvent\(event\)/);
  assert.doesNotMatch(chatBar, /window\.location\.assign\(data\.navigation\.url\)/);
});

test('NexusSpace still handles deliberate in-place room navigation', () => {
  assert.match(nexusSpace, /window\.addEventListener\('nexus:navigate'/);
  assert.match(nexusSpace, /window\.NexusSpace\.open\(room\)/);
});

test('dashboard routes known rooms inside one conversation workspace', () => {
  assert.match(dashboard, /workspace-views\.js/u);
  assert.match(dashboard, /matchView/u);
  assert.match(dashboard, /async function showView/u);
  assert.doesNotMatch(dashboard, /window\.location\.assign|portalHref/u);
});
