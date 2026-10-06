import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const catalog = await import('../public/nexus-product-catalog.js');
const workspace = await readFile(new URL('../public/workspace.html', import.meta.url), 'utf8');
const messages = await readFile(new URL('../public/nexus-messages.js', import.meta.url), 'utf8');

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

test('the owner shell leads with Nexus Messages and keeps every destination in its inbox', () => {
  assert.match(workspace, /<title>Nexus Messages<\/title>/u);
  assert.doesNotMatch(workspace, /class="rail"|id="burger"|id="productNav"/u);
  assert.match(messages, /Founder operations/u);
  assert.match(messages, /Connected Nexus/u);
  assert.match(workspace, /renderWelcome\(ctx\)/u);
  assert.match(workspace, /Message Nex/u);
});

test('the mobile welcome keeps goal choices in a compact two-column grid', () => {
  assert.match(workspace, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/u);
  assert.doesNotMatch(workspace, /startergrid\{grid-template-columns:1fr/u);
  assert.doesNotMatch(workspace, /When you are ready to build/u);
});

test('Workbench and Capabilities open from connected conversation rows', () => {
  assert.match(messages, /id:'workbench',name:'Projects'/u);
  assert.match(messages, /id:'skills',name:'Capabilities'/u);
  assert.match(messages, /ctx\.openSystem\(system\.id\)/u);
});

test('Nex Chat composer exposes customer actions instead of founder visual controls', () => {
  assert.match(workspace, /id="plannerQuickBtn">Schedule</u);
  assert.match(workspace, /id="projectsQuickBtn">Projects</u);
  assert.match(workspace, /id="connectedQuickBtn">Messages</u);
  assert.match(workspace, /plannerQuickBtn'\)\.onclick = \(\) => showView\('planner'\)/u);
  assert.match(workspace, /projectsQuickBtn'\)\.onclick = \(\) => showView\('workbench'\)/u);
  assert.doesNotMatch(workspace, /id="capBtn"|id="snapBtn"|id="pinBtn"/u);
});

test('the workspace uses one anchored chat sheet and the old floating control is gone', () => {
  assert.match(workspace, /id="headBtn" aria-label="Refresh" title="Refresh">↻<\/button>/u);
  assert.match(workspace, /body\.chat-sheet-open \.screen\{height:var\(--sheet-base-height,100%\);bottom:auto\}/u);
  assert.match(workspace, /\.dock\{position:fixed[\s\S]*border-radius:24px 24px 0 0/u);
  assert.match(workspace, /function openChatSheet\([\s\S]*focus\(\{preventScroll:true\}\)/u);
  assert.match(workspace, /history\.filter\(\(message\)=>\['user','assistant'\]\.includes[\s\S]*\.slice\(-12\)/u);
  assert.match(workspace, /Nex is working[\s\S]*workingdots/u);
  assert.match(workspace, /history\.push\(\{role:'user',content:text\}\);saveThread\(\);[\s\S]*await durableChatRequest\(text,threadId\)/u);
  assert.doesNotMatch(workspace, /class="head"|nexus:head|addEventListener\('pointermove'/u);
});

test('the public home card introduces Schedule while owner operations stay in Messages', () => {
  assert.match(workspace, /renderWelcome\(ctx\)/u);
  assert.match(messages, /id:'planner',name:'Schedule'/u);
  assert.match(messages, /id:'deck',name:'Command Deck'/u);
});
