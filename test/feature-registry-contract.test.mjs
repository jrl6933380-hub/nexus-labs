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
    assert.ok(['owner', 'all', 'customer'].includes(entry.audience), entry.id);
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
    const pathname = new URL(entry.route, 'https://nexus.invalid').pathname;
    assert.ok(!redirects.has(pathname), entry.id + ' points at legacy redirect ' + pathname);
  }
});

test('Planned Local AI stays distinct from installed phone bridge', () => {
  const byId = new Map(registry.entries.map(entry => [entry.id, entry]));
  assert.equal(byId.get('local-ai')?.status, 'planned');
  assert.equal(byId.get('local-ai')?.route, null);
  assert.equal(byId.get('phone')?.status, 'production');
});

test('Registered destinations and workspace views exist in current source', () => {
  const views = fs.readFileSync(new URL('public/workspace-views.js', root), 'utf8');
  const hub = fs.readFileSync(new URL('public/forge-hub.html', root), 'utf8');
  for (const entry of registry.entries) {
    if (!entry.route || entry.status === 'retired') continue;
    const route = new URL(entry.route, 'https://nexus.invalid');
    assert.ok(fs.existsSync(new URL('public' + route.pathname, root)), entry.id + ' missing destination');
    if (route.pathname === '/workspace.html') {
      const view = route.searchParams.get('view');
      assert.match(views, new RegExp('^  ' + view + ':\\s*\\{', 'm'), entry.id + ' unknown workspace view');
      assert.equal(entry.audience, 'owner', entry.id + ' owner URL must not be advertised as shared');
    }
    if (route.pathname === '/forge-hub.html' && route.hash) {
      assert.ok(hub.includes('id="' + route.hash.slice(1) + '-tab"'), entry.id + ' unknown Forge tab');
      assert.equal(entry.audience, 'owner', entry.id);
    }
    if (entry.setup_route) assert.ok(fs.existsSync(new URL('public' + entry.setup_route, root)), entry.id + ' missing setup page');
    for (const dependency of entry.dependencies) {
      assert.ok(dependency.startsWith('/api/'), entry.id + ' unsupported dependency');
      const rewrite = (config.rewrites || []).find(rule => rule.source === dependency);
      const implementation = rewrite ? new URL(rewrite.destination, 'https://nexus.invalid').pathname : dependency;
      assert.ok(fs.existsSync(new URL(implementation.slice(1) + '.js', root)), entry.id + ' missing API dependency or rewrite: ' + dependency);
    }
  }
});

test('Customer and owner entrypoints retain their separate auth boundaries', () => {
  const owner = fs.readFileSync(new URL('public/workspace.html', root), 'utf8');
  const customer = fs.readFileSync(new URL('public/customer-nexus.js', root), 'utf8');
  assert.ok(owner.includes("fetch('/api/nexus-auth'"));
  assert.ok(customer.includes("api('/api/room-auth')"));
  assert.ok(customer.includes('customer:true'));
  const home = registry.entries.find(entry => entry.id === 'customer-home');
  assert.equal(home?.route, '/nexus.html');
  assert.equal(home?.audience, 'customer');
  for (const id of ['deck', 'forge', 'phone', 'ad-maker', 'image-board', 'forge-ops', 'forge-templates', 'nexus-lab', 'story-studio']) {
    assert.equal(registry.entries.find(entry => entry.id === id)?.audience, 'owner', id);
  }
});
