import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { composeAdFromBrief } from '../lib/adComposer.js';
import { buildVariants, adVariantsSchema } from '../lib/adVariants.js';
import { createWorkspaceService, WORKSPACE_WRITES } from '../lib/workspaceConnector.js';
import { freshPreset } from '../public/ad-maker-model.mjs';
import { validateProjectV2, REGISTRY } from '../public/ad-vocabulary.mjs';

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

test('auto mode makes distinct, valid look variants that never repeat the current palette and keep the copy', () => {
  for (const count of [2, 3, 4]) {
    const source = base(), variants = buildVariants(source, { count });
    assert.equal(variants.length, count);
    assert.equal(new Set(variants.map((v) => v.project.palette)).size, count);
    for (const v of variants) {
      assert.equal(validateProjectV2(v.project).ok, true);
      assert.notEqual(v.project.palette, source.palette);
      assert.deepEqual(v.project.scenes, source.scenes);
      assert.match(v.project.name, /Sunrise Cafe/);
      assert.ok(v.label);
    }
  }
  assert.deepEqual(buildVariants(base(), { count: 3 }).map((v) => v.label), buildVariants(base(), { count: 3 }).map((v) => v.label)); // deterministic
});

test('explicit mode: a mood alone borrows a matching palette; hook and format variants work; nothing else changes', () => {
  const source = base(), snapshot = JSON.stringify(source);
  const [luxury, hook] = buildVariants(source, { variants: [{ mood: 'luxury' }, { hook: 'question', format: 'square' }] });
  assert.equal(luxury.project.mood, 'luxury');
  assert.ok(REGISTRY.palettes.find((p) => p.id === luxury.project.palette).tags.mood.includes('luxury'));
  assert.equal(hook.project.platform.format, 'square');
  assert.equal(hook.project.scenes[0].params.headline, 'Where is your next coffee?');
  assert.equal(hook.project.scenes[1].params.headline, source.scenes[1].params.headline);
  assert.equal(JSON.stringify(source), snapshot);
});

test('bad requests are rejected', () => {
  assert.throws(() => buildVariants(base(), { variants: [{}] }), /changes nothing/);
  assert.throws(() => buildVariants(base(), { count: 2, variants: [{ mood: 'bold' }] }), /either count or variants/);
  const noIndustry = { ...base(), tags: { goal: 'visit' } };
  assert.throws(() => buildVariants(noIndustry, { variants: [{ hook: 'question' }] }), /industry tag/);
  assert.equal(adVariantsSchema.safeParse({ campaign_id: 'a', count: 5 }).success, false);
  assert.equal(adVariantsSchema.safeParse({ campaign_id: 'a', count: 3, extra: 1 }).success, false);
  assert.equal(adVariantsSchema.safeParse({ campaign_id: 'a', variants: [{ mood: 'neon' }] }).success, false);
});

test('workspace action: dry_run stores nothing; real run saves new ads, leaves the original alone, and never reuses ids', async () => {
  const ads = memoryStore();
  const run = createWorkspaceService({ ads });
  assert.equal(WORKSPACE_WRITES.has('make_variants'), true);
  const created = await run('create_ad_from_brief', { ...brief, campaign_id: 'cafe' }, account);
  const dry = await run('make_variants', { campaign_id: 'cafe', count: 3, dry_run: true }, account);
  assert.equal(dry.dry_run, true);
  assert.equal(dry.variants.length, 3);
  assert.equal((await ads.list('owner')).campaigns.length, 1);
  const first = await run('make_variants', { campaign_id: 'cafe', count: 3 }, account);
  assert.deepEqual(first.variants.map((v) => v.campaign_id), ['cafe-v1', 'cafe-v2', 'cafe-v3']);
  const second = await run('make_variants', { campaign_id: 'cafe', variants: [{ mood: 'bold' }] }, account);
  assert.deepEqual(second.variants.map((v) => v.campaign_id), ['cafe-v4']);
  assert.equal((await ads.list('owner')).campaigns.length, 5);
  const original = await run('ad', { campaign_id: 'cafe' }, account);
  assert.equal(original.baseline, created.baseline);
  assert.equal((await run('ad', { campaign_id: 'cafe-v1' }, account)).spec_version, 2);
  await assert.rejects(run('make_variants', { campaign_id: 'missing', count: 2 }, account), (e) => e.status === 404);
  await assert.rejects(run('make_variants', { campaign_id: 'cafe', count: 9 }, account), (e) => e.status === 400);
  await ads.save('owner', { campaign_id: 'legacy-1', project: freshPreset() });
  await assert.rejects(run('make_variants', { campaign_id: 'legacy-1', count: 2 }, account), (e) => e.status === 400 && /vocabulary/.test(e.message));
});

test('MCP registry exposes make_nexus_ad_variants as a strict write tool', async () => {
  const { WORKSPACE_TOOLS } = await import('../lib/workspaceBoard.js');
  const tool = WORKSPACE_TOOLS.find(([name]) => name === 'make_nexus_ad_variants');
  assert.ok(tool);
  assert.equal(tool[1], 'make_variants');
  assert.equal(tool[4], true);
  assert.ok(tool[3].request_id && tool[3].campaign_id);
  assert.equal(new Set(WORKSPACE_TOOLS.map(([n]) => n)).size, WORKSPACE_TOOLS.length);
});
