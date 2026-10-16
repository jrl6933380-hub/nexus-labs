import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { renderAdPreview } from '../lib/adPreview.js';
import { freshPreset } from '../public/ad-maker-model.mjs';

function setup() {
  const hashes = new Map();
  let n = 0;
  const command = async ([op, ...args]) => {
    if (op === 'HGET') return hashes.get(args[0])?.get(args[1]) || null;
    if (op === 'HVALS') return [...(hashes.get(args[0]) || new Map()).values()];
    if (op === 'EVAL') {
      const [, , key, id, previous, value] = args;
      const hash = hashes.get(key) || new Map();
      if ((hash.get(id) || '') !== previous) return 0;
      if (!previous && hash.size >= 100) return -1;
      hash.set(id, value);
      hashes.set(key, hash);
      return 1;
    }
    throw Error(op);
  };
  return createAdCampaignStore({ command, uuid: () => String(++n), now: () => 123 });
}

const v2 = () => ({
  specVersion: 2,
  name: "Pat's Plumbing",
  brand: "PAT'S PLUMBING",
  initial: 'P',
  mood: 'bold',
  palette: 'midnight-gold',
  platform: { format: 'portrait', lengthSec: 15 },
  tags: { industry: 'plumber', goal: 'call' },
  concept: true,
  scenes: [
    { id: 's1', type: 'hook_text', duration: 3, params: { headline: 'Burst pipe at 2am?', support: 'We answer.' }, camera: 'push_in', background: 'grain', transitionOut: 'wipe_left' },
    { id: 's2', type: 'site_mockup', duration: 4, params: { siteName: "Pat's Plumbing", headline: 'Fast local help', cta: 'Call now' } },
    { id: 's3', type: 'end_card', duration: 4, params: { cta: 'Call now', destination: '555-0100' } },
  ],
});

test('vocabulary ads save, read and list through the same store, isolated per account', async () => {
  const store = setup();
  const saved = await store.save('alice', { campaign_id: 'pat', project: v2() });
  assert.equal(saved.saved, true);
  assert.equal(saved.format, 'portrait');
  assert.equal(saved.duration, 11);
  assert.equal(saved.spec_version, 2);
  assert.equal(saved.renderer, 'vocabulary-player');
  const read = await store.read('alice', 'pat');
  assert.equal(read.project.specVersion, 2);
  assert.equal(read.project.scenes.length, 3);
  assert.equal(read.design, null);
  const list = await store.list('alice');
  assert.equal(list.campaigns[0].spec_version, 2);
  assert.deepEqual(await store.list('bob'), { campaigns: [] });
  await assert.rejects(store.read('bob', 'pat'), (e) => e.status === 404);
});

test('legacy ads keep exactly their old summary shape', async () => {
  const store = setup();
  const saved = await store.save('a', { campaign_id: 'old', project: freshPreset() });
  assert.equal('spec_version' in saved, false);
  assert.equal('renderer' in saved, false);
  assert.equal(saved.format, 'portrait');
  assert.equal(saved.duration, freshPreset().scenes.reduce((n, s) => n + s.duration, 0));
});

test('invalid vocabulary ads are rejected with a clear message and nothing is stored', async () => {
  const store = setup();
  for (const mutate of [
    (p) => { p.mood = 'neon'; },
    (p) => { p.scenes[0].type = 'confetti'; },
    (p) => { p.scenes[0].params.headline = 'x'.repeat(61); },
    (p) => { p.scenes[0].html = '<script>alert(1)</script>'; },
    (p) => { p.scenes.length = 1; },
    (p) => { p.extra = true; },
  ]) {
    const p = v2();
    mutate(p);
    await assert.rejects(store.save('a', { campaign_id: 'bad', project: p }), (e) => e.status === 400 && /vocabulary/i.test(e.message));
  }
  assert.equal((await store.list('a')).campaigns.length, 0);
});

test('vocabulary ads use the same stale-write protection', async () => {
  const store = setup();
  const first = await store.save('a', { campaign_id: 'ad', project: v2() });
  const input = { campaign_id: 'ad', baseline: first.baseline, project: { ...v2(), name: 'Edited' } };
  const results = await Promise.allSettled([store.save('a', input), store.save('a', input)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  await assert.rejects(store.save('a', { campaign_id: 'ad', project: v2() }), (e) => e.status === 409);
});

test('an existing ad cannot be silently converted between formats', async () => {
  const store = setup();
  const legacy = await store.save('a', { campaign_id: 'x', project: freshPreset() });
  await assert.rejects(store.save('a', { campaign_id: 'x', baseline: legacy.baseline, project: v2() }), (e) => e.status === 400 && /different format/.test(e.message));
  const modern = await store.save('a', { campaign_id: 'y', project: v2() });
  await assert.rejects(store.save('a', { campaign_id: 'y', baseline: modern.baseline, project: freshPreset() }), (e) => e.status === 400 && /different format/.test(e.message));
  assert.equal((await store.read('a', 'x')).project.specVersion, undefined);
  assert.equal((await store.read('a', 'y')).project.specVersion, 2);
});

test('custom creative code cannot be attached to a vocabulary ad yet', async () => {
  const store = setup();
  const ad = await store.save('a', { campaign_id: 'v', project: v2() });
  const design = { name: 'Mine', html: '<!doctype html><html><script>window.renderAdFrame=()=>{}</script></html>' };
  await assert.rejects(store.saveDesign('a', { campaign_id: 'v', baseline: ad.baseline, design }), (e) => e.status === 400 && /stock vocabulary player/.test(e.message));
  const legacy = await store.save('a', { campaign_id: 'l', project: freshPreset() });
  assert.equal((await store.saveDesign('a', { campaign_id: 'l', baseline: legacy.baseline, design })).design.name, 'Mine');
});

test('vocabulary preview renders the stock player with inert, escaped project data', async () => {
  const project = v2();
  project.name = '</script><script>attack()</script>';
  const html = await renderAdPreview({ campaign_id: 'v', project });
  assert.match(html, /id="ad-project" type="application\/json"/);
  assert.doesNotMatch(html, /<\/script><script>attack\(\)/);
  assert.match(html, /window\.renderAdFrame=/);
  assert.doesNotMatch(html, /https?:\/\//);
  const data = html.match(/<script id="ad-project" type="application\/json">(.*?)<\/script>/s)[1];
  assert.equal(JSON.parse(data).name, project.name);
});

test('legacy preview still uses the original studio page', async () => {
  const html = await renderAdPreview({ campaign_id: 'l', project: freshPreset() });
  assert.match(html, /id="ad-context"/);
  assert.doesNotMatch(html, /Nexus vocabulary player/);
});

test('browser API accepts a vocabulary ad through the existing save action', async () => {
  const { createAdCampaignHandler } = await import('../api/ad-campaigns.js');
  const store = setup();
  const handler = createAdCampaignHandler({ store, resolveAccount: async () => ({ id: 'alice' }), once: async (_u, _i, _a, _in, run) => run() });
  const res = { setHeader() {}, status(c) { this.code = c; return this; }, json(d) { this.data = d; return this; } };
  const req = { method: 'POST', headers: { host: 'n.example', origin: 'https://n.example', 'content-type': 'application/json' }, body: { action: 'save', input: { campaign_id: 'pat', project: v2() }, request_id: 'req-12345678' } };
  await handler(req, res);
  assert.equal(res.code, 200);
  assert.equal(res.data.data.spec_version, 2);
});
