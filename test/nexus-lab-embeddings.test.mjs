import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmbeddingIndex, BUILD_MAX} from '../lib/nexusLabEmbeddings.js';
import {createNexusLab} from '../lib/nexusLab.js';
import {createNexusLabHandler} from '../api/nexus-lab.js';
const alice = {id: 'alice'}, bob = {id: 'bob'};
function memory() {
  const hashes = new Map(), lists = new Map();
  const fn = async ([op, key, ...a]) => {
    if (op === 'HVALS') return [...(hashes.get(key)?.values() || [])];
    if (op === 'HSET') { const h = hashes.get(key) || new Map(); for (let i = 0; i < a.length; i += 2) h.set(a[i], a[i + 1]); hashes.set(key, h); return a.length / 2; }
    if (op === 'HDEL') { const h = hashes.get(key); let n = 0; for (const f of a) if (h?.delete(f)) n++; return n; }
    if (op === 'LRANGE') return (lists.get(key) || []).slice(Number(a[0]), Number(a[1]) + 1);
    if (op === 'LPUSH') { lists.set(key, [a[0], ...(lists.get(key) || [])]); return 1; }
    if (op === 'LTRIM') { lists.set(key, (lists.get(key) || []).slice(0, Number(a[1]) + 1)); return 'OK'; }
    throw Error(`unsupported ${op}`);
  };
  fn.hashes = hashes;
  return fn;
}
// Deterministic fake embeddings: axis 0 = "shoe", axis 1 = "video", axis 2 = other.
function fakeEmbed() {
  const calls = [];
  const fn = async (texts, type) => {
    calls.push({n: texts.length, type});
    return texts.map(t => { const s = t.toLowerCase(); return [s.includes('shoe') ? 1 : 0, s.includes('video') ? 1 : 0, 0.1]; });
  };
  fn.calls = calls;
  return fn;
}
const env = {VOYAGE_API_KEY: 'k'};
const catalog = () => [
  {id: 'a', name: 'Shoe ad writer', text: 'writes shoe ads', source: 'Skill'},
  {id: 'b', name: 'Video cutter', text: 'trims video', source: 'Tool'},
  {id: 'c', name: 'Misc', text: 'other', source: 'Tool'},
];
test('build embeds everything once, then only changed items; removed items are dropped', async () => {
  const command = memory(), embed = fakeEmbed(), index = createEmbeddingIndex({command, embed, env, now: () => 5});
  let r = await index.build(alice, catalog());
  assert.equal(r.embedded, 3); assert.equal(r.ready, true); assert.equal(r.indexed, 3);
  r = await index.build(alice, catalog());
  assert.equal(r.embedded, 0);
  const changed = catalog(); changed[1].text = 'trims and joins video clips'; changed.pop();
  assert.deepEqual(await index.status(alice, changed), {model: 'voyage-3.5-lite', catalog: 2, indexed: 1, stale: 1, missing: 0, removed: 1, ready: false, updatedAt: 5});
  r = await index.build(alice, changed);
  assert.equal(r.embedded, 1); assert.equal(r.removed, 0); assert.equal(r.indexed, 2);
  assert.equal(command.hashes.get('nexus:lab:alice:embeddings:v1').size, 2);
});
test('model changes invalidate stored vectors and owners are isolated', async () => {
  const command = memory(), embed = fakeEmbed();
  await createEmbeddingIndex({command, embed, env}).build(alice, catalog());
  const other = createEmbeddingIndex({command, embed, env: {...env, VOYAGE_EMBED_MODEL: 'voyage-x'}});
  assert.equal((await other.status(alice, catalog())).stale, 3);
  assert.equal((await other.status(bob, catalog())).missing, 3);
});
test('query ranks stored vectors, skips stale entries, and refuses without an index or key', async () => {
  const command = memory(), embed = fakeEmbed(), index = createEmbeddingIndex({command, embed, env});
  await assert.rejects(index.query(alice, catalog(), 'shoe'), {status: 409});
  await index.build(alice, catalog());
  const before = embed.calls.length;
  const stale = catalog(); stale[0].text = 'now about boots';
  const r = await index.query(alice, stale, 'video');
  assert.equal(embed.calls.length, before + 1); assert.deepEqual(embed.calls.at(-1), {n: 1, type: 'query'});
  assert.equal(r.results[0].id, 'b'); assert.equal(r.indexed, 2); assert.equal(r.behind, 1);
  assert.ok(!r.results.some(x => x.id === 'a'));
  await assert.rejects(createEmbeddingIndex({command, embed, env: {}}).query(alice, catalog(), 'x'), {status: 409});
  await assert.rejects(createEmbeddingIndex({command, embed, env: {}}).build(alice, catalog()), {status: 409});
});
test('build caps one call and reports what remains; invalid vectors are rejected', async () => {
  const command = memory(), many = Array.from({length: BUILD_MAX + 10}, (_, i) => ({id: `i${i}`, name: `n${i}`, text: 't'}));
  const index = createEmbeddingIndex({command, embed: fakeEmbed(), env});
  const huge = many.slice(0, 300); // INDEX_LIMIT is 300; this stays under it
  let r = await index.build(alice, huge);
  assert.equal(r.embedded, BUILD_MAX); assert.equal(r.missing, huge.length - BUILD_MAX); assert.equal(r.ready, false);
  r = await index.build(alice, huge); assert.equal(r.ready, true);
  await assert.rejects(createEmbeddingIndex({command: memory(), embed: async t => t.map(() => [NaN]), env}).build(alice, catalog()), {status: 502});
  await assert.rejects(createEmbeddingIndex({command: memory(), embed: async () => [], env}).build(alice, catalog()), {status: 502});
});
test('Lab search in indexed mode uses the stored index and records the model', async () => {
  const command = memory(), embed = fakeEmbed(), lab = createNexusLab({command, env, embed, catalog: async () => catalog(), newId: () => 'r1'});
  await assert.rejects(lab.run(alice, {capability: 'search', mode: 'indexed', query: 'shoe'}), {status: 409});
  assert.equal((await lab.indexBuild(alice)).index.ready, true);
  const run = await lab.run(alice, {capability: 'search', mode: 'indexed', query: 'shoe'});
  assert.equal(run.output.results[0].id, 'a'); assert.equal(run.engine, 'voyage-3.5-lite'); assert.equal(run.input.mode, 'indexed');
  assert.equal((await lab.indexStatus(alice)).index.indexed, 3);
});
test('API exposes index actions only to authenticated owners', async () => {
  const res = () => ({setHeader() { return this; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; }});
  const req = action => ({method: 'POST', headers: {origin: 'https://nexus.test', host: 'nexus.test', 'content-type': 'application/json'}, body: {action}});
  const lab = createNexusLab({command: memory(), env, embed: fakeEmbed(), catalog: async () => catalog()});
  let out = res(); await createNexusLabHandler({authenticate: async () => null, service: lab})(req('index_build'), out);
  assert.equal(out.code, 401);
  const handler = createNexusLabHandler({authenticate: async () => alice, service: lab});
  out = res(); await handler(req('index_build'), out); assert.equal(out.code, 200); assert.equal(out.body.index.ready, true);
  out = res(); await handler(req('index_status'), out); assert.equal(out.body.index.indexed, 3);
});
