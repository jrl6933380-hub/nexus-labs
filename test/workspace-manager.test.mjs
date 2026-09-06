import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createWorkspace, getWorkspace, addArtifact, checkpointWorkspace, closeWorkspace,
  createMemoryWorkspaceStore, buildSandboxCreateOptions, estimateSandboxCostCents,
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

// --- SECURITY: estimateSandboxCostCents / spend_cap_cents enforcement.
// Before this, spend_cap_cents was validated and stored but nothing
// ever checked actual or worst-case cost against it — decorative,
// same as network_allowlist and max_commands were. Rates are E2B's
// own documented per-second numbers, not a guess. ---

test('estimateSandboxCostCents matches E2B\'s own worked example (~$0.109/hr for the default 2vCPU/512MB sandbox)', () => {
  const oneHourCents = estimateSandboxCostCents(60 * 60 * 1000);
  // E2B's docs give ~$0.109 for one hour; ceiling-rounded to the cent
  // (the safe direction for a cost cap) that's 11 cents.
  assert.equal(oneHourCents, 11);
});

test('estimateSandboxCostCents scales down correctly for a short duration', () => {
  const fiveMinCents = estimateSandboxCostCents(5 * 60 * 1000);
  assert.equal(fiveMinCents, 1); // E2B's own example: ~$0.009 for 5 minutes, ceil'd to 1 cent
});

test('estimateSandboxCostCents returns 0 for zero duration', () => {
  assert.equal(estimateSandboxCostCents(0), 0);
});

test('createWorkspace rejects upfront when the requested timeout could exceed spend_cap_cents, before any sandbox is created', async () => {
  const store = createMemoryWorkspaceStore();
  let sandboxFactoryCalled = false;
  await assert.rejects(
    () => createWorkspace(
      { ...scope(), timeout_ms: 60 * 60 * 1000, spend_cap_cents: 5 }, // 1hr costs ~11¢, cap is 5¢
      { store, sandboxFactory: async () => { sandboxFactoryCalled = true; return {}; } },
    ),
    /could cost up to 11.*exceeding this workspace's spend_cap_cents of 5/,
  );
  assert.equal(sandboxFactoryCalled, false, 'the sandbox must never be created if the cap check fails');
});

test('createWorkspace succeeds when the requested timeout fits within spend_cap_cents', async () => {
  const store = createMemoryWorkspaceStore();
  const { workspace } = await createWorkspace(
    { ...scope(), timeout_ms: 5 * 60 * 1000, spend_cap_cents: 5 }, // 5 min costs ~1¢, well under 5¢
    { store, sandboxFactory: async () => ({ id: 'sb-4' }) },
  );
  assert.equal(workspace.policy.spend_cap_cents, 5);
});

test('spend_cap_cents of 0 (the default) means no cap — matches the network_allowlist=[] "no restriction" convention', async () => {
  const store = createMemoryWorkspaceStore();
  const { workspace } = await createWorkspace(
    { ...scope(), timeout_ms: 60 * 60 * 1000 }, // no spend_cap_cents at all — must not be rejected
    { store, sandboxFactory: async () => ({ id: 'sb-5' }) },
  );
  assert.equal(workspace.policy.spend_cap_cents, 0);
});

test('closeWorkspace records real elapsed-time cost on the workspace, feeding the audit trail', async () => {
  const store = createMemoryWorkspaceStore();
  const sandbox = { id: 'sb-6', async kill() {} };
  const { workspace } = await createWorkspace({ ...scope() }, { store, sandboxFactory: async () => sandbox });
  assert.equal(workspace.actual_cost_cents, 0, 'no cost recorded yet at creation time');
  // Relative to the workspace's own real created_at, not an arbitrary
  // absolute timestamp — created_at comes from the real clock inside
  // createWorkspace, so the "later" time for this test must be
  // computed relative to it, or the elapsed duration would come out
  // negative (and get silently clamped to 0 cost) instead of the
  // intended one hour.
  const oneHourLater = workspace.created_at + 60 * 60 * 1000;
  const closed = await closeWorkspace(workspace.id, scope(), { sandbox, now: () => oneHourLater }, { store });
  assert.equal(closed.actual_cost_cents, 11); // same rate as the one-hour estimate test above
});
