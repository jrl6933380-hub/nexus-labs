import test from 'node:test';
import assert from 'node:assert/strict';

import { authorizeScopedSandbox, buildSecurityReceipt } from '../lib/nexSecurity.js';

test('ordinary ephemeral sandbox use needs no tenant claim', async () => {
  assert.deepEqual(await authorizeScopedSandbox({ commands: ['npm test'] }, null), { scoped: false, tenantVerified: false });
});

test('partial or anonymous tenant scope fails closed', async () => {
  await assert.rejects(authorizeScopedSandbox({ tenant_id: 't1' }, 'mrlopez'), /requires tenant_id/);
  await assert.rejects(authorizeScopedSandbox({ tenant_id: 't1', project_id: 'p1', task_id: 'x1', agent_id: 'nex' }, null), /Sign in/);
});

test('tenant scope is verified against the authenticated owner', async () => {
  const calls = [];
  const result = await authorizeScopedSandbox(
    { tenant_id: 't1', project_id: 'p1', task_id: 'x1', agent_id: 'nex' },
    'mrlopez',
    { assertTenantAccess: async (scope) => calls.push(scope) },
  );
  assert.equal(result.tenantVerified, true);
  assert.deepEqual(calls[0], { tenantId: 't1', ownerUsername: 'mrlopez' });
});

test('public security receipts reveal no identity or credential material', () => {
  const receipt = buildSecurityReceipt({ operatorUser: 'mrlopez', runState: { scopeHash: 'private-hash' }, tenantVerified: true });
  assert.equal(receipt.authenticated, true);
  assert.equal(receipt.resumeScopeBound, true);
  assert.equal(receipt.rawCredentialsExposed, false);
  assert.doesNotMatch(JSON.stringify(receipt), /mrlopez|private-hash/);
});
