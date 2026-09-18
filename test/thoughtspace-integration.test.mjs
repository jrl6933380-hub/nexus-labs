import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('owner dashboard mounts the spatial Thoughtspace and embeds every core room', () => {
  const index = read('../public/index.html');
  assert.match(index, /spatial:\s*true/u);
  assert.match(index, /canvas\.overview\(\)/u);
  assert.match(index, /window\.addEventListener\('nexus:navigate'/u);
  for (const route of ['mission-control', 'conference-room', 'room', 'story-studio', 'memory', 'queue', 'connectors', 'tenants']) {
    assert.match(index, new RegExp(`portalHref: room\\.href|/${route}\\.html`, 'u'));
  }
});

test('canvas engine exposes camera navigation and lazy room portals', () => {
  const engine = read('../public/canvas-engine.js');
  assert.match(engine, /function focusPanel/u);
  assert.match(engine, /function overview/u);
  assert.match(engine, /function loadPortal/u);
  assert.match(engine, /nexus-canvas-camera:/u);
  assert.match(engine, /nexus_embed/u);
});

test('embedded rooms do not create a second global Nex chat bar', () => {
  const chat = read('../public/nex-chat-bar.js');
  assert.match(chat, /window === window\.top/u);
  assert.match(chat, /nexus_embed/u);
});
