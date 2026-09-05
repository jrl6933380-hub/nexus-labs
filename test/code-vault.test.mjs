import test from 'node:test';
import assert from 'node:assert/strict';
import { addVaultItem, getVaultItem, searchVault, listVaultItems, createMemoryStore, __internals } from '../lib/codeVault.js';

test('adding a new item creates version 1', async () => {
  const store = createMemoryStore();
  const result = await addVaultItem({
    level: 'blueprint',
    name: 'Business Site Shell',
    purpose: 'Single-page local business site',
    store,
  });
  assert.equal(result.version, 1);
  assert.equal(result.slug, 'business-site-shell');
});

test('adding the same name again creates version 2, not a new item', async () => {
  const store = createMemoryStore();
  await addVaultItem({ level: 'blueprint', name: 'Business Site Shell', purpose: 'v1', store });
  const second = await addVaultItem({ level: 'blueprint', name: 'Business Site Shell', purpose: 'v2 with reviews section', store });
  assert.equal(second.version, 2);

  const item = await getVaultItem({ level: 'blueprint', slug: 'business-site-shell', store });
  assert.equal(item.version_count, 2);
  assert.equal(item.current.purpose, 'v2 with reviews section');
});

test('REGRESSION: old versions are preserved, never overwritten', async () => {
  const store = createMemoryStore();
  await addVaultItem({ level: 'blueprint', name: 'X', purpose: 'first purpose', store });
  await addVaultItem({ level: 'blueprint', name: 'X', purpose: 'second purpose', store });
  const item = await getVaultItem({ level: 'blueprint', slug: 'x', store });
  assert.equal(item.version_count, 2);
  assert.equal(item.current.version, 2);
  // old version's content must still be reachable in history — read raw record via a second get
  const raw = await store.get('nexus:vault:blueprint:x');
  assert.equal(raw.versions[0].purpose, 'first purpose');
  assert.equal(raw.versions[1].purpose, 'second purpose');
});

test('searchVault finds an item by purpose keyword', async () => {
  const store = createMemoryStore();
  await addVaultItem({
    level: 'blueprint',
    name: 'Business Site Shell',
    purpose: 'Single-page local business site with hero, services, contact, reviews',
    tags: ['site', 'business'],
    lifecycle_status: 'proven',
    store,
  });
  const results = await searchVault({ query: 'business site', store });
  assert.equal(results.length, 1);
  assert.equal(results[0].slug, 'business-site-shell');
});

test('searchVault excludes deprecated items by default', async () => {
  const store = createMemoryStore();
  await addVaultItem({ level: 'blueprint', name: 'Old Thing', purpose: 'legacy dashboard', lifecycle_status: 'deprecated', store });
  const results = await searchVault({ query: 'dashboard', store });
  assert.equal(results.length, 0);

  const withDeprecated = await searchVault({ query: 'dashboard', include_deprecated: true, store });
  assert.equal(withDeprecated.length, 1);
});

test('searchVault ranks proven above experimental on a tied score', async () => {
  const store = createMemoryStore();
  await addVaultItem({ level: 'blueprint', name: 'Experimental Dashboard', purpose: 'agent dashboard', lifecycle_status: 'experimental', store });
  await addVaultItem({ level: 'blueprint', name: 'Proven Dashboard', purpose: 'agent dashboard', lifecycle_status: 'proven', store });
  const results = await searchVault({ query: 'agent dashboard', store });
  assert.equal(results[0].slug, 'proven-dashboard');
});

test('searchVault respects the level filter', async () => {
  const store = createMemoryStore();
  await addVaultItem({ level: 'blueprint', name: 'Site Shell', purpose: 'business site', store });
  await addVaultItem({ level: 'block', name: 'Contact Form', purpose: 'business contact form block', store });
  const blueprintResults = await searchVault({ query: 'business', level: 'blueprint', store });
  assert.equal(blueprintResults.length, 1);
  assert.equal(blueprintResults[0].level, 'blueprint');
});

test('listVaultItems returns everything, optionally filtered by level', async () => {
  const store = createMemoryStore();
  await addVaultItem({ level: 'blueprint', name: 'A', purpose: 'x', store });
  await addVaultItem({ level: 'block', name: 'B', purpose: 'y', store });
  const all = await listVaultItems({ store });
  assert.equal(all.length, 2);
  const blocksOnly = await listVaultItems({ level: 'block', store });
  assert.equal(blocksOnly.length, 1);
});

test('an invalid level is rejected', async () => {
  const store = createMemoryStore();
  await assert.rejects(() => addVaultItem({ level: 'nonsense', name: 'X', purpose: 'y', store }), /Invalid level/);
});

test('an invalid lifecycle_status is rejected', async () => {
  const store = createMemoryStore();
  await assert.rejects(
    () => addVaultItem({ level: 'blueprint', name: 'X', purpose: 'y', lifecycle_status: 'amazing', store }),
    /Invalid lifecycle_status/
  );
});

test('missing name or purpose is rejected', async () => {
  const store = createMemoryStore();
  await assert.rejects(() => addVaultItem({ level: 'blueprint', purpose: 'y', store }), /name is required/);
  await assert.rejects(() => addVaultItem({ level: 'blueprint', name: 'X', store }), /purpose is required/);
});

test('__internals exposes the real constants used for validation', () => {
  assert.deepEqual(__internals.LEVELS, ['blueprint', 'module', 'block']);
  assert.deepEqual(__internals.LIFECYCLE_STATUSES, ['experimental', 'tested', 'proven', 'deprecated']);
});
