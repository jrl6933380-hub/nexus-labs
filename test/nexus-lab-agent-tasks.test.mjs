import test from 'node:test';
import assert from 'node:assert/strict';
import {createAgentTasks, fixtureFor, scoreOutput, detectOutput, cutoutOutput, videoOutput, makePng, PASS_SCORE} from '../lib/nexusLabAgentTasks.js';
const alice = {id: 'alice'}, bob = {id: 'bob'};
function memory() {
  const hashes = new Map();
  return async ([op, key, ...a]) => {
    if (op === 'HGET') return hashes.get(key)?.get(a[0]) ?? null;
    if (op === 'HVALS') return [...(hashes.get(key)?.values() || [])];
    if (op === 'HSET') { const h = hashes.get(key) || new Map(); for (let i = 0; i < a.length; i += 2) h.set(a[i], a[i + 1]); hashes.set(key, h); return 1; }
    if (op === 'HDEL') { const h = hashes.get(key); a.forEach(f => h?.delete(f)); return 1; }
    throw Error('unsupported ' + op);
  };
}
const media = [{asset_id: 'img1', kind: 'image', width: 100, height: 100}];
test('makePng produces a valid PNG header', () => {
  const png = makePng(8, 8, []); assert.equal(png.subarray(1, 4).toString(), 'PNG'); assert.ok(png.length > 40);
});
test('detect validator keeps boxes inside the image and rejects the rest', () => {
  const ok = detectOutput({detections: [{asset_id: 'img1', label: 'cat', box: {x: .1, y: .1, w: .5, h: .5}}]}, media);
  assert.equal(ok.detections.length, 1);
  for (const box of [{x: .8, y: 0, w: .5, h: .5}, {x: 0, y: 0, w: 0, h: .5}, {x: -1, y: 0, w: .2, h: .2}, {x: 'a', y: 0, w: .2, h: .2}])
    assert.throws(() => detectOutput({detections: [{asset_id: 'img1', label: 'x', box}]}, media), {status: 422});
  assert.throws(() => detectOutput({detections: [{asset_id: 'other', label: 'x', box: {x: 0, y: 0, w: .1, h: .1}}]}, media), {status: 422});
});
test('cutout and video validators', () => {
  assert.throws(() => cutoutOutput({cutouts: [{asset_id: 'img1', label: 'a', polygon: [[0, 0], [1, 1], [.5, .5]]}]}, media), {status: 422});
  assert.throws(() => cutoutOutput({cutouts: [{asset_id: 'img1', label: 'a', polygon: [[0, 0], [2, 1], [.5, .5]]}]}, media), {status: 422});
  assert.equal(cutoutOutput({cutouts: [{asset_id: 'img1', label: 'a', polygon: [[0, 0], [1, 0], [1, 1]]}]}, media).cutouts[0].area, .5);
  assert.throws(() => videoOutput({scenes: [{seconds: 20, text: 'x'}]}, media), {status: 422});
  assert.equal(videoOutput({scenes: [{seconds: 3, text: 'a'}, {seconds: 4, text: 'b', asset_id: 'img1'}]}, media).total_seconds, 7);
});
test('scoring: perfect answers score 1, empty or wrong answers score low', () => {
  const f = fixtureFor('seed-1', 'detect');
  const perfect = {detections: f.truth.boxes.map(t => ({label: t.label + ' rectangle', box: t.box}))};
  assert.ok(scoreOutput('detect', perfect, f.truth) > .99);
  assert.equal(scoreOutput('detect', {detections: []}, f.truth), 0);
  const shifted = {detections: f.truth.boxes.map(t => ({label: t.label, box: {...t.box, x: Math.min(.9, t.box.x + .5), w: .05, h: .05}}))};
  assert.ok(scoreOutput('detect', shifted, f.truth) < .2);
  const cut = fixtureFor('seed-1', 'cutout');
  const polys = {cutouts: cut.truth.boxes.map(t => ({label: t.label, polygon: [[t.box.x, t.box.y], [t.box.x + t.box.w, t.box.y], [t.box.x + t.box.w, t.box.y + t.box.h], [t.box.x, t.box.y + t.box.h]]}))};
  assert.ok(scoreOutput('cutout', polys, cut.truth) > .95);
  const u = fixtureFor('seed-1', 'understand');
  assert.equal(scoreOutput('understand', {summary: 'a ' + u.truth.terms.join(' and '), observations: []}, u.truth), 1);
});
test('fixtures are deterministic and image-backed', () => {
  assert.deepEqual(fixtureFor('a', 'detect').truth, fixtureFor('a', 'detect').truth);
  assert.notDeepEqual(fixtureFor('a', 'detect').truth, fixtureFor('zzz', 'detect').truth);
  assert.ok(fixtureFor('a', 'detect').png.length > 100);
});
test('lifecycle: create, claim once, complete with token, selftest sets readiness', async () => {
  const tasks = createAgentTasks({command: memory(), now: () => 1000});
  const t = await tasks.createSelfTest(alice, 'detect');
  assert.equal(t.status, 'open'); assert.equal(t.truth, undefined); assert.equal(t.png_b64, undefined);
  const c = await tasks.claim(alice, t.id);
  assert.ok(c.image_png_base64.length > 100); assert.ok(c.claim_token);
  await assert.rejects(tasks.claim(alice, t.id), {status: 409});
  await assert.rejects(tasks.complete(alice, t.id, {claim_token: 'wrong', output: {}}), {status: 409});
  await assert.rejects(tasks.complete(alice, t.id, {claim_token: c.claim_token, output: {detections: 'no'}}), {status: 422});
  const truth = fixtureFor(t.id, 'detect').truth;
  const done = await tasks.complete(alice, t.id, {claim_token: c.claim_token, output: {detections: truth.boxes.map(b => ({asset_id: 'fixture-image', label: b.label, box: b.box}))}});
  assert.equal(done.status, 'done'); assert.ok(done.score > .99); assert.equal(done.truth, undefined);
  const r = await tasks.readiness(alice);
  assert.equal(r.detect.passed, true); assert.ok(r.detect.best_score >= PASS_SCORE);
  assert.deepEqual(await tasks.readiness(bob), {});
});
test('a failing self-test does not mark the capability ready; owners are isolated; leases expire', async () => {
  let clock = 0; const command = memory(), tasks = createAgentTasks({command, now: () => clock});
  const t = await tasks.createSelfTest(alice, 'cutout');
  const c = await tasks.claim(alice, t.id);
  const bad = await tasks.complete(alice, t.id, {claim_token: c.claim_token, output: {cutouts: [{asset_id: 'fixture-image', label: 'red', polygon: [[0, 0], [.05, 0], [.05, .05]]}]}});
  assert.ok(bad.score < PASS_SCORE); assert.equal((await tasks.readiness(alice)).cutout.passed, false);
  await assert.rejects(tasks.claim(bob, t.id), {status: 404});
  const t2 = await tasks.createSelfTest(alice, 'understand');
  await tasks.claim(alice, t2.id); clock = 11 * 60 * 1000;
  assert.equal((await tasks.list(alice, {status: 'open'})).some(x => x.id === t2.id), true);
  await tasks.claim(alice, t2.id);
});
test('real (non-selftest) tasks carry no score and never touch readiness', async () => {
  const tasks = createAgentTasks({command: memory()});
  const t = await tasks.create(alice, {capability: 'video', prompt: 'plan an ad', media: []});
  const c = await tasks.claim(alice, t.id);
  const done = await tasks.complete(alice, t.id, {claim_token: c.claim_token, output: {scenes: [{seconds: 4, text: 'Hello'}]}});
  assert.equal(done.score, null); assert.deepEqual(await tasks.readiness(alice), {});
  await assert.rejects(tasks.create(alice, {capability: 'bogus', prompt: 'x'}), {status: 400});
});
