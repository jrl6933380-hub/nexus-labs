import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentTasks, fixtureFor} from '../lib/nexusLabAgentTasks.js';
import {nexusLabService} from '../lib/nexusLabRuntime.js';

function memory() {
  const hashes = new Map();
  return async ([op, key, ...a]) => {
    if (op === 'HGET') return hashes.get(key)?.get(a[0]) ?? null;
    if (op === 'HVALS') return [...(hashes.get(key)?.values() || [])];
    if (op === 'HSET') { const h = hashes.get(key) || new Map(); for (let i = 0; i < a.length; i += 2) h.set(a[i], a[i + 1]); hashes.set(key, h); return 1; }
    if (op === 'HDEL') { a.forEach(f => hashes.get(key)?.delete(f)); return 1; }
    throw new Error('unexpected ' + op);
  };
}
const alice = {id: 'alice'};
const readMedia = async (owner, ids) => ids.map(id => ({asset_id: id, name: id + '.png', kind: 'image', mime: 'image/png', width: 64, height: 32, seconds: null, sha256: 'x', bytes: Buffer.from('PNGDATA')}));

test('real tasks store metadata only, and claim hands the AI the image bytes', async () => {
  const tasks = createAgentTasks({command: memory(), readMedia});
  const t = await tasks.createFromAssets(alice, {capability: 'detect', prompt: 'find the logo', asset_ids: ['med-aaaaaa']});
  assert.deepEqual(t.media.map(m => m.asset_id), ['med-aaaaaa']);
  assert.equal(JSON.stringify(t).includes('UE5HREFUQQ'), false);
  const c = await tasks.claim(alice, t.id);
  assert.equal(c.images[0].data_base64, Buffer.from('PNGDATA').toString('base64'));
  const done = await tasks.complete(alice, t.id, {claim_token: c.claim_token, output: {detections: [{asset_id: 'med-aaaaaa', label: 'logo', box: {x: .1, y: .1, w: .2, h: .2}}]}});
  assert.equal(done.status, 'done'); assert.equal(done.score, null);
  await assert.rejects(tasks.complete(alice, t.id, {claim_token: c.claim_token, output: {}}), {status: 409});
});
test('real tasks refuse bad asset choices; an unreadable image reopens the claim', async () => {
  const tasks = createAgentTasks({command: memory(), readMedia});
  await assert.rejects(tasks.createFromAssets(alice, {capability: 'cutout', prompt: 'x', asset_ids: []}), {status: 400});
  await assert.rejects(tasks.createFromAssets(alice, {capability: 'cutout', prompt: 'x', asset_ids: ['a', 'a']}), {status: 400});
  assert.equal((await tasks.createFromAssets(alice, {capability: 'video', prompt: 'ad plan'})).media.length, 0);
  let fail = false;
  const flaky = createAgentTasks({command: memory(), readMedia: async (o, ids) => { if (fail) throw Object.assign(new Error('gone'), {status: 502}); return readMedia(o, ids); }});
  const t = await flaky.createFromAssets(alice, {capability: 'detect', prompt: 'x', asset_ids: ['m1']});
  fail = true;
  await assert.rejects(flaky.claim(alice, t.id), {status: 502});
  fail = false;
  assert.equal((await flaky.claim(alice, t.id)).images.length, 1);
});
test('the four media capabilities never run a provider and stay not-ready until a self-test passes', async () => {
  for (const capability of ['understand', 'detect', 'cutout', 'video']) await assert.rejects(nexusLabService.run(alice, {capability, query: 'x'}), {status: 409});
  assert.ok(fixtureFor('s', 'video').truth);
});
