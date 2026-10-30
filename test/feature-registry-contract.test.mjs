import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const root = new URL('../', import.meta.url);
const registry = JSON.parse(fs.readFileSync(new URL('docs/nexus-feature-registry.json', root), 'utf8'));
const config = JSON.parse(fs.readFileSync(new URL('vercel.json', root), 'utf8'));
const redirects = new Map((config.redirects || []).map(r => [r.source, r.destination]));

test('Canonical feature registry has stable unique IDs and known classifications', () => {
  assert.equal(registry.schema_version, 1);
  assert.ok(registry.entries.length > 0);
  const ids = new Set();
  const activeRoutes = new Set();
  for (const entry of registry.entries) {
    assert.match(entry.id, /^[a-z][a-z0-9-]*$/);
    assert.ok(!ids.has(entry.id), 'Duplicate feature ID: ' + entry.id);
    ids.add(entry.id);
    assert.ok(['production', 'experimental', 'planned', 'retired'].includes(entry.status), entry.id);
    assert.ok(['owner', 'all'].includes(entry.audience), entry.id);
    assert.ok(Array.isArray(entry.dependencies), entry.id);
    assert.ok(entry.owner_home && typeof entry.owner_home === 'string', entry.id);
    if (entry.status === 'planned') {
      assert.ok(entry.route === null || (typeof entry.route === 'string' && entry.route.startsWith('/')), entry.id);
    } else {
      assert.ok(typeof entry.route === 'string' && entry.route.startsWith('/'), entry.id);
    }
    if (entry.route && entry.status === 'production') {
      assert.ok(!activeRoutes.has(entry.route), 'Duplicate production entry point: ' + entry.route);
      activeRoutes.add(entry.route);
    }
  }
});

test('Canonical workspace views do not use redirected legacy URLs', () => {
  for (const entry of registry.entries) {
    if (!entry.route || entry.status === 'retired') continue;
    const pathname = entry.route.split('?')[0];
    assert.ok(!redirects.has(pathname), entry.id + ' points at legacy redirect ' + pathname);
  }
});

test('Planned Local AI stays distinct from installed phone bridge', () => {
  const byId = new Map(registry.entries.map(entry => [entry.id, entry]));
  assert.equal(byId.get('local-ai')?.status, 'planned');
  assert.equal(byId.get('local-ai')?.route, null);
  assert.equal(byId.get('phone')?.status, 'production');
});
