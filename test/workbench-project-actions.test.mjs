import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const viewsSource = await readFile(new URL('../public/forge-views.js', import.meta.url), 'utf8');
const forgeSource = await readFile(new URL('../public/forge.html', import.meta.url), 'utf8');
const element = (tag) => ({
  tag, children: [], attrs: {}, disabled: false,
  setAttribute(key, value) { this.attrs[key] = value; },
  appendChild(child) { this.children.push(child); },
  append(...children) { this.children.push(...children); },
});
function viewsHarness() {
  const context = {
    document: { createElement: element },
    field: (obj, ...keys) => keys.map(key => obj?.[key]).find(Boolean) || '',
    pick: (obj, ...keys) => keys.map(key => obj?.[key]).find(Array.isArray) || [],
    esc: text => String(text).replaceAll('<', '&lt;'),
    say: text => ({ text }), chips: actions => ({ actions }),
    getJSON: async url => url === '/api/room-history'
      ? { projects: [{ latestBuildId: 'build-a', mainLabel: 'Bakery', stackItems: [] }, { latestBuildId: 'build-b', mainLabel: 'Garage', stackItems: [] }] }
      : { build: { html: '<h1>Preview</h1>' } },
  };
  vm.createContext(context);
  vm.runInContext(viewsSource.replace(/^export \{.*\n|^import .*\n/gm, '').replace(/^export /gm, '') + '\nthis.views = FORGE_VIEWS;', context);
  return context;
}

test('each project card adds to its own build and carries its main title', async () => {
  const harness = viewsHarness();
  const calls = [];
  const nodes = await harness.views.project.render({ surface: () => 'workbench', hasCurrentBuild: () => true, openBuild: async (...args) => calls.push(args) });
  const grid = nodes.find(node => node.className === 'workbench-project-grid');
  for (const stack of grid.children.slice(0, 2)) {
    const add = stack.children.find(node => node.className === 'workbench-project-actions').children[1];
    await add.onclick();
    assert.equal(add.disabled, false);
  }
  assert.deepEqual(calls, [['build-a', 'pages', 'Bakery'], ['build-b', 'pages', 'Garage']]);
});

test('add screen shows the target title and does not start a build until a piece is chosen', async () => {
  const harness = viewsHarness();
  const asks = [];
  const nodes = await harness.views.pages.render({ surface: () => 'workbench', hasCurrentBuild: () => true, currentProjectLabel: () => 'Garage', ask: (...args) => asks.push(args) });
  const selected = nodes.find(node => node.className === 'workbench-selected-project');
  assert.equal(selected.children[1].textContent, 'Garage');
  assert.equal(asks.length, 0);
  nodes.find(node => node.actions?.some(action => action.label === 'Add a page')).actions[0].run();
  assert.equal(asks[0][1].stackItem.kind, 'page');
});

test('without a current build the add screen asks the customer to choose a project', async () => {
  const harness = viewsHarness();
  const nodes = await harness.views.pages.render({ surface: () => 'workbench', hasCurrentBuild: () => false });
  assert.match(nodes[0].text, /Choose the project/);
  assert.equal(nodes[1].className, 'workbench-project-grid');
});

function openHarness(ok) {
  const body = forgeSource.split("openBuild: async (id, destination = 'chat', projectLabel = '') => {")[1].split('\n  },\n  buyUsagePack:')[0];
  const context = {
    currentBuild: '<h1>Old</h1>', currentProjectId: 'old-project', latestBuildId: 'old-build', currentProjectLabel: 'Old', pendingStackItem: { kind: 'tool' },
    currentLiveUrl: '', currentLiveNeedsUpdate: false, history: [], threadId: null, shown: [],
    bubble: () => ({ closest: () => ({ remove() {} }) }), paragraphs: text => text,
    fetch: async url => ({ ok, json: async () => url.startsWith('/api/room-history') ? { build: { id: 'build-b', projectId: 'project-b', html: '<h1>Garage</h1>', label: 'Add booking form' } } : { turns: [] } }),
  };
  context.showView = async id => context.shown.push(id);
  vm.createContext(context);
  vm.runInContext("this.openBuild = async (id, destination = 'chat', projectLabel = '') => {" + body + '\n};', context);
  return context;
}

test('opening an addition switches project state before showing its controls', async () => {
  const context = openHarness(true);
  await context.openBuild('build-b', 'pages', 'Garage');
  assert.equal(context.currentProjectId, 'project-b');
  assert.equal(context.currentProjectLabel, 'Garage');
  assert.equal(context.pendingStackItem, null);
  assert.deepEqual(context.shown, ['pages']);
});

test('a failed project load never shows add controls for the previously open project', async () => {
  const context = openHarness(false);
  await context.openBuild('missing', 'pages', 'Garage');
  assert.equal(context.currentProjectId, 'old-project');
  assert.deepEqual(context.shown, []);
});
