import test from 'node:test';
import assert from 'node:assert/strict';

import { advanceNexRunState, createNexRunState, loadNexRunState, publicRunState, shouldCheckpointNexRun } from '../lib/nexRunState.js';

test('creates a scoped run with a secret-safe perception fingerprint', () => {
  const state = createNexRunState({ clientContext: { active_view: '/room', screen: { viewport_text: ['hello'] } } });
  assert.match(state.runId, /^nex-turn-/);
  assert.match(state.perceptionDigest, /^[a-f0-9]{20}$/);
  assert.doesNotMatch(JSON.stringify(publicRunState(state)), /hello/);
});

test('resumes only a real stored Nex turn id in the same operator scope', async () => {
  const runId = 'nex-turn-12345678';
  const seeded = createNexRunState({ scopeId: 'mrlopez' });
  const state = await loadNexRunState({ resumeRunId: runId, scopeId: 'mrlopez' }, { getExecutionResume: async () => ({ run_id: runId, scope_hash: seeded.scopeHash, state: 'paused', next_safe_action: 'Run tests.' }) });
  assert.equal(state.runId, runId);
  assert.equal(state.resumed, true);
  assert.equal(state.nextSafeAction, 'Run tests.');
});

test('rejects a resume pointer from another operator scope', async () => {
  const runId = 'nex-turn-12345678';
  const other = createNexRunState({ scopeId: 'other-user' });
  const state = await loadNexRunState({ resumeRunId: runId, scopeId: 'mrlopez' }, { getExecutionResume: async () => ({ run_id: runId, scope_hash: other.scopeHash }) });
  assert.equal(state.resumed, false);
  assert.notEqual(state.runId, runId);
});

test('meaningful tools advance branch and file checkpoints', () => {
  const start = createNexRunState();
  const next = advanceNexRunState(start, { name: 'patch_repo_file', input: { branch: 'feature/x', path: 'lib/x.js' } }, { content: 'patched' });
  assert.equal(next.workingBranch, 'feature/x');
  assert.deepEqual(next.filesTouched, ['lib/x.js']);
  assert.equal(shouldCheckpointNexRun({ name: 'patch_repo_file' }, { content: 'ok' }), true);
});

test('a failed tool blocks the run and forces inspection before retry', () => {
  const next = advanceNexRunState(createNexRunState(), { name: 'update_repo_file' }, { content: 'timeout', is_error: true });
  assert.equal(next.state, 'blocked');
  assert.match(next.nextSafeAction, /Inspect/);
  assert.equal(shouldCheckpointNexRun({ name: 'anything' }, { is_error: true }), true);
});
