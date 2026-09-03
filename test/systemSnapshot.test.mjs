import test from 'node:test';
import assert from 'node:assert/strict';
import { createSystemSnapshot, snapshotStaleness, selectSnapshotContext } from '../lib/systemSnapshot.js';

test('creates a bounded capability snapshot without credentials', () => {
  const snapshot = createSystemSnapshot({
    repository: 'nexus-labs', branch: 'test/system-snapshots', commit_sha: 'abc',
    capabilities: [{ name: 'create_file', access: 'write', approval: 'required', token: 'never-store' }],
    project: { files_touched: ['lib/systemSnapshot.js'] },
    generated_at: 1000,
  });
  assert.equal(snapshot.capabilities[0].name, 'create_file');
  assert.equal(Object.hasOwn(snapshot.capabilities[0], 'token'), false);
});

test('detects expiry, source changes, and scope mismatch', () => {
  const snapshot = createSystemSnapshot({ generated_at: 1000, ttl_ms: 100, commit_sha: 'abc', project: { files_touched: ['a.js'] } });
  assert.deepEqual(snapshotStaleness(snapshot, { now: 1101 }).reasons, ['expired']);
  assert.equal(snapshotStaleness(snapshot, { now: 1001, current_commit_sha: 'def' }).stale, true);
  assert.equal(snapshotStaleness(snapshot, { now: 1001, requested_paths: ['b.js'] }).stale, true);
});

test('selects only the context a worker needs', () => {
  const snapshot = createSystemSnapshot({ project: { task: 'x' }, architecture: { edge: 'y' } });
  assert.deepEqual(Object.keys(selectSnapshotContext(snapshot, ['project', 'architecture'])), ['project', 'architecture']);
});
