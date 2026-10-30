// Run with: node --test tests/nexus-space-anchors.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const redirectSource = readFileSync(new URL('../public/legacy-route.js', import.meta.url), 'utf8');
const pages = [
  ['command', '/workspace.html?view=deck'],
  ['conference', '/workspace.html?view=agents'],
  ['builder', '/forge.html?view=chat'],
  ['story', '/story-studio.html'],
  ['memory', '/workspace.html?view=memory'],
  ['queue', '/workspace.html?view=approvals'],
  ['connectors', '/workspace.html?view=skills'],
  ['tenants', '/workspace.html?view=forge'],
  ['', '/workspace.html?view=messages'],
  ['unknown', '/workspace.html?view=messages'],
];

function browserRedirect(pathname, hash = '') {
  let target = null;
  const location = { pathname, hash, replace(value) { target = value; } };
  vm.runInNewContext(redirectSource, { location }, { timeout: 1000 });
  return target;
}

test('Vercel allows the Nexus Space browser fallback to read anchors', () => {
  assert.equal(config.redirects.some(({ source }) => source === '/nexus-space.html'), false);
});

for (const [anchor, expected] of pages) {
  test(`Nexus Space #${anchor || '(none)'} goes to the intended destination`, () => {
    assert.equal(browserRedirect('/nexus-space.html', anchor ? `#${anchor}` : ''), expected);
  });
}

test('other retired operator pages keep their existing edge redirects', () => {
  for (const pathname of ['/mission-control.html','/conference-room.html','/memory.html','/queue.html','/connectors.html','/tenants.html','/nexus-canvas.html','/thoughtspace.html']) {
    const edge = config.redirects.find(({source}) => source === pathname);
    assert.ok(edge, pathname);
    assert.equal(browserRedirect(pathname), edge.destination);
  }
});
