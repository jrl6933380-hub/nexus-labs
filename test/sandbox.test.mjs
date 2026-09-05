import test from 'node:test';
import assert from 'node:assert/strict';
import { runInWorkspace } from '../lib/sandbox.js';
import { createMemoryWorkspaceStore } from '../lib/workspaceManager.js';

function scope() { return { tenant_id: 'tenant-a', project_id: 'project-a', task_id: 'task-a', agent_id: 'worker-a' }; }

function fakeSandbox() {
  const ran = [];
  return {
    id: 'sb-fake',
    killed: false,
    commands: { async run(command) { ran.push(command); return { stdout: 'ok', stderr: '', exitCode: 0 }; } },
    async kill() { this.killed = true; },
    ran,
  };
}

// --- SECURITY: max_commands was previously self-satisfied (set to
// commands.length before being checked), so no real ceiling ever
// existed. These tests verify the actual enforcement: an over-cap
// request is rejected and the sandbox is still cleaned up — not that a
// policy number merely got stored somewhere.
//
// Default is 32 (the same as the global ceiling), not a stricter
// sub-limit — real usage routinely runs more than a handful of
// commands per workspace call, so a lower default would have broken
// existing behavior for no real safety gain. What matters is that a
// real, finite cap exists at all. ---

test('runs all commands and returns their results when within the default cap', async () => {
  const store = createMemoryWorkspaceStore();
  const sandbox = fakeSandbox();
  const { results } = await runInWorkspace(
    { ...scope(), commands: ['echo one', 'echo two'] },
    { store, sandboxFactory: async () => sandbox },
  );
  assert.equal(results.length, 2);
  assert.deepEqual(sandbox.ran, ['echo one', 'echo two']);
  assert.equal(sandbox.killed, true, 'workspace/sandbox must be closed after a normal run');
});

test('20 commands run fine under the default cap (real usage regularly exceeds a handful)', async () => {
  const store = createMemoryWorkspaceStore();
  const sandbox = fakeSandbox();
  const commands = Array.from({ length: 20 }, (_, i) => `echo ${i}`);
  const { results } = await runInWorkspace(
    { ...scope(), commands },
    { store, sandboxFactory: async () => sandbox },
  );
  assert.equal(results.length, 20);
  assert.equal(sandbox.killed, true);
});

test('rejects a command list exceeding the default max_commands (32) instead of running it anyway', async () => {
  const store = createMemoryWorkspaceStore();
  const sandbox = fakeSandbox();
  const commands = Array.from({ length: 33 }, (_, i) => `echo ${i}`);
  await assert.rejects(
    () => runInWorkspace({ ...scope(), commands }, { store, sandboxFactory: async () => sandbox }),
    /Too many commands: 33 exceeds this workspace's max_commands policy of 32/,
  );
  assert.equal(sandbox.ran.length, 0, 'no commands should have run before the cap was checked');
});

test('the sandbox is still closed (not orphaned) when the command count is rejected', async () => {
  const store = createMemoryWorkspaceStore();
  const sandbox = fakeSandbox();
  const commands = Array.from({ length: 40 }, (_, i) => `echo ${i}`);
  await assert.rejects(() => runInWorkspace({ ...scope(), commands }, { store, sandboxFactory: async () => sandbox }));
  assert.equal(sandbox.killed, true);
});

test('an explicit lower max_commands is still honored and enforced (opt-in to a stricter limit)', async () => {
  const store = createMemoryWorkspaceStore();
  const sandbox = fakeSandbox();
  const commands = Array.from({ length: 5 }, (_, i) => `echo ${i}`);
  await assert.rejects(
    () => runInWorkspace({ ...scope(), commands, max_commands: 3 }, { store, sandboxFactory: async () => sandbox }),
    /max_commands policy of 3/,
  );
});

test('an explicit max_commands above the global ceiling is still clamped to 32, and enforced', async () => {
  const store = createMemoryWorkspaceStore();
  const sandbox = fakeSandbox();
  const commands = Array.from({ length: 33 }, (_, i) => `echo ${i}`);
  await assert.rejects(
    () => runInWorkspace({ ...scope(), commands, max_commands: 999 }, { store, sandboxFactory: async () => sandbox }),
    /max_commands policy of 32/,
  );
});

test('requires at least one command', async () => {
  await assert.rejects(() => runInWorkspace({ ...scope(), commands: [] }), /At least one command is required/);
});
