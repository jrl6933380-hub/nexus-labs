import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { createWorkspaceService, validateWorkspaceInput, WORKSPACE_WRITES } from '../lib/workspaceConnector.js';
import { adProjectSchemaV2, describeAdVocabulary, EXAMPLE_PROJECT, PLAYER_SUPPORT } from '../lib/adVocabularyTools.js';
import { validateProjectV2, REGISTRY } from '../public/ad-vocabulary.mjs';
import { freshPreset } from '../public/ad-maker-model.mjs';

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
  return createAdCampaignStore({ command, uuid: () => String(++n), now: () => 1 });
}
const account = { id: 'owner', workbenchUserId: 'w', scheduleUserId: 's' };
const clone = () => JSON.parse(JSON.stringify(EXAMPLE_PROJECT));

test('the documented example is valid for both the MCP schema and the registry validator', () => {
  assert.equal(validateProjectV2(EXAMPLE_PROJECT).ok, true);
  assert.equal(adProjectSchemaV2.safeParse(EXAMPLE_PROJECT).success, true);
});

test('MCP schema rejects ids and fields outside the vocabulary', () => {
  for (const mutate of [
    (p) => { p.mood = 'neon'; },
    (p) => { p.palette = 'nope'; },
    (p) => { p.scenes[0].type = 'confetti'; },
    (p) => { p.scenes[0].camera = 'spin'; },
    (p) => { p.scenes[0].html = '<script>x</script>'; },
    (p) => { p.extra = 1; },
    (p) => { p.scenes = [p.scenes[0]]; },
    (p) => { p.platform.lengthSec = 7; },
  ]) {
    const p = clone();
    mutate(p);
    assert.equal(adProjectSchemaV2.safeParse(p).success, false);
  }
});

test('describe output is built from the registry and is complete', () => {
  const d = describeAdVocabulary();
  assert.equal(d.vocabulary.vocabularyVersion, REGISTRY.vocabularyVersion);
  assert.equal(d.vocabulary.sceneTypes.length, 11);
  assert.ok(d.vocabulary.palettes.length >= 8);
  assert.equal(d.save_with, 'save_nexus_ad_v2');
  assert.ok(d.rules.some((r) => /Never invent statistics/.test(r)));
  assert.ok(d.rules.some((r) => /concept:true/.test(r)));
  d.vocabulary.moods.length = 0;
  assert.equal(describeAdVocabulary().vocabulary.moods.length, 5);
});

test('player_support matches the scene builders that really exist in the stock player', () => {
  const html = readFileSync(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
  const ids = REGISTRY.sceneTypes.map((t) => t.id);
  assert.deepEqual([...PLAYER_SUPPORT.full, ...PLAYER_SUPPORT.fallback].sort(), [...ids].sort());
  for (const id of PLAYER_SUPPORT.full) assert.ok(html.includes(`${id}(cam,sc,ctx)`), `${id} has a builder`);
  for (const id of PLAYER_SUPPORT.fallback) assert.ok(!html.includes(`${id}(cam,sc,ctx)`), `${id} is fallback only`);
});

test('workspace service: describe is read-only; save_ad_v2 saves, reads back and lists', async () => {
  const ads = memoryStore();
  const run = createWorkspaceService({ ads });
  assert.equal(WORKSPACE_WRITES.has('save_ad_v2'), true);
  assert.equal(WORKSPACE_WRITES.has('ad_vocabulary'), false);
  assert.equal((await run('ad_vocabulary', {}, account)).vocabulary.sceneTypes.length, 11);
  const saved = await run('save_ad_v2', { campaign_id: 'ad-pat', project: clone() }, account);
  assert.equal(saved.spec_version, 2);
  const read = await run('ad', { campaign_id: 'ad-pat' }, account);
  assert.equal(read.project.specVersion, 2);
  assert.ok(read.baseline);
  assert.equal((await run('ads', {}, account)).campaigns[0].renderer, 'vocabulary-player');
  const edited = clone();
  edited.name = 'Renamed';
  assert.equal((await run('save_ad_v2', { campaign_id: 'ad-pat', baseline: read.baseline, project: edited }, account)).project.name, 'Renamed');
  await assert.rejects(run('save_ad_v2', { campaign_id: 'ad-pat', baseline: read.baseline, project: edited }, account), (e) => e.status === 409);
});

test('save_ad_v2 refuses legacy projects, bad input and extra fields; legacy tool path is unchanged', async () => {
  const run = createWorkspaceService({ ads: memoryStore() });
  await assert.rejects(run('save_ad_v2', { campaign_id: 'x', project: freshPreset() }, account), /specVersion 2/);
  const bad = clone();
  bad.scenes[0].params.headline = 'x'.repeat(100);
  await assert.rejects(run('save_ad_v2', { campaign_id: 'x', project: bad }, account), (e) => e.status === 400 && /vocabulary/i.test(e.message));
  assert.throws(() => validateWorkspaceInput('save_ad_v2', { campaign_id: 'x', project: clone(), design: {} }), /Unsupported field/);
  assert.equal((await run('save_ad', { campaign_id: 'old', project: freshPreset() }, account)).saved, true);
});

test('MCP registry exposes both tools with correct read/write flags and strict inputs', async () => {
  const { WORKSPACE_TOOLS } = await import('../lib/workspaceBoard.js');
  const describe = WORKSPACE_TOOLS.find(([name]) => name === 'describe_nexus_ad_vocabulary');
  const save = WORKSPACE_TOOLS.find(([name]) => name === 'save_nexus_ad_v2');
  assert.ok(describe && save);
  assert.equal(describe[1], 'ad_vocabulary');
  assert.equal(describe[4], false);
  assert.equal(save[1], 'save_ad_v2');
  assert.equal(save[4], true);
  assert.ok(save[3].request_id && save[3].project);
  assert.equal(new Set(WORKSPACE_TOOLS.map(([name]) => name)).size, WORKSPACE_TOOLS.length);
  const legacy = WORKSPACE_TOOLS.find(([name]) => name === 'save_nexus_ad');
  assert.equal(legacy[3].project.safeParse(clone()).success, false); // legacy tool schema is unchanged
});
