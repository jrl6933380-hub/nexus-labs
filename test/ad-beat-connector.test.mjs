import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdTrackStore } from '../lib/adTracks.js';
import { createWorkspaceService, WORKSPACE_WRITES, WORKSPACE_ACTIONS } from '../lib/workspaceConnector.js';
import { WORKSPACE_TOOLS } from '../lib/workspaceBoard.js';

const owner = { id: 'owner', workbenchUserId: 'w', scheduleUserId: 's' };

function tracks() {
  const hash = new Map();
  let n = 0;
  const command = async ([op, ...args]) => {
    if (op === 'HGET') return hash.get(args[1]) || null;
    if (op === 'HVALS') return [...hash.values()];
    if (op === 'HLEN') return hash.size;
    if (op === 'HSET') { hash.set(args[1], args[2]); return 1; }
    if (op === 'HDEL') return hash.delete(args[1]) ? 1 : 0;
    throw Error(op);
  };
  return createAdTrackStore({ command, now: () => 1, newId: () => 'trk-' + String(++n).padStart(4, '0') });
}

test('beat tools are registered as writes and every schema field is an allowed connector field', () => {
  const byName = Object.fromEntries(WORKSPACE_TOOLS.map((t) => [t[0], t]));
  for (const [tool, action] of [['make_nexus_beat', 'make_beat'], ['make_nexus_freestyle', 'make_freestyle']]) {
    assert.equal(byName[tool][4], true);
    assert.ok(WORKSPACE_WRITES.has(action));
    for (const f of Object.keys(byName[tool][3])) if (f !== 'request_id') assert.ok(WORKSPACE_ACTIONS[action].includes(f), `${action} allows ${f}`);
    for (const f of WORKSPACE_ACTIONS[action]) assert.ok(f in byName[tool][3], `${tool} declares ${f}`);
  }
});

test('make_freestyle and make_beat run through the connector', async () => {
  const saved = [];
  const ads = { async save(user, input) { saved.push(input); return { campaign_id: input.campaign_id, name: input.project.name, baseline: 'b', studio_url: 'u' }; } };
  const run = createWorkspaceService({ ads, tracks: tracks() });
  const fs = await run('make_freestyle', { lyrics: 'Late night in the lab\nBeats on the dash', style: 'trap', title: 'Lab', campaign_id: 'lab-fs' }, owner);
  assert.equal(fs.saved, true);
  assert.equal(fs.campaign_id, 'lab-fs');
  assert.equal(saved.length, 1);
  const track = await run('read_track', { track_id: fs.track_id }, owner);
  assert.equal(track.song.bpm, fs.bpm);
  assert.equal(track.words.length, 8);

  const beat = await run('make_beat', { track_id: fs.track_id, style: 'lofi' }, owner);
  assert.equal(beat.bpm, fs.bpm);
  assert.equal(beat.song.tracks.length > 3, true);
  await assert.rejects(() => run('make_beat', { style: 'polka' }, owner), /style must be one of/);
  await assert.rejects(() => run('make_beat', { nope: 1 }, owner), /Unsupported field/);
});
