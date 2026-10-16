import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { composeAdFromBrief, adBriefSchema } from '../lib/adComposer.js';
import { createWorkspaceService, validateWorkspaceInput, WORKSPACE_WRITES } from '../lib/workspaceConnector.js';
import { validateProjectV2, totalDurationV2, REGISTRY, TAGS } from '../public/ad-vocabulary.mjs';
import { PLAYER_SUPPORT } from '../lib/adVocabularyTools.js';

const base = { business_name: "Pat's Plumbing", industry: 'plumber', goal: 'call' };
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
  return createAdCampaignStore({ command, uuid: () => String(++n), now: () => 1 });
}

test('every industry x goal x format x length composes a valid ad with the exact requested length', () => {
  for (const industry of TAGS.industry) for (const goal of TAGS.goal) for (const format of REGISTRY.formats.map((f) => f.id)) for (const seconds of [6, 15, 30]) {
    const { project } = composeAdFromBrief({ ...base, industry, goal, format, length_sec: seconds });
    assert.equal(validateProjectV2(project).ok, true, `${industry}/${goal}/${format}/${seconds}`);
    assert.equal(totalDurationV2(project), seconds);
    assert.equal(project.platform.format, format);
    assert.equal(project.concept, true);
  }
});

test('composition is deterministic and only uses fully supported scene types', () => {
  assert.deepEqual(composeAdFromBrief(base), composeAdFromBrief(base));
  for (const seconds of [6, 15, 30]) {
    for (const s of composeAdFromBrief({ ...base, length_sec: seconds }).project.scenes) assert.ok(PLAYER_SUPPORT.full.includes(s.type));
  }
});

test('never invents numbers, phone numbers, offers or claims: only supplied facts appear', () => {
  for (const industry of TAGS.industry) for (const hook of TAGS.hook) {
    const { project, notes } = composeAdFromBrief({ ...base, industry, hook, length_sec: 30 });
    const copy = JSON.stringify(project.scenes.map((s) => s.params));
    assert.doesNotMatch(copy, /\d/, `${industry}/${hook} has no digits`);
    assert.ok(project.scenes.at(-1).params.destination === undefined);
    assert.ok(notes.some((n) => /No destination/.test(n)));
  }
  const withFacts = composeAdFromBrief({ ...base, destination: '(515) 555-0142', hook: 'offer', offer: 'Free quotes this week', location: 'Des Moines' });
  const copy = JSON.stringify(withFacts.project.scenes.map((s) => s.params));
  assert.match(copy, /555-0142/);
  assert.match(copy, /Free quotes this week/);
  assert.match(copy, /Des Moines/);
});

test('hooks that need facts fall back to a question and say so', () => {
  for (const hook of ['offer', 'stat', 'proof']) {
    const { project, notes } = composeAdFromBrief({ ...base, hook });
    assert.equal(project.tags.hook, 'question');
    assert.ok(notes.some((n) => new RegExp(`hook "${hook}"`).test(n)));
  }
  assert.equal(composeAdFromBrief({ ...base, hook: 'stat', headline: 'Our own sourced headline' }).project.tags.hook, 'stat');
});

test('mood, palette and concept label behave predictably', () => {
  assert.equal(composeAdFromBrief({ ...base, industry: 'salon' }).project.mood, 'luxury');
  assert.equal(composeAdFromBrief({ ...base, mood: 'playful' }).project.mood, 'playful');
  const p = composeAdFromBrief({ ...base, palette: 'ocean-blue' }).project;
  assert.equal(p.palette, 'ocean-blue');
  const m = REGISTRY.palettes.find((x) => x.id === composeAdFromBrief(base).project.palette);
  assert.ok(m.tags.mood.includes('bold'));
  const real = composeAdFromBrief({ ...base, concept: false }).project;
  assert.equal(real.concept, undefined);
  assert.equal(real.scenes.at(-1).params.tagline, undefined);
  assert.match(composeAdFromBrief(base).project.scenes.at(-1).params.tagline, /Concept preview/);
});

test('long, messy or hostile text is cleaned and clipped, and the result always validates', () => {
  const { project } = composeAdFromBrief({ ...base, business_name: 'A'.repeat(35), headline: 'x'.repeat(60), support: '  a\u0000b\n\nc  ', location: 'L'.repeat(30), cta: 'c'.repeat(25) });
  assert.equal(validateProjectV2(project).ok, true);
  assert.equal(project.scenes[0].params.support, 'a b c');
  assert.throws(() => composeAdFromBrief({ ...base, industry: 'spaceship' }), (e) => e.status === 400 && /Invalid brief/.test(e.message));
  assert.throws(() => composeAdFromBrief({ ...base, extra: 1 }), (e) => e.status === 400);
  assert.throws(() => composeAdFromBrief({ ...base, business_name: '' }), (e) => e.status === 400);
  assert.equal(adBriefSchema.safeParse({ ...base, headline: 'x'.repeat(61) }).success, false);
});

test('workspace action: dry_run does not store; real run saves, reads back and reports notes', async () => {
  const ads = memoryStore();
  const run = createWorkspaceService({ ads });
  assert.equal(WORKSPACE_WRITES.has('create_ad_from_brief'), true);
  const dry = await run('create_ad_from_brief', { ...base, dry_run: true }, account);
  assert.equal(dry.dry_run, true);
  assert.equal((await ads.list('owner')).campaigns.length, 0);
  const saved = await run('create_ad_from_brief', { ...base, campaign_id: 'ad-from-brief', destination: '555-0100' }, account);
  assert.equal(saved.saved, true);
  assert.equal(saved.spec_version, 2);
  assert.deepEqual(saved.notes, []);
  assert.equal((await run('ad', { campaign_id: 'ad-from-brief' }, account)).project.scenes.at(-1).params.destination, '555-0100');
  await assert.rejects(run('create_ad_from_brief', { ...base, campaign_id: 'ad-from-brief' }, account), (e) => e.status === 409); // never overwrites
  const auto = await run('create_ad_from_brief', base, account);
  assert.match(auto.campaign_id, /^ad-[0-9a-f]{8}$/);
  assert.throws(() => validateWorkspaceInput('create_ad_from_brief', { ...base, html: '<script>' }), /Unsupported field/);
});

test('MCP registry exposes create_nexus_ad_from_brief as a strict write tool', async () => {
  const { WORKSPACE_TOOLS } = await import('../lib/workspaceBoard.js');
  const tool = WORKSPACE_TOOLS.find(([name]) => name === 'create_nexus_ad_from_brief');
  assert.ok(tool);
  assert.equal(tool[1], 'create_ad_from_brief');
  assert.equal(tool[4], true);
  assert.ok(tool[3].request_id && tool[3].business_name && tool[3].industry && tool[3].goal);
  assert.equal(new Set(WORKSPACE_TOOLS.map(([n]) => n)).size, WORKSPACE_TOOLS.length);
});
