import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { createAdMediaStore } from '../lib/adMedia.js';
import { createWorkspaceService, WORKSPACE_WRITES, WORKSPACE_ACTIONS } from '../lib/workspaceConnector.js';
import { WORKSPACE_TOOLS } from '../lib/workspaceBoard.js';

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const owner = { id: 'owner', workbenchUserId: 'w', scheduleUserId: 's' };
const other = { id: 'someone', workbenchUserId: 'w2', scheduleUserId: 's2' };

function stores() {
  const hashes = new Map();
  let n = 0;
  const command = async ([op, ...a]) => {
    const h = hashes.get(a[0]) || new Map();
    if (op === 'HSET') { hashes.set(a[0], h); h.set(a[1], a[2]); return 1; }
    if (op === 'HGET') return h.get(a[1]) ?? null;
    if (op === 'HVALS') return [...h.values()];
    if (op === 'HLEN') return h.size;
    if (op === 'HEXISTS') return h.has(a[1]) ? 1 : 0;
    if (op === 'HDEL') return h.delete(a[1]) ? 1 : 0;
    if (op === 'DEL') return hashes.delete(a[0]) ? 1 : 0;
    if (op === 'EVAL') { const [, , key, id, previous, value] = a; const hh = hashes.get(key) || new Map(); if ((hh.get(id) || '') !== previous) return 0; hh.set(id, value); hashes.set(key, hh); return 1; }
    throw Error(op);
  };
  return {
    ads: createAdCampaignStore({ command, uuid: () => 'b' + ++n, now: () => 1 }),
    media: createAdMediaStore({ command, now: () => 1, newId: () => 'med-' + String(++n).padStart(6, '0') }),
  };
}

test('media tools are registered with the right write flags and connector fields', () => {
  const byName = Object.fromEntries(WORKSPACE_TOOLS.map((t) => [t[0], t]));
  assert.equal(byName.list_nexus_media[4], false);
  assert.equal(byName.get_nexus_media_chunk[4], false);
  for (const name of ['begin_nexus_media', 'put_nexus_media_chunk', 'finish_nexus_media', 'save_nexus_media', 'delete_nexus_media']) assert.equal(byName[name][4], true, name);
  for (const action of ['begin_media', 'put_media_chunk', 'finish_media', 'save_media', 'delete_media']) assert.ok(WORKSPACE_WRITES.has(action));
  for (const action of ['media', 'read_media', 'get_media_chunk']) assert.ok(!WORKSPACE_WRITES.has(action));
  assert.deepEqual(WORKSPACE_ACTIONS.put_media_chunk, ['media_id', 'index', 'data_base64']);
});

test('an original saved through the connector can be a graphic layer image and resolves for preview', async () => {
  const { ads, media } = stores();
  let seen;
  const run = createWorkspaceService({ ads, media, preview: async (record, pictures) => { seen = pictures; return '<html></html>'; } });
  const saved = await run('save_media', { name: 'Hero', data_base64: PNG_B64 }, owner);
  assert.equal(saved.status, 'ready');
  assert.equal((await run('media', {}, other)).media.length, 0, 'libraries are per account');
  const project = { specVersion: 2, name: 'm', mood: 'bold', palette: 'ocean-blue', platform: { format: 'portrait', lengthSec: 15 }, scenes: [
    { id: 'g', type: 'graphic', duration: 3, background: 'gradient', params: { layers: [{ shape: 'image', x: 50, y: 50, w: 40, imageId: saved.media_id }] } },
    { id: 'end', type: 'end_card', duration: 2.6, params: { cta: 'Go' } }] };
  const ad = await run('save_ad_v2', { campaign_id: 'ad-media1', project }, owner);
  assert.ok(ad.campaign_id || ad.saved !== false);
  await run('open_ad', { campaign_id: 'ad-media1' }, owner);
  assert.equal(seen[saved.media_id].original, true);
  assert.equal(seen[saved.media_id].src, 'data:image/png;base64,' + PNG_B64);
  project.scenes[0].params.layers[0].imageId = 'med-doesnotex1';
  await assert.rejects(run('save_ad_v2', { campaign_id: 'ad-media2', project }, owner), /not found in your library: med-doesnotex1/);
});

test('chunked upload and download through the connector', async () => {
  const { ads, media } = stores();
  const run = createWorkspaceService({ ads, media });
  const buf = Buffer.from(PNG_B64, 'base64');
  const b = await run('begin_media', { name: 'Pic', kind: 'image', bytes: buf.length, sha256: createHash('sha256').update(buf).digest('hex') }, owner);
  await run('put_media_chunk', { media_id: b.media_id, index: 0, data_base64: PNG_B64 }, owner);
  assert.equal((await run('finish_media', { media_id: b.media_id }, owner)).status, 'ready');
  const c = await run('get_media_chunk', { media_id: b.media_id, index: 0 }, owner);
  assert.equal(c.data_base64, PNG_B64);
  await assert.rejects(run('get_media_chunk', { media_id: b.media_id, index: 0 }, other), /not found/);
  assert.equal((await run('delete_media', { media_id: b.media_id }, owner)).deleted, true);
});
