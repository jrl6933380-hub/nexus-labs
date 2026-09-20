import test from 'node:test';
import assert from 'node:assert/strict';

import { createMemoryStore, ensureStackManifest } from '../lib/forgeStack.js';
import { provisionManagedDatabase } from '../lib/forge/managedDatabase.js';
import { forgeCredentialScope, storeManagedDatabaseUrl } from '../lib/forge/forgeSecrets.js';
import { runStackSetup } from '../lib/forge/stackActions.js';

test('managed database stores its URL behind the secret boundary and publishes only safe metadata', async () => {
  const store = createMemoryStore();
  await ensureStackManifest({ ownerUsername: 'alice', projectId: 'app', projectType: 'app', store });
  const secrets = [];
  const result = await provisionManagedDatabase({
    ownerUsername: 'alice', projectId: 'app', store,
    provision: async () => ({
      provisioned: true,
      project_id: 'neon-safe-id',
      connection_string: 'postgres://secret',
      database_name: 'neondb',
      region_id: 'aws-us-east-1',
    }),
    verify: async () => ({ ok: true }),
    saveSecret: async (value) => { secrets.push(value); },
  });
  assert.equal(result.ok, true);
  assert.equal(result.manifest.slots.database.status, 'ready');
  assert.equal(result.manifest.slots.database.metadata.provider_resource_id, 'neon-safe-id');
  assert.equal(JSON.stringify(result.manifest).includes('postgres://secret'), false);
  assert.equal(secrets[0].connectionString, 'postgres://secret');
});

test('managed database is idempotent after it reaches ready', async () => {
  const store = createMemoryStore();
  await ensureStackManifest({ ownerUsername: 'alice', projectId: 'app', projectType: 'app', store });
  let creates = 0;
  const options = {
    ownerUsername: 'alice', projectId: 'app', store,
    provision: async () => {
      creates += 1;
      return { provisioned: true, project_id: 'db-1', connection_string: 'postgres://secret' };
    },
    verify: async () => ({ ok: true }),
    saveSecret: async () => ({ stored: true }),
  };
  await provisionManagedDatabase(options);
  const second = await provisionManagedDatabase(options);
  assert.equal(creates, 1);
  assert.equal(second.changed, false);
});

test('secret wrapper derives a stable opaque scope and forwards no identifiers', async () => {
  const calls = [];
  await storeManagedDatabaseUrl({
    ownerUsername: 'Alice', projectId: 'My-App', connectionString: 'postgres://secret',
    storeCredential: async (input) => calls.push(input),
  });
  assert.equal(calls[0].tenantId, forgeCredentialScope({ ownerUsername: 'alice', projectId: 'my-app' }));
  assert.equal(calls[0].tenantId.includes('alice'), false);
  assert.equal(calls[0].provider, 'neon-database');
});

test('one setup command completes managed layers and returns clear handoff tasks', async () => {
  const store = createMemoryStore();
  await ensureStackManifest({ ownerUsername: 'alice', projectId: 'shop', projectType: 'app', store });
  const result = await runStackSetup({
    ownerUsername: 'alice', projectId: 'shop', store,
    runAction: async ({ slotId }) => ({
      ok: true,
      changed: true,
      message: `${slotId} ready`,
      manifest: await ensureStackManifest({ ownerUsername: 'alice', projectId: 'shop', store }),
    }),
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.completed.map((item) => item.slot), ['auth', 'database']);
  assert.ok(result.waiting.some((item) => item.slot === 'brain'));
  assert.ok(result.waiting.some((item) => item.slot === 'deployment'));
});
