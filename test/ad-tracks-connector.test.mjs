import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdTrackStore } from '../lib/adTracks.js';
import { createWorkspaceService, WORKSPACE_WRITES, WORKSPACE_ACTIONS } from '../lib/workspaceConnector.js';
import { WORKSPACE_TOOLS } from '../lib/workspaceBoard.js';

const owner = { id: 'owner', workbenchUserId: 'w', scheduleUserId: 's' };
const other = { id: 'someone', workbenchUserId: 'w2', scheduleUserId: 's2' };

function trackStore() {
  const hashes = new Map();
  let n = 0;
  const command = async ([op, ...args]) => {
    const hash = hashes.get(args[0]) || new Map();
    hashes.set(args[0], hash);
    if (op === 'HGET') return hash.get(args[1]) || null;
    if (op === 'HVALS') return [...hash.values()];
    if (op === 'HLEN') return hash.size;
    if (op === 'HSET') { hash.set(args[1], args[2]); return 1; }
    if (op === 'HDEL') return hash.delete(args[1]) ? 1 : 0;
    throw Error(op);
  };
  return createAdTrackStore({ command, now: () => 1, newId: () => 'trk-' + String(++n).padStart(4, '0') });
}
const envelope = { rate: 10, low: Array(50).fill(40), mid: Array(50).fill(30), high: Array(50).fill(20) };

test('track tools are registered with the right write flags and connector fields', () => {
  const byName = Object.fromEntries(WORKSPACE_TOOLS.map((t) => [t[0], t]));
  assert.equal(byName.list_nexus_tracks[4], false);
  assert.equal(byName.read_nexus_track[4], false);
  for (const name of ['save_nexus_track', 'update_nexus_track', 'delete_nexus_track']) assert.equal(byName[name][4], true);
  for (const action of ['save_track', 'update_track', 'delete_track']) assert.ok(WORKSPACE_WRITES.has(action));
  for (const action of ['tracks', 'read_track']) assert.ok(!WORKSPACE_WRITES.has(action));
  assert.ok(WORKSPACE_ACTIONS.save_track.includes('envelope') && WORKSPACE_ACTIONS.save_track.includes('words'));
  // every field the zod schema accepts is an allowed connector field
  for (const [name, action] of [['save_nexus_track', 'save_track'], ['update_nexus_track', 'update_track'], ['read_nexus_track', 'read_track']]) {
    const shape = byName[name][3];
    for (const f of Object.keys(shape)) if (f !== 'request_id') assert.ok(WORKSPACE_ACTIONS[action].includes(f), `${action} allows ${f}`);
  }
});

test('save, list, read for a scene, add lyrics later, delete: end to end through the connector', async () => {
  const run = createWorkspaceService({ tracks: trackStore() });
  const saved = await run('save_track', { name: 'Freestyle 1', source: 'recorded', seconds: 5, bpm: 92, bpm_confidence: 0.7, beat_offset: 0.1, envelope }, owner);
  assert.equal(saved.saved, true);
  assert.equal((await run('tracks', {}, owner)).tracks.length, 1);
  assert.equal((await run('tracks', {}, other)).tracks.length, 0, 'libraries are per account');

  const read = await run('read_track', { track_id: saved.track_id, scene_start: 1, scene_duration: 2 }, owner);
  assert.equal(read.scene_params.audioLow.length, 20);
  assert.equal(read.scene_params.bpm, 92);

  const fixed = await run('update_track', { track_id: saved.track_id, transcript: 'first line', words: [{ w: 'first', s: 0.5, e: 0.9 }, { w: 'line', s: 1, e: 1.4 }] }, owner);
  assert.equal(fixed.word_count, 2);
  assert.equal((await run('read_track', { track_id: saved.track_id }, owner)).transcript, 'first line');

  await assert.rejects(() => run('save_track', { name: 'x', seconds: 5, surprise: 1 }, owner), /Unsupported field/);
  await assert.rejects(() => run('read_track', { track_id: saved.track_id }, other), /not found/);
  assert.deepEqual(await run('delete_track', { track_id: saved.track_id }, owner), { deleted: true, track_id: saved.track_id });
  assert.equal((await run('tracks', {}, owner)).tracks.length, 0);
});
