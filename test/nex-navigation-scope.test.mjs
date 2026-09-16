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

test('every dashboard room tile links to its own page, and only Forge Builder opens the builder', () => {
  // The dashboard used to route rooms through nexus-space.html scenes
  // (`title: 'X', detail: '/nexus-space.html#scene'`). Each room is now its
  // own app-icon tile linking straight to a real page via addPanel's href,
  // so this asserts the current shape. The invariant that still matters is
  // the last one: exactly one tile opens /room.html, so navigation can never
  // open the Forge builder from two different places.
  const expectedRooms = [
    ['Command Deck', '/mission-control.html'],
    ['Conference Room', '/conference-room.html'],
    ['Forge Builder', '/room.html'],
    ['Story Studio', '/story-studio.html'],
    ['Memory Archive', '/memory.html'],
    ['Approval Queue', '/queue.html'],
    ['Connector Bay', '/connectors.html'],
    ['Tenant Hub', '/tenants.html'],
  ];
  for (const [title, href] of expectedRooms) {
    assert.match(
      dashboard,
      new RegExp(`title: '${title}', href: '${href.replace(/\//gu, '\\/')}'`),
    );
  }
  assert.equal((dashboard.match(/href: '\/room\.html'/g) || []).length, 1);
});
