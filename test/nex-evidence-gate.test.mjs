import test from 'node:test';
import assert from 'node:assert/strict';

import { createEvidenceTracker } from '../lib/nexEvidenceGate.js';

const ok = (content = '{}') => ({ content });

test('casual chat produces a not-required receipt instead of a false failure', () => {
  const receipt = createEvidenceTracker({ lane: 'chat', requireEvidence: [] }).receipt();
  assert.equal(receipt.status, 'not_required');
});

test('a pull request fails closed until source, branch, tests, and diff are proven', () => {
  const tracker = createEvidenceTracker({ lane: 'code', requireEvidence: ['source_read', 'non_live_branch', 'targeted_diff', 'relevant_tests'] });
  assert.equal(tracker.authorize('create_pull_request').allowed, false);
  tracker.record({ name: 'read_repo_file' }, ok());
  tracker.record({ name: 'create_branch' }, ok());
  tracker.record({ name: 'run_sandbox' }, ok('{"results":[{"exitCode":0}]}'));
  tracker.record({ name: 'inspect_branch_diff' }, ok('{"catastrophic_diffs":[]}'));
  assert.equal(tracker.authorize('create_pull_request').allowed, true);
  assert.equal(tracker.receipt().status, 'verified');
});

test('failed tests and catastrophic diffs do not count as evidence', () => {
  const tracker = createEvidenceTracker({ lane: 'code', requireEvidence: ['relevant_tests', 'targeted_diff'] });
  tracker.record({ name: 'test_code' }, ok('{"exitCode":1}'));
  tracker.record({ name: 'inspect_branch_diff' }, ok('{"catastrophic_diffs":["deleted file"]}'));
  assert.deepEqual(tracker.receipt().missing, ['relevant_tests', 'targeted_diff']);
});

test('a failed tool result never satisfies an evidence requirement', () => {
  const tracker = createEvidenceTracker({ lane: 'code', requireEvidence: ['source_read'] });
  tracker.record({ name: 'read_repo_file' }, { content: 'failed', is_error: true });
  assert.equal(tracker.receipt().status, 'incomplete');
});

test('a queued live-branch write is not mistaken for an executed safe-branch write', () => {
  const tracker = createEvidenceTracker({ lane: 'code', requireEvidence: ['non_live_branch'] });
  tracker.record(
    { name: 'update_repo_file', input: { branch: 'main', path: 'app.js' } },
    ok('Targets the live branch — only PROPOSED, not yet executed. Queue id: q1'),
  );
  assert.equal(tracker.receipt().status, 'incomplete');
  assert.ok(!tracker.receipt().observed.includes('write_succeeded'));
});

test('receipts expose metadata without copying raw tool output', () => {
  const tracker = createEvidenceTracker({ lane: 'code', requireEvidence: [] });
  tracker.record({ name: 'patch_repo_file', input: { path: 'lib/app.js', branch: 'feature/x' } }, ok('secret output'));
  const receipt = tracker.receipt();
  assert.deepEqual(receipt.events[0], { tool: 'patch_repo_file', ok: true, target: 'lib/app.js', branch: 'feature/x' });
  assert.doesNotMatch(JSON.stringify(receipt), /secret output/);
});
