import test from 'node:test';
import assert from 'node:assert/strict';
import { issueCapabilityGrant, verifyCapabilityGrant } from '../lib/capabilityGateway.js';

process.env.NEXUS_GRANT_SIGNING_SECRET = 'test-only-secret';

test('capability grants preserve scope and provenance', () => {
  const token = issueCapabilityGrant({
    tenant_id: 'tenant-a', project_id: 'project-a', task_id: 'task-a',
    agent_id: 'claude-routine', tool: 'read_file', action: 'read_file',
    resource: 'owner/repo:file.js', read_write: 'read',
  });
  const grant = verifyCapabilityGrant(token, {
    tool: 'read_file', action: 'read_file', resource: 'owner/repo:file.js', read_write: 'read',
  });
  assert.equal(grant.tenant_id, 'tenant-a');
  assert.equal(grant.agent_id, 'claude-routine');
});

test('wrong resource and unsigned grants fail', () => {
  const token = issueCapabilityGrant({
    tenant_id: 'tenant-a', project_id: 'project-a', task_id: 'task-a',
    agent_id: 'worker', tool: 'read_file', action: 'read_file',
    resource: 'owner/repo:file.js', read_write: 'read',
  });
  assert.throws(() => verifyCapabilityGrant(token, { resource: 'other/repo:file.js' }), /scope mismatch/);
  assert.throws(() => verifyCapabilityGrant(token + 'x', { tool: 'read_file' }), /Invalid/);
});

test('write capabilities require an approval reference', () => {
  const token = issueCapabilityGrant({
    tenant_id: 'tenant-a', project_id: 'project-a', task_id: 'task-a',
    agent_id: 'worker', tool: 'update_file', action: 'update_file',
    resource: 'owner/repo:file.js', read_write: 'write',
  });
  assert.throws(() => verifyCapabilityGrant(token, { tool: 'update_file', action: 'update_file', read_write: 'write' }), /approval_id/);
});
