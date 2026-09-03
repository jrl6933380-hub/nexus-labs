import test from 'node:test';
import assert from 'node:assert/strict';
import { saveSnapshotVersion, listSnapshotVersions, restoreSnapshotVersion } from '../lib/snapshotVault.js';

const state = { raw: null };
global.fetch = async (_url, options) => {
  const command = JSON.parse(options.body);
  let result = null;
  if (command[0] === 'GET') result = state.raw;
  if (command[0] === 'SET') { state.raw = command[2]; result = 'OK'; }
  return { ok: true, async json() { return { result }; } };
};

test('saves, lists, filters, and restores a version', async () => {
  const version = await saveSnapshotVersion({ snapshot_id: 'snap-1', source: { commit_sha: 'abc' } }, 'before-edit');
  assert.equal(version.label, 'before-edit');
  assert.equal((await listSnapshotVersions('before-edit')).length, 1);
  assert.equal((await restoreSnapshotVersion(version.version_id)).snapshot_id, 'snap-1');
});

test('restores fail closed for an unknown version', async () => {
  await assert.rejects(() => restoreSnapshotVersion('missing-version'), /not found/);
});
