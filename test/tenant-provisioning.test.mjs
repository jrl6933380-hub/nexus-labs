import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTenant,
  getTenantBySlug,
  listTenantsForOwner,
  assertTenantAccess,
  registerConnection,
  createMemoryStore,
} from '../lib/tenantProvisioning.js';

test('creates a hosted tenant with a default quota', async () => {
  const store = createMemoryStore();
  const record = await createTenant({ ownerUsername: 'justin', name: 'Acme Site', mode: 'hosted', store });
  assert.equal(record.mode, 'hosted');
  assert.ok(record.quota);
  assert.equal(record.quota.creditsPerPeriod, 250);
  assert.ok(record.tenant_id);
});

test('creates a BYO tenant with no quota', async () => {
  const store = createMemoryStore();
  const record = await createTenant({ ownerUsername: 'justin', name: 'Client X', mode: 'byo', store });
  assert.equal(record.mode, 'byo');
  assert.equal(record.quota, null);
});

test('rejects an invalid mode', async () => {
  const store = createMemoryStore();
  await assert.rejects(() => createTenant({ ownerUsername: 'justin', name: 'X', mode: 'nope', store }));
});

test('concurrent create for the same owner+name never overwrites the winner', async () => {
  const store = createMemoryStore();
  const attempts = await Promise.allSettled([
    createTenant({ ownerUsername: 'justin', name: 'Race', mode: 'hosted', store }),
    createTenant({ ownerUsername: 'justin', name: 'Race', mode: 'byo', store }),
  ]);
  const fulfilled = attempts.filter((a) => a.status === 'fulfilled');
  const rejected = attempts.filter((a) => a.status === 'rejected');
  assert.equal(fulfilled.length, 1);
  assert.equal(rejected.length, 1);
});

test('same tenant name is fine for two different owners', async () => {
  const store = createMemoryStore();
  const a = await createTenant({ ownerUsername: 'justin', name: 'Shop', mode: 'hosted', store });
  const b = await createTenant({ ownerUsername: 'alex', name: 'Shop', mode: 'hosted', store });
  assert.notEqual(a.tenant_id, b.tenant_id);
});

test('listTenantsForOwner only returns that owner\'s tenants', async () => {
  const store = createMemoryStore();
  await createTenant({ ownerUsername: 'justin', name: 'One', mode: 'hosted', store });
  await createTenant({ ownerUsername: 'justin', name: 'Two', mode: 'byo', store });
  await createTenant({ ownerUsername: 'alex', name: 'Other', mode: 'hosted', store });

  const justinTenants = await listTenantsForOwner({ ownerUsername: 'justin', store });
  const alexTenants = await listTenantsForOwner({ ownerUsername: 'alex', store });
  assert.equal(justinTenants.length, 2);
  assert.equal(alexTenants.length, 1);
});

test('assertTenantAccess rejects a different owner touching the tenant', async () => {
  const store = createMemoryStore();
  const record = await createTenant({ ownerUsername: 'justin', name: 'Private', mode: 'hosted', store });
  await assert.doesNotReject(() => assertTenantAccess({ tenantId: record.tenant_id, ownerUsername: 'justin', store }));
  await assert.rejects(() => assertTenantAccess({ tenantId: record.tenant_id, ownerUsername: 'alex', store }));
});

test('assertTenantAccess rejects an unknown tenant id', async () => {
  const store = createMemoryStore();
  await createTenant({ ownerUsername: 'justin', name: 'Real', mode: 'hosted', store });
  await assert.rejects(() => assertTenantAccess({ tenantId: 'not-a-real-id', ownerUsername: 'justin', store }));
});

test('registerConnection records provider metadata without secrets', async () => {
  const store = createMemoryStore();
  const record = await createTenant({ ownerUsername: 'justin', name: 'ByoClient', mode: 'byo', store });
  const updated = await registerConnection({
    tenantId: record.tenant_id,
    ownerUsername: 'justin',
    provider: 'github',
    metadata: { accountLogin: 'some-client-org' },
    store,
  });
  assert.equal(updated.connections.github.accountLogin, 'some-client-org');
  assert.ok(updated.connections.github.connected_at);
});

test('registerConnection refuses metadata that looks like a credential', async () => {
  const store = createMemoryStore();
  const record = await createTenant({ ownerUsername: 'justin', name: 'ByoClient2', mode: 'byo', store });
  await assert.rejects(() =>
    registerConnection({
      tenantId: record.tenant_id,
      ownerUsername: 'justin',
      provider: 'github',
      metadata: { accessToken: 'ghp_shouldnotbehere' },
      store,
    })
  );
});

test('registerConnection rejects a caller who is not the tenant owner', async () => {
  const store = createMemoryStore();
  const record = await createTenant({ ownerUsername: 'justin', name: 'ByoClient3', mode: 'byo', store });
  await assert.rejects(() =>
    registerConnection({ tenantId: record.tenant_id, ownerUsername: 'alex', provider: 'github', metadata: {}, store })
  );
});

test('getTenantBySlug returns null for a tenant that does not exist', async () => {
  const store = createMemoryStore();
  const result = await getTenantBySlug({ ownerUsername: 'justin', name: 'Nope', store });
  assert.equal(result, null);
});
