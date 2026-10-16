import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { composeAdFromBrief } from '../lib/adComposer.js';
import { applyAdEdits, adEditSchema } from '../lib/adEdit.js';
import { createWorkspaceService, WORKSPACE_WRITES } from '../lib/workspaceConnector.js';
import { freshPreset } from '../public/ad-maker-model.mjs';
import { validateProjectV2, totalDurationV2 } from '../public/ad-vocabulary.mjs';

const brief = { business_name: 'Sunrise Cafe', industry: 'cafe', goal: 'visit', length_sec: 30 };
const base = () => composeAdFromBrief(brief).project;
const account = { id: 'owner', workbenchUserId: 'w', scheduleUserId: 's' };
function memoryStore() {
  const hashes = new Map();
  let n = 0;
  const command = async ([op, ...args]) => {
    if (op === 'HGET') return hashes.get(args[0])?.get(args[1]) || null;
    if (op === 'HVALS') return [...(hashes.get(args[0]) || new Map()).values()];
    if (op === 'EVAL') {
      const [, , key, id, previous, value] = args;
      const hash = hashes.get(key) || new Map();
      if ((hash.get(id) || '') !== previous) return 0;
      hash.set(id, value);
      hashes.set(key, hash);
      return 1;
    }
    throw Error(op);
  };
  return createAdCampaignStore({ command, uuid: () => 'b' + ++n, now: () => 1 });
}

test('update_scene merges params, null removes a field, and the input is never mutated', () => {
  const before = base(), snapshot = JSON.stringify(before);
  const { project, changes } = applyAdEdits(before, [{ op: 'update_scene', scene_id: 's1', params: { headline: 'Best coffee in town?', support: null }, camera: 'static' }]);
  assert.equal(project.scenes[0].params.headline, 'Best coffee in town?');
  assert.equal(project.scenes[0].params.support, undefined);
  assert.equal(project.scenes[0].params.textAnim, before.scenes[0].params.textAnim);
  assert.equal(project.scenes[0].camera, 'static');
  assert.deepEqual(changes, ['updated s1: params, camera']);
  assert.equal(JSON.stringify(before), snapshot);
});

test('add, remove and move scenes keep ids unique, order right and the length label honest', () => {
  let { project } = applyAdEdits(base(), [{ op: 'remove_scene', scene_id: 's4' }, { op: 'add_scene', after_scene_id: 's1', scene: { type: 'hook_text', duration: 2, params: { headline: 'Fresh daily' } } }]);
  assert.deepEqual(project.scenes.map((s) => s.id), ['s1', 'hook-text-1', 's2', 's3', 's5']);
  ({ project } = applyAdEdits(project, [{ op: 'add_scene', scene: { type: 'hook_text', duration: 2, params: { headline: 'Again' } } }]));
  assert.equal(project.scenes.at(-1).id, 'hook-text-2');
  ({ project } = applyAdEdits(project, [{ op: 'move_scene', scene_id: 's5', to_index: 0 }]));
  assert.equal(project.scenes[0].id, 's5');
  const short = applyAdEdits(base(), [{ op: 'remove_scene', scene_id: 's3' }, { op: 'remove_scene', scene_id: 's2' }, { op: 'update_scene', scene_id: 's1', duration: 2 }, { op: 'update_scene', scene_id: 's4', duration: 2 }, { op: 'update_scene', scene_id: 's5', duration: 2 }]);
  assert.equal(totalDurationV2(short.project), 6);
  assert.equal(short.project.platform.lengthSec, 6);
  assert.ok(short.changes.some((c) => /length label set to 6s/.test(c)));
});

test('set_project changes name, mood, palette and format', () => {
  const { project } = applyAdEdits(base(), [{ op: 'set_project', name: 'Cafe v2', mood: 'bold', palette: 'electric-pop', format: 'square' }]);
  assert.equal(project.name, 'Cafe v2');
  assert.equal(project.mood, 'bold');
  assert.equal(project.palette, 'electric-pop');
  assert.equal(project.platform.format, 'square');
});

test('bad edits fail loudly and change nothing', () => {
  const bad = [
    [{ op: 'remove_scene', scene_id: 'nope' }],
    [{ op: 'update_scene', scene_id: 's1' }],
    [{ op: 'update_scene', scene_id: 's1', params: { headline: 'x'.repeat(200) } }],
    [{ op: 'update_scene', scene_id: 's1', params: { surprise: 'field' } }],
    [{ op: 'update_scene', scene_id: 's1', duration: 99 }],
    [{ op: 'add_scene', scene: { id: 's1', type: 'hook_text', duration: 3, params: { headline: 'Dup' } } }],
    [{ op: 'add_scene', scene: { type: 'laser_show', duration: 3, params: {} } }],
    [{ op: 'set_project' }],
    [{ op: 'explode' }],
    [],
  ];
  for (const edits of bad) assert.throws(() => applyAdEdits(base(), edits), (e) => e.status === 400, JSON.stringify(edits));
  const crowded = base();
  assert.throws(() => applyAdEdits(crowded, Array.from({ length: 4 }, () => ({ op: 'add_scene', scene: { type: 'hook_text', duration: 3, params: { headline: 'More' } } }))), /invalid/i); // 5 + 4 scenes > 8
  assert.throws(() => applyAdEdits(base(), [{ op: 'remove_scene', scene_id: 's1' }, { op: 'remove_scene', scene_id: 's2' }, { op: 'remove_scene', scene_id: 's3' }, { op: 'remove_scene', scene_id: 's4' }]), /invalid/i); // fewer than 2 scenes
  assert.equal(adEditSchema.safeParse({ campaign_id: 'a', edits: [{ op: 'remove_scene', scene_id: 's1' }], extra: 1 }).success, false);
  assert.equal(validateProjectV2(applyAdEdits(base(), [{ op: 'update_scene', scene_id: 's1', duration: 4 }]).project).ok, true);
});

test('workspace action: reads, edits, saves with CAS, supports dry_run, and guards stale or legacy ads', async () => {
  const ads = memoryStore();
  const run = createWorkspaceService({ ads });
  assert.equal(WORKSPACE_WRITES.has('edit_ad'), true);
  const created = await run('create_ad_from_brief', { ...brief, campaign_id: 'edit-me' }, account);
  const dry = await run('edit_ad', { campaign_id: 'edit-me', edits: [{ op: 'update_scene', scene_id: 's1', params: { headline: 'Dry change' } }], dry_run: true }, account);
  assert.equal(dry.dry_run, true);
  assert.notEqual((await run('ad', { campaign_id: 'edit-me' }, account)).project.scenes[0].params.headline, 'Dry change');
  const saved = await run('edit_ad', { campaign_id: 'edit-me', baseline: created.baseline, edits: [{ op: 'update_scene', scene_id: 's1', params: { headline: 'Real change' } }] }, account);
  assert.equal(saved.saved, true);
  assert.notEqual(saved.baseline, created.baseline);
  assert.equal((await run('ad', { campaign_id: 'edit-me' }, account)).project.scenes[0].params.headline, 'Real change');
  await assert.rejects(run('edit_ad', { campaign_id: 'edit-me', baseline: created.baseline, edits: [{ op: 'remove_scene', scene_id: 's4' }] }, account), (e) => e.status === 409); // stale baseline
  const noBaseline = await run('edit_ad', { campaign_id: 'edit-me', edits: [{ op: 'set_project', name: 'Renamed' }] }, account);
  assert.equal(noBaseline.name, 'Renamed');
  await assert.rejects(run('edit_ad', { campaign_id: 'missing', edits: [{ op: 'set_project', name: 'x' }] }, account), (e) => e.status === 404);
  await assert.rejects(run('edit_ad', { campaign_id: 'edit-me', edits: [{ op: 'remove_scene', scene_id: 'zzz' }] }, account), (e) => e.status === 400);
  await ads.save('owner', { campaign_id: 'legacy-1', project: freshPreset() });
  await assert.rejects(run('edit_ad', { campaign_id: 'legacy-1', edits: [{ op: 'set_project', name: 'x' }] }, account), (e) => e.status === 400 && /vocabulary/.test(e.message));
});

test('MCP registry exposes edit_nexus_ad as a strict write tool', async () => {
  const { WORKSPACE_TOOLS } = await import('../lib/workspaceBoard.js');
  const tool = WORKSPACE_TOOLS.find(([name]) => name === 'edit_nexus_ad');
  assert.ok(tool);
  assert.equal(tool[1], 'edit_ad');
  assert.equal(tool[4], true);
  assert.ok(tool[3].request_id && tool[3].campaign_id && tool[3].edits);
  assert.equal(new Set(WORKSPACE_TOOLS.map(([n]) => n)).size, WORKSPACE_TOOLS.length);
});
