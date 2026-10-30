import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const script = fs.readFileSync(new URL('../public/legacy-route.js', import.meta.url), 'utf8');
const redirects = new Map((config.redirects || []).map(({ source, destination }) => [source, destination]));

function browserFallback(pathname, hash = '') {
  let target = null;
  vm.runInNewContext(script, {
    location: { pathname, hash, replace: value => { target = value; } }
  }, { timeout: 1000 });
  return target;
}

test('Legacy HTML fallback agrees with edge redirects for paths without fragments', () => {
  const paths = [
    '/mission-control.html', '/conference-room.html', '/memory.html',
    '/queue.html', '/connectors.html', '/tenants.html',
    '/nexus-canvas.html', '/thoughtspace.html'
  ];
  for (const pathname of paths) {
    assert.equal(browserFallback(pathname), redirects.get(pathname), pathname);
  }
});

test('Nexus Space loads browser fallback instead of an edge redirect', () => {
  assert.ok(!redirects.has('/nexus-space.html'));
  assert.equal(browserFallback('/nexus-space.html'), '/workspace.html?view=messages');
});

test('Nexus Space retains its historical fragment-based browser fallback', () => {
  const views = {
    command: 'deck', conference: 'agents', builder: 'forge',
    story: 'story', memory: 'memory', queue: 'approvals',
    connectors: 'skills', tenants: 'forge'
  };
  for (const [hash, view] of Object.entries(views)) {
    assert.equal(browserFallback('/nexus-space.html', '#' + hash),
      '/workspace.html?view=' + view, hash);
  }
});
