import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { createAdMediaStore } from '../lib/adMedia.js';
import { createRenderJobStore, normalizeRenderOptions } from '../lib/adRenderJobs.js';
import { createWorkspaceService, WORKSPACE_WRITES, WORKSPACE_ACTIONS } from '../lib/workspaceConnector.js';
import { composeAdFromBrief } from '../lib/adComposer.js';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const owner = { id: 'owner', workbenchUserId: 'w', scheduleUserId: 's' };
function stores() {
  const hashes = new Map(), kv = new Map(); let n = 0;
  const command = async ([op, ...a]) => {
    const h = hashes.get(a[0]) || new Map();
    switch (op) {
      case 'HSET': hashes.set(a[0], h); h.set(a[1], a[2]); return 1;
      case 'HSETNX': hashes.set(a[0], h); if (h.has(a[1])) return 0; h.set(a[1], a[2]); return 1;
      case 'HGET': return h.get(a[1]) ?? null;
      case 'HVALS': return [...h.values()];
      case 'HGETALL': return [...h.entries()].flat();
      case 'HLEN': return h.size;
      case 'HEXISTS': return h.has(a[1]) ? 1 : 0;
      case 'HDEL': return h.delete(a[1]) ? 1 : 0;
      case 'DEL': hashes.delete(a[0]); return kv.delete(a[0]) ? 1 : 0;
      case 'SET': kv.set(a[0], a[1]); return 'OK';
      case 'GET': return kv.get(a[0]) ?? null;
      case 'EXPIRE': return 1;
      case 'EVAL': { const [, , key, id, previous, value] = a; const hh = hashes.get(key) || new Map(); if ((hh.get(id) || '') !== previous) return 0; hh.set(id, value); hashes.set(key, hh); return 1; }
      default: throw Error(op);
    }
  };
  return { ads: createAdCampaignStore({ command, uuid: () => 'b' + ++n, now: () => 1 }), media: createAdMediaStore({ command, now: () => 1 }), renders: createRenderJobStore({ command, now: () => 1000 + n }) };
}

const gproject = () => { const p = JSON.parse(JSON.stringify(GRAPHIC_DEMOS.loadout.project)); p.scenes[0].id = 's1'; p.scenes[0].params = { layers: [
  { id: 'bg', name: 'Sky', role: 'background', shape: 'rect', x: 50, y: 50, w: 100, h: 100, color: 'blue' },
  { shape: 'circle', x: 20, y: 20, w: 10, color: 'red' }] }; return p; };

test('layer tools are registered; edit_layers is a write, reads are not', () => {
  assert.ok(WORKSPACE_WRITES.has('edit_layers'));
  for (const a of ['read_layers', 'view_layers', 'check_separability']) assert.ok(WORKSPACE_ACTIONS[a] && !WORKSPACE_WRITES.has(a), a);
  assert.ok(WORKSPACE_ACTIONS.render_ad.includes('transparent') && WORKSPACE_ACTIONS.render_ad.includes('start_sec'));
});
test('read, dry-run, edit, stale baseline and bad ops through the connector', async () => {
  const { ads, media, renders } = stores();
  const run = createWorkspaceService({ ads, media, renders });
  const saved = await run('save_ad_v2', { campaign_id: 'g1', project: gproject() }, owner);
  const scenes = await run('read_layers', { campaign_id: 'g1' }, owner);
  assert.equal(scenes.graphic_scenes[0].anonymous, 1);
  const dry = await run('edit_layers', { campaign_id: 'g1', scene_id: 's1', edits: [{ op: 'patch', layer_id: 'bg', patch: { color: 'red' } }], dry_run: true }, owner);
  assert.equal(dry.dry_run, true);
  assert.equal((await run('read_layers', { campaign_id: 'g1', scene_id: 's1', layer_id: 'bg' }, owner)).layer.color, 'blue');
  const done = await run('edit_layers', { campaign_id: 'g1', baseline: saved.baseline, scene_id: 's1', edits: [{ op: 'patch', layer_id: 'bg', patch: { color: 'red' } }, { op: 'reveal_wipe', layer_id: 'bg', duration: 1 }] }, owner);
  assert.equal(done.saved, true); assert.ok(done.changes.length >= 2); assert.ok(done.layer_hashes.bg);
  const list = await run('read_layers', { campaign_id: 'g1', scene_id: 's1' }, owner);
  assert.ok(list.layers.every((l) => l.id)); assert.equal(list.layers.find((l) => l.id === 'bg').animated, true);
  await assert.rejects(run('edit_layers', { campaign_id: 'g1', baseline: saved.baseline, scene_id: 's1', edits: [{ op: 'remove', layer_id: 'bg' }] }, owner), (e) => e.status === 409);
  await assert.rejects(run('edit_layers', { campaign_id: 'g1', scene_id: 's1', edits: [{ op: 'patch', layer_id: 'nope', patch: { x: 1 } }] }, owner), /Edit 1 \(patch\)/);
  await assert.rejects(run('edit_layers', { campaign_id: 'g1', scene_id: 's1', edits: [{ op: 'explode' }] }, owner), /Invalid layer edit/);
});
test('render options: sequence and layers kinds, transparent, and early refusals', async () => {
  assert.deepEqual(normalizeRenderOptions('still', { transparent: true }), { scale: 1, transparent: true });
  assert.equal(normalizeRenderOptions('sequence', {}).fps, 24);
  assert.throws(() => normalizeRenderOptions('sequence', { fps: 6 }), /fps must be/);
  assert.throws(() => normalizeRenderOptions('layers', { layer_ids: ['a', 'b', 'c', 'd', 'e'] }), /up to 4/);
  const { ads, media, renders } = stores();
  const run = createWorkspaceService({ ads, media, renders });
  await run('save_ad_v2', { campaign_id: 'g1', project: gproject() }, owner);
  await run('save_ad_v2', { campaign_id: 'p1', project: composeAdFromBrief({ business_name: 'Sunrise Cafe', industry: 'cafe', goal: 'visit', length_sec: 30 }).project }, owner);
  const seq = await run('render_ad', { campaign_id: 'g1', kind: 'sequence', transparent: true, start_sec: 0, end_sec: 1 }, owner);
  assert.equal(seq.options.transparent, true); assert.equal(seq.options.to, 1);
  await assert.rejects(run('render_ad', { campaign_id: 'g1', kind: 'sequence', start_sec: 0, end_sec: 30, fps: 60 }, owner), /exceeds|past the end/);
  await assert.rejects(run('render_ad', { campaign_id: 'p1', kind: 'layers' }, owner), /no graphic scenes/);
  await assert.rejects(run('render_ad', { campaign_id: 'g1', kind: 'mp4', transparent: true }, owner), /transparent works with/);
  const lay = await run('render_ad', { campaign_id: 'g1', kind: 'layers', scene: 's1' }, owner);
  await assert.rejects(run('view_layers', { job_id: lay.job_id }, owner), (e) => e.status === 409);
  await assert.rejects(run('view_layers', { job_id: seq.job_id }, owner), /not a layers render/);
});
