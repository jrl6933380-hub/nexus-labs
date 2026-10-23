import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokPlanStore } from '../lib/tiktokPlans.js';

// A tiny in-memory command() that understands HGET/HVALS and the two Lua scripts.
function memory() {
  const hashes = new Map();
  const h = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };
  return async (parts) => {
    const [cmd, key, ...rest] = parts;
    if (cmd === 'HGET') return h(key).get(rest[0]) ?? null;
    if (cmd === 'HVALS') return [...h(key).values()];
    if (cmd === 'EVAL') {
      const [script, , k, field, old, next, limit] = [parts[1], parts[2], parts[3], parts[4], parts[5], parts[6], parts[7]];
      const map = h(k);
      if (script.includes('delete-cas')) { const cur = map.get(field); if (cur === undefined || cur !== old) return 0; map.delete(field); return 1; }
      const cur = map.get(field) ?? '';
      if (cur !== old) return 0;
      if (cur === '' && map.size >= Number(limit)) return -1;
      map.set(field, next); return 1;
    }
    throw new Error('unexpected ' + cmd);
  };
}
function setup() {
  let n = 0, t = 1000;
  const saved = [];
  const ads = { async save(user, input) { saved.push({ user, ...input }); return { campaign_id: input.campaign_id, name: 'Ad', duration: 15, format: 'portrait', studio_url: '/ad-maker.html?ad=' + input.campaign_id }; } };
  const store = createTikTokPlanStore({ command: memory(), now: () => ++t, uuid: () => 'b' + (++n), ads });
  return { store, saved };
}
const brief = { business_name: 'Sole Exchange', industry: 'retail', goal: 'visit' };

test('campaign and video lifecycle with baselines', async () => {
  const { store } = setup();
  const c = await store.saveCampaign('u', { id: 'c1', campaign: { name: 'Launch' } });
  assert.equal(c.name, 'Launch');
  await assert.rejects(() => store.saveCampaign('u', { id: 'c1', campaign: { name: 'x' } }), /changed|fresh/);
  const v = await store.saveVideo('u', { id: 'v1', video: { campaign_id: 'c1', title: 'First' } });
  assert.equal(v.status, 'idea');
  const v2 = await store.saveVideo('u', { id: 'v1', baseline: v.baseline, video: { campaign_id: 'c1', title: 'First', status: 'scripted', hook: 'Hi' } });
  assert.notEqual(v2.baseline, v.baseline);
  await assert.rejects(() => store.saveVideo('u', { id: 'v1', baseline: v.baseline, video: { campaign_id: 'c1', title: 'stale' } }), /changed/);
  const all = await store.overview('u');
  assert.equal(all.campaigns.length, 1);
  assert.equal(all.videos[0].status, 'scripted');
  await assert.rejects(() => store.saveVideo('u', { id: 'v9', video: { campaign_id: 'nope', title: 'x' } }), /campaign/i);
});

test('posting rules protect what the poster relies on', async () => {
  const { store } = setup();
  await store.saveCampaign('u', { id: 'c1', campaign: { name: 'L' } });
  const base = { campaign_id: 'c1', title: 'T' };
  await assert.rejects(() => store.saveVideo('u', { id: 'a', video: { ...base, status: 'ready' } }), /caption/);
  await assert.rejects(() => store.saveVideo('u', { id: 'a', video: { ...base, status: 'scheduled', caption: 'c' } }), /date/);
  await assert.rejects(() => store.saveVideo('u', { id: 'a', video: { ...base, status: 'posted', caption: 'c' } }), /URL/);
  const ok = await store.saveVideo('u', { id: 'a', video: { ...base, status: 'posted', caption: 'c', post_url: 'https://www.tiktok.com/@x/video/1' } });
  assert.equal(ok.status, 'posted');
  await assert.rejects(() => store.saveVideo('u', { id: 'b', video: { ...base, scope: { ready: true, brief: null } } }), /brief/);
});

test('accounts are isolated and deletes need the baseline', async () => {
  const { store } = setup();
  await store.saveCampaign('u1', { id: 'c1', campaign: { name: 'Mine' } });
  assert.equal((await store.overview('u2')).campaigns.length, 0);
  const v = await store.saveVideo('u1', { id: 'v1', video: { campaign_id: 'c1', title: 'x' } });
  const cb = (await store.overview('u1')).campaigns[0].baseline;
  await assert.rejects(() => store.deleteCampaign('u1', { id: 'c1', baseline: cb }), /videos first/);
  await assert.rejects(() => store.deleteVideo('u1', { id: 'v1', baseline: 'wrong' }), /changed/);
  assert.equal((await store.deleteVideo('u1', { id: 'v1', baseline: v.baseline })).deleted, true);
  assert.equal((await store.deleteCampaign('u1', { id: 'c1', baseline: cb })).deleted, true);
});

test('scoped ad: scope read, build with the real composer, link, no duplicate', async () => {
  const { store, saved } = setup();
  await store.saveCampaign('u', { id: 'c1', campaign: { name: 'L', goal: 'Get calls' } });
  await store.saveVideo('u', { id: 'v1', video: { campaign_id: 'c1', title: 'Sole', hook: 'Hook', scope: { ready: false, brief } } });
  const unscoped = await store.scope('u', { video_id: 'v1' });
  assert.equal(unscoped.scoped, false);
  await assert.rejects(() => store.buildAd('u', { video_id: 'v1' }), /Scope/);
  const cur = (await store.overview('u')).videos[0];
  await store.saveVideo('u', { id: 'v1', baseline: cur.baseline, video: { ...cur, scope: { ready: true, brief } } });
  const scoped = await store.scope('u', { video_id: 'v1' });
  assert.equal(scoped.scoped, true);
  assert.equal(scoped.brief.business_name, 'Sole Exchange');
  assert.equal(scoped.campaign.goal, 'Get calls');
  const built = await store.buildAd('u', { video_id: 'v1' });
  assert.equal(built.ad_campaign_id, 'tt-v1');
  assert.equal(saved[0].campaign_id, 'tt-v1');
  assert.equal(saved[0].project.platform?.format ?? saved[0].project.format, 'portrait');
  assert.equal((await store.scope('u', { video_id: 'v1' })).studio_url, '/ad-maker.html?ad=tt-v1');
  await assert.rejects(() => store.buildAd('u', { video_id: 'v1' }), /already has an ad/);
});
