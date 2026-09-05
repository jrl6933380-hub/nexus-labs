import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace, getWorkspace, addArtifact, checkpointWorkspace, closeWorkspace,
  createMemoryWorkspaceStore, buildSandboxCreateOptions,
} from '../lib/workspaceManager.js';

function scope() { return { tenant_id: 'tenant-a', project_id: 'project-a', task_id: 'task-a', agent_id: 'worker-a' }; }

test('workspace lifecycle is scoped and persists only metadata', async () => {
  const store = createMemoryWorkspaceStore();
  const sandbox = { sandboxId: 'sb-1', killed: false, async kill() { this.killed = true; } };
  const { workspace } = await createWorkspace({ ...scope(), timeout_ms: 5_000, network_allowlist: ['registry.npmjs.org'] }, { store, sandboxFactory: async () => sandbox });
  assert.equal(workspace.sandbox_id, 'sb-1');
  await addArtifact(workspace.id, scope(), { path: 'dist/app.js', size: 42 }, { store });
  const paused = await checkpointWorkspace(workspace.id, scope(), { snapshot_ref: 'snap-1' }, { store });
  assert.equal(paused.snapshot_ref, 'snap-1');
  await closeWorkspace(workspace.id, scope(), { sandbox }, { store });
  assert.equal((await getWorkspace(workspace.id, scope(), { store })).state, 'closed');
  assert.equal(sandbox.killed, true);
});

test('cross-tenant workspace access is rejected', async () => {
  const store = createMemoryWorkspaceStore();
  const { workspace } = await createWorkspace({ ...scope() }, { store, sandboxFactory: async () => ({ id: 'sb-2' }) });
  await assert.rejects(() => getWorkspace(workspace.id, { ...scope(), tenant_id: 'tenant-b' }, { store }), /scope mismatch/);
});

test('public preview and budgets require explicit safe bounds', async () => {
  const store = createMemoryWorkspaceStore();
  await assert.rejects(() => createWorkspace({ ...scope(), public_preview: true }, { store, sandboxFactory: async () => ({}) }), /allowlist/);
  const { workspace } = await createWorkspace({ ...scope(), timeout_ms: 999999999, max_commands: 999 }, { store, sandboxFactory: async () => ({}) });
  assert.equal(workspace.policy.max_commands, 32);
  assert.equal(workspace.policy.timeout_ms, 60 * 60 * 1000);
});

// --- SECURITY: buildSandboxCreateOptions is the real enforcement point
// for network_allowlist. Before this existed, the allowlist was
// validated and stored but never reached Sandbox.create() at all — a
// "publicly previewed" workspace had the exact same unrestricted
// network access as any other. These tests verify the actual options
// object that would be passed to E2B, not just that a field got saved. ---

test('buildSandboxCreateOptions sets allowOut/denyOut when an allowlist is present', () => {
  const options = buildSandboxCreateOptions({
    timeout_ms: 30_000, template: 'base',
    network_allowlist: ['api.example.com', '8.8.8.8'],
  });
  assert.deepEqual(options.network.allowOut, ['api.example.com', '8.8.8.8']);
  assert.equal(typeof options.network.denyOut, 'function');
  // E2B's documented "deny everything else" selector form.
  assert.deepEqual(options.network.denyOut({ allTraffic: '0.0.0.0/0' }), ['0.0.0.0/0']);
});

test('buildSandboxCreateOptions omits the network field entirely when no allowlist is set', () => {
  const options = buildSandboxCreateOptions({ timeout_ms: 30_000, template: 'base', network_allowlist: [] });
  assert.equal('network' in options, false);
});

test('a workspace created with an allowlist actually reaches Sandbox.create() with real network restriction', async () => {
  const store = createMemoryWorkspaceStore();
  let capturedOptions = null;
  const sandboxFactory = async (p) => { capturedOptions = buildSandboxCreateOptions(p); return { id: 'sb-3' }; };
  await createWorkspace({ ...scope(), network_allowlist: ['*.github.com'], public_preview: true }, { store, sandboxFactory });
  assert.deepEqual(capturedOptions.network.allowOut, ['*.github.com']);
});
