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
  assert.match(dashboard, /import '\/nex-chat-bar\.js\?v=20260912-2';/);
});

test('NexusSpace still handles deliberate in-place room navigation', () => {
  assert.match(nexusSpace, /window\.addEventListener\('nexus:navigate'/);
  assert.match(nexusSpace, /window\.NexusSpace\.open\(room\)/);
});

test('dashboard Spaces open their matching scenes and only Builder opens Forge', () => {
  const expectedScenes = [
    ['Command Deck', 'command'],
    ['Conference Room', 'conference'],
    ['Story Studio', 'story'],
    ['Memory Archive', 'memory'],
    ['Approval Queue', 'queue'],
    ['Connector Bay', 'connectors'],
    ['Tenant Hub', 'tenants'],
  ];
  for (const [title, scene] of expectedScenes) {
    assert.match(
      dashboard,
      new RegExp(`title: '${title}', detail: '\\/nexus-space\\.html#${scene}'`),
    );
  }
  assert.match(dashboard, /title: 'Room Builder', detail: '\/room\.html'/);
  assert.equal((dashboard.match(/detail: '\/room\.html'/g) || []).length, 1);
});
