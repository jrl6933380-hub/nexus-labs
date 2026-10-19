import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { createAdMediaStore } from '../lib/adMedia.js';
import { createRenderJobStore } from '../lib/adRenderJobs.js';
import { workOnce } from '../lib/adRenderWorker.js';
import { createWorkspaceService, WORKSPACE_WRITES, WORKSPACE_ACTIONS } from '../lib/workspaceConnector.js';
import { WORKSPACE_TOOLS, registerWorkspaceBoard } from '../lib/workspaceBoard.js';
import { promoVideo } from '../lib/adMotionKit.js';

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const owner = { id: 'owner', workbenchUserId: 'w', scheduleUserId: 's' };
const other = { id: 'someone', workbenchUserId: 'w2', scheduleUserId: 's2' };

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

test('render tools are registered with the right write flags and connector fields', () => {
  const byName = Object.fromEntries(WORKSPACE_TOOLS.map((t) => [t[0], t]));
  for (const name of ['render_nexus_ad', 'cancel_nexus_render']) assert.equal(byName[name][4], true, name);
  for (const name of ['get_nexus_render', 'list_nexus_renders', 'download_nexus_render_chunk', 'plan_nexus_ad_evidence', 'view_nexus_ad_evidence']) assert.equal(byName[name][4], false, name);
  assert.ok(WORKSPACE_WRITES.has('render_ad') && WORKSPACE_WRITES.has('cancel_render'));
  assert.ok(!WORKSPACE_WRITES.has('render_status') && !WORKSPACE_WRITES.has('view_evidence'));
  assert.deepEqual(WORKSPACE_ACTIONS.cancel_render, ['job_id']);
});

test('ask an agent, get a file: queue a render, a worker finishes it, the agent downloads and views evidence', async () => {
  const { ads, media, renders } = stores();
  const run = createWorkspaceService({ ads, media, renders });
  const project = promoVideo({ brand: 'Nexus', hook: 'Hello world', cta: 'Go' });
  await run('save_ad_v2', { campaign_id: 'ad-r1', project }, owner);
  const plan = await run('evidence_plan', { campaign_id: 'ad-r1' }, owner);
  assert.equal(plan.coverage.cta, true);

  const mp4 = await run('render_ad', { campaign_id: 'ad-r1', kind: 'mp4', quality: 'preview' }, owner);
  const ev = await run('render_ad', { campaign_id: 'ad-r1', kind: 'evidence', max_frames: 8 }, owner);
  assert.equal(mp4.status, 'queued'); assert.equal(mp4.options.fps, 24);
  assert.equal((await run('renders', {}, other)).jobs.length, 0);
  await assert.rejects(run('render_status', { job_id: mp4.job_id }, other), /not found/);

  const runner = async ({ kind, onProgress }) => {
    await onProgress(1, 2, 'rendering');
    if (kind === 'mp4') return { files: [{ name: 'ad.mp4', buffer: Buffer.from('mp4-bytes') }], result: { frames: 2 } };
    return { files: [{ name: 'sheet.png', buffer: PNG }, { name: 'frame-01.png', buffer: PNG }], result: { coverage: { cta: true }, shots: [{ file: 'frame-01.png', t_ms: 500, label: 'hook: entrance', kind: 'enter', scene_id: 'hook', same_as_previous: false }] } };
  };
  await workOnce({ store: renders, workerId: 'w', runner }); await workOnce({ store: renders, workerId: 'w', runner });
  assert.equal((await run('render_status', { job_id: mp4.job_id }, owner)).status, 'succeeded');
  assert.equal((await run('get_render_chunk', { job_id: mp4.job_id, name: 'ad.mp4', index: 0 }, owner)).data_base64, Buffer.from('mp4-bytes').toString('base64'));

  const view = await run('view_evidence', { job_id: ev.job_id, frames: [1] }, owner);
  assert.equal(view.inline_images.length, 2); assert.equal(view.shots[0].label, 'hook: entrance');
  await assert.rejects(run('view_evidence', { job_id: ev.job_id, frames: [9] }, owner), /shot numbers/);
  await assert.rejects(run('view_evidence', { job_id: mp4.job_id }, owner), /not an evidence render/);
});

test('render_ad refuses legacy ads, missing audio and unknown images', async () => {
  const { ads, media, renders } = stores();
  const run = createWorkspaceService({ ads, media, renders });
  const project = promoVideo({ brand: 'Nexus', hook: 'Hello world', cta: 'Go' });
  await run('save_ad_v2', { campaign_id: 'ad-r2', project }, owner);
  await assert.rejects(run('render_ad', { campaign_id: 'ad-r2', kind: 'mp4', audio_media_id: 'med-nothere01' }, owner), /not found/);
  await assert.rejects(run('render_ad', { campaign_id: 'ad-r2', kind: 'mp4', fps: 48 }, owner), /fps/);
  const img = await media.save('owner', { name: 'p', data_base64: PNG.toString('base64') });
  await assert.rejects(run('render_ad', { campaign_id: 'ad-r2', kind: 'mp4', audio_media_id: img.media_id }, owner), /audio file/);
});

test('the board turns inline_images into real MCP image content and keeps them out of structured data', async () => {
  const tools = {};
  registerWorkspaceBoard({ registerResource() {}, registerTool: (name, _meta, handler) => { tools[name] = handler; } }, {
    authorize: async () => {},
    call: async () => ({ job_id: 'rnd-aaaaaa', shots: [], inline_images: [{ name: 'sheet.png', mime: 'image/png', data_base64: 'QUJD' }, { name: 'frame-01.png', label: '1. 0.50s hook', mime: 'image/png', data_base64: 'REVG' }] }),
  });
  const out = await tools.view_nexus_ad_evidence({ job_id: 'rnd-aaaaaa' });
  assert.equal(out.structuredContent.inline_images, undefined);
  assert.deepEqual(out.content.filter((c) => c.type === 'image').map((c) => [c.data, c.mimeType]), [['QUJD', 'image/png'], ['REVG', 'image/png']]);
  assert.ok(!out.content[0].text.includes('QUJD'), 'image bytes are not duplicated into the text');
  assert.ok(out.content.some((c) => c.text === '1. 0.50s hook'));
});
