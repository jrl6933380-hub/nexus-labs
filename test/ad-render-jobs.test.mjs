import test from 'node:test';
import assert from 'node:assert/strict';
import { createRenderJobStore, normalizeRenderOptions, JOB_LIMITS } from '../lib/adRenderJobs.js';
import { runJob, workOnce } from '../lib/adRenderWorker.js';
import { promoVideo } from '../lib/adMotionKit.js';

const fake = () => {
  const h = new Map(), kv = new Map();
  const command = async (parts) => {
    const [op, key, ...r] = parts; const m = h.get(key) || new Map();
    switch (op) {
      case 'HSET': h.set(key, m); m.set(r[0], r[1]); return 1;
      case 'HSETNX': h.set(key, m); if (m.has(r[0])) return 0; m.set(r[0], r[1]); return 1;
      case 'HGET': return m.get(r[0]) ?? null;
      case 'HVALS': return [...m.values()];
      case 'HGETALL': return [...m.entries()].flat();
      case 'HDEL': return m.delete(r[0]) ? 1 : 0;
      case 'DEL': h.delete(key); return kv.delete(key) ? 1 : 0;
      case 'SET': kv.set(key, r[0]); return 'OK';
      case 'GET': return kv.get(key) ?? null;
      case 'EXPIRE': return 1;
      default: throw new Error('unexpected ' + op);
    }
  };
  return { command };
};
const make = () => { const f = fake(); let n = 0, t = 1000; const clock = { t: () => t, set: (v) => { t = v; } };
  return { clock, store: createRenderJobStore({ command: f.command, now: () => t, newId: () => 'rnd-' + String(++n).padStart(6, '0') }) }; };
const project = () => promoVideo({ brand: 'Nexus', hook: 'Hello world', cta: 'Go' });

test('a job that waited longer than the queue limit is expired, not rendered', async () => {
  const { store, clock } = make();
  const stale = await store.create('u', { kind: 'still', project: project(), options: {} });
  clock.set(1000 + (JOB_LIMITS.queueMaxAgeSec + 1) * 1000);
  const fresh = await store.create('u', { kind: 'still', project: project(), options: {} });
  const claimed = await store.claim('w');
  assert.equal(claimed.job.job_id, fresh.job_id);
  const old = await store.get('u', stale.job_id);
  assert.equal(old.status, 'failed'); assert.equal(old.error.code, 'QUEUE_EXPIRED');
  assert.equal(await store.claim('w2'), null);
});

test('options are normalised per kind and bad ones refused', () => {
  assert.deepEqual(normalizeRenderOptions('mp4', { quality: 'preview' }), { quality: 'preview', fps: 24, scale: 1, crf: 28 });
  assert.equal(normalizeRenderOptions('mp4', {}).fps, 30);
  assert.throws(() => normalizeRenderOptions('mp4', { fps: 48 }), /fps/);
  assert.throws(() => normalizeRenderOptions('still', { at: 1, scene: 'x' }), /not both/);
  assert.equal(normalizeRenderOptions('evidence', {}).max_frames, 32);
  assert.throws(() => normalizeRenderOptions('evidence', { max_frames: 3 }), /max_frames/);
  assert.throws(() => normalizeRenderOptions('gif', {}), /kind must/);
});

test('a job runs from queued to succeeded with progress and downloadable chunks', async () => {
  const { store } = make();
  const created = await store.create('justin', { kind: 'mp4', campaign_id: 'ad-1', project: project(), options: { quality: 'preview' } });
  assert.equal(created.status, 'queued');
  const mp4 = Buffer.alloc(JOB_LIMITS.chunkBytes + 500, 9);
  const seen = [];
  const done = await workOnce({ store, workerId: 'w1', runner: async ({ onProgress, options }) => {
    assert.equal(options.fps, 24);
    await onProgress(5, 10, 'rendering'); seen.push((await store.get('justin', created.job_id)).progress.pct);
    return { files: [{ name: 'ad.mp4', buffer: mp4 }], result: { frames: 10 } };
  } });
  assert.equal(done.status, 'succeeded'); assert.equal(seen[0], 50); assert.equal(done.files[0].chunks, 2);
  const c0 = await store.chunk('justin', created.job_id, 'ad.mp4', 0), c1 = await store.chunk('justin', created.job_id, 'ad.mp4', 1);
  assert.ok(Buffer.concat([Buffer.from(c0.data_base64, 'base64'), Buffer.from(c1.data_base64, 'base64')]).equals(mp4));
  assert.equal(await workOnce({ store, workerId: 'w1', runner: async () => { throw new Error('no'); } }), null, 'queue is empty');
  await assert.rejects(store.chunk('someone', created.job_id, 'ad.mp4', 0), /not found/);
});

test('two workers never take the same job', async () => {
  const { store } = make();
  await store.create('a', { kind: 'still', project: project(), options: {} });
  const [x, y] = await Promise.all([store.claim('w1'), store.claim('w2')]);
  assert.equal([x, y].filter(Boolean).length, 1);
});

test('failures carry a code, message and details; a renderer error does not hang the job', async () => {
  const { store } = make();
  const j = await store.create('u', { kind: 'mp4', project: project(), options: {} });
  const out = await workOnce({ store, workerId: 'w', runner: async () => { throw Object.assign(new Error('ffmpeg exited 1'), { code: 'FFMPEG_FAILED', details: 'Invalid data found' }); } });
  assert.equal(out.status, 'failed'); assert.equal(out.error.code, 'FFMPEG_FAILED'); assert.match(out.error.details, /Invalid data/);
  assert.equal((await store.get('u', j.job_id)).active, false);
});

test('missing images fail the job before any rendering', async () => {
  const { store } = make();
  const p = project(); p.scenes[0].params.layers.push({ shape: 'image', x: 50, y: 50, w: 20, imageId: 'med-gone00001' });
  await store.create('u', { kind: 'mp4', project: p, options: {} });
  let ran = false;
  const out = await workOnce({ store, workerId: 'w', runner: async () => { ran = true; return { files: [] }; }, resolveImages: async () => ({ images: {}, missing: ['med-gone00001'] }) });
  assert.equal(out.error.code, 'MISSING_IMAGES'); assert.equal(ran, false);
});

test('cancel: a queued job cancels at once; a running job is stopped at its next progress report', async () => {
  const { store } = make();
  const q = await store.create('u', { kind: 'mp4', project: project(), options: {} });
  assert.equal((await store.cancel('u', q.job_id)).status, 'canceled');
  assert.equal(await store.claim('w'), null, 'canceled job is not claimed');
  const r = await store.create('u', { kind: 'mp4', project: project(), options: {} });
  let killed = false;
  const out = await workOnce({ store, workerId: 'w', runner: async ({ onProgress, signal }) => {
    signal.addEventListener('abort', () => { killed = true; });
    await store.cancel('u', r.job_id);
    await onProgress(1, 10);
    return { files: [{ name: 'x.mp4', buffer: Buffer.from('x') }] };
  } });
  assert.equal(killed, true); assert.equal(out.status, 'canceled');
  await assert.rejects(store.cancel('u', r.job_id), /already canceled/);
});

test('a worker that goes silent is failed as WORKER_LOST; per-account limits hold', async () => {
  const { store, clock } = make();
  const j = await store.create('u', { kind: 'mp4', project: project(), options: {} });
  await store.claim('w');
  clock.set(1000 + (JOB_LIMITS.staleSec + 5) * 1000);
  const after = await store.get('u', j.job_id);
  assert.equal(after.status, 'failed'); assert.equal(after.error.code, 'WORKER_LOST');
  for (let i = 0; i < JOB_LIMITS.maxActive; i++) await store.create('u', { kind: 'still', project: project(), options: {} });
  await assert.rejects(store.create('u', { kind: 'still', project: project(), options: {} }), /in progress/);
});
