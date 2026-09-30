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
  assert.match(workspace, /What's on your mind, Justin\?/u);
  assert.match(workspace, /Ask Nex anything/u);
});

test('the mobile welcome keeps all four starters in a compact two-column grid', () => {
  assert.match(workspace, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
  assert.doesNotMatch(workspace, /startergrid\{grid-template-columns:1fr/u);
  assert.doesNotMatch(workspace, /When you are ready to build/u);
});

test('fixed Workbench and Capabilities controls use the workspace router', () => {
  assert.match(workspace, /data-view="workbench"/u);
  assert.match(workspace, /data-view="skills"/u);
  assert.match(workspace, /document\.querySelectorAll\('\[data-view\]'\)/u);
  assert.match(workspace, /showView\(button\.dataset\.view\)/u);
});

test('the public home card introduces Planner while the system briefing stays private', () => {
  assert.match(workspace, /Plan my time/u);
  assert.match(workspace, /Days, events, and schedules/u);
  assert.match(workspace, /id="ownerBriefBtn"/u);
  assert.match(workspace, /Founder operations/u);
});
