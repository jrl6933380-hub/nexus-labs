// Owner navigation contract: safe, read-only guard for workspace consolidation.
// Run: node --test tests/owner-route-contract.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const views = read('../public/workspace-views.js');
const workspace = read('../public/workspace.html');
const navigation = read('../public/nexus-navigation.js');
const legacy = read('../public/legacy-route.js');
const vercel = JSON.parse(read('../vercel.json'));

const ownerViews = ['messages','deck','approvals','forge','agents','phone','lab','story','memory','workbench'];
const legacyRoutes = {
  '/mission-control.html':'deck',
  '/conference-room.html':'agents',
  '/memory.html':'memory',
  '/queue.html':'approvals',
  '/connectors.html':'skills',
  '/tenants.html':'forge'
};
test('each owner system retains a unique view in the central workspace', () => {
  for (const id of ownerViews) {
    const pattern = new RegExp('^\\s{2}' + id + ':\\s*\\{', 'm');
    assert.match(views, pattern, 'missing central view: ' + id);
  }
});
test('owner authentication gate remains in front of workspace rendering', () => {
  assert.match(workspace, /fetch\('\/api\/nexus-auth'/);
  assert.match(workspace, /if \(!session\?\.ok\)/);
});
test('Forge and Workbench keep their direct builder entry points', () => {
  assert.match(views, /location\.assign\('\/forge\.html'\)/);
  assert.match(workspace, /\/forge\.html\?surface=workbench/);
});
test('legacy route targets remain backed by real central views', () => {
  for (const [source, view] of Object.entries(legacyRoutes)) {
    assert.ok(vercel.redirects.some(route => route.source === source && route.destination === '/workspace.html?view=' + view), 'missing edge redirect: ' + source);
    assert.ok(legacy.includes("'" + source + "'"), 'missing browser fallback: ' + source);
  }
});
test('composer still exposes the Operations hub', () => {
  assert.match(navigation, /id:'deck',label:'Operations'/);
});
