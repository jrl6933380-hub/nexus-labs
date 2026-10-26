import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokPlanStore } from '../lib/tiktokPlans.js';

// Same tiny in-memory command() as tiktok-plans.test.mjs.
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
  return createTikTokPlanStore({ command: memory(), now: () => ++t, uuid: () => 'b' + (++n) });
}
async function withCampaign(store) {
  await store.saveCampaign('u', { id: 'c1', campaign: { name: 'Feed' } });
}

test('a video defaults to tiktok and can be saved per platform for the same ad', async () => {
  const store = setup(); await withCampaign(store);
  const a = await store.saveVideo('u', { id: 'ad-1-tiktok', video: { campaign_id: 'c1', title: 'Ad', ad_campaign_id: 'ad1' } });
  assert.equal(a.platform, 'tiktok');
  const b = await store.saveVideo('u', { id: 'ad-1-instagram', video: { campaign_id: 'c1', title: 'Ad', platform: 'instagram', ad_campaign_id: 'ad1' } });
  assert.equal(b.platform, 'instagram');
  const { videos } = await store.overview('u');
  assert.deepEqual(videos.map((v) => v.platform).sort(), ['instagram', 'tiktok']);
  await assert.rejects(store.saveVideo('u', { id: 'x', video: { campaign_id: 'c1', title: 'Ad', platform: 'myspace' } }));
});

test('posted needs a live link; claimed_by round-trips and clears', async () => {
  const store = setup(); await withCampaign(store);
  const v = await store.saveVideo('u', { id: 'v1', video: { campaign_id: 'c1', title: 'Ad', status: 'ready', caption: 'hi', claimed_by: 'chatgpt' } });
  assert.equal(v.claimed_by, 'chatgpt');
  await assert.rejects(store.saveVideo('u', { id: 'v1', baseline: v.baseline, video: { campaign_id: 'c1', title: 'Ad', status: 'posted', caption: 'hi' } }), /live post URL/);
  const done = await store.saveVideo('u', { id: 'v1', baseline: v.baseline, video: { campaign_id: 'c1', title: 'Ad', status: 'posted', caption: 'hi', post_url: 'https://www.tiktok.com/@x/video/1', claimed_by: '' } });
  assert.equal(done.status, 'posted');
  assert.equal(done.claimed_by, '');
});

test('social accounts hold a handle and link only, update with a baseline, and stay out of campaigns and videos', async () => {
  const store = setup(); await withCampaign(store);
  const a = await store.saveAccount('u', { account: { platform: 'tiktok', handle: '@nexus', profile_url: 'https://www.tiktok.com/@nexus' } });
  assert.equal(a.id, 'acct-tiktok');
  await assert.rejects(store.saveAccount('u', { account: { platform: 'tiktok', handle: '@other' } }), /changed somewhere else|fresh id/);
  const b = await store.saveAccount('u', { baseline: a.baseline, account: { platform: 'tiktok', handle: '@nexus2', profile_url: '' } });
  assert.equal(b.handle, '@nexus2');
  await assert.rejects(store.saveAccount('u', { account: { platform: 'facebook', password: 'nope' } }), /Unrecognized|password/i);
  await assert.rejects(store.saveAccount('u', { account: { platform: 'facebook', profile_url: 'javascript:alert(1)' } }));
  const o = await store.overview('u');
  assert.equal(o.accounts.length, 1);
  assert.equal(o.campaigns.length, 1);
  assert.equal(o.videos.length, 0);
  assert.equal((await store.overview('someone-else')).accounts.length, 0);
});
