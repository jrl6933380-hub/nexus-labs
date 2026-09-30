import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalog = await import('../public/nexus-product-catalog.js');
const workspace = await readFile(new URL('../public/workspace.html', import.meta.url), 'utf8');

test('the Nexus product map preserves the five distinct pillars', () => {
  assert.deepEqual(Object.keys(catalog.NEXUS_PRODUCTS), ['chat', 'forge', 'life', 'legacy', 'teams']);
  assert.equal(catalog.NEXUS_PRODUCTS.forge.promise, 'The private production home for Forge callers.');
  assert.equal(catalog.NEXUS_PRODUCTS.life.promise, 'Build a better life.');
  assert.equal(catalog.NEXUS_PRODUCTS.legacy.promise, 'Keep what matters alive.');
  assert.equal(catalog.NEXUS_PRODUCTS.teams.promise, 'Build together.');
});

test('Nex Chat plans unlock the agreed Workbench panel limits', () => {
  assert.equal(catalog.NEX_CHAT_PLANS.free.panels, 0);
  assert.deepEqual([catalog.NEX_CHAT_PLANS.pro.price, catalog.NEX_CHAT_PLANS.pro.panels], [10, 3]);
  assert.deepEqual([catalog.NEX_CHAT_PLANS.plus.price, catalog.NEX_CHAT_PLANS.plus.panels], [20, 10]);
});

test('chat stays conversational while Workbench owns build tools', () => {
  assert.equal(catalog.NEX_CHAT_MODES.chat.buildTools, false);
  assert.equal(catalog.NEX_CHAT_MODES.workbench.buildTools, true);
  assert.match(workspace, /mode, build_tools: NEX_CHAT_MODES\[mode\]\.buildTools/u);
});

test('the owner shell leads with Nex Chat and separates products from operations', () => {
  assert.match(workspace, /<title>Nex Chat<\/title>/u);
  assert.match(workspace, /id="productNav"/u);
  assert.match(workspace, /Founder operations/u);
  assert.match(workspace, /What can we make happen\?/u);
  assert.match(workspace, /Ask Nex anything/u);
});
