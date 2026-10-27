import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchStore, genericResultSchema } from '../lib/researchJobs.js';
import { ACTORS, publicCatalog } from '../lib/actorCatalog.js';
import { createActorCreditsHandler } from '../api/actor-credits.js';

function memory() {
  const h = new Map();
  return async (parts) => {
    const [cmd, , ...rest] = parts;
    if (cmd === 'HGET') return h.get(rest[0]) ?? null;
    if (cmd === 'HVALS') return [...h.values()];
    if (cmd === 'HDEL') { h.delete(rest[0]); return 1; }
    if (cmd === 'EVAL') {
      const [field, old, next, limit] = [parts[4], parts[5], parts[6], parts[7]];
      const cur = h.get(field) ?? '';
      if (cur !== old) return 0;
      if (cur === '' && h.size >= Number(limit)) return -1;
      h.set(field, next); return 1;
    }
    throw new Error('unexpected ' + cmd);
  };
}
const store = () => createResearchStore({ command: memory(), wake: async () => ({ woke: false }) });
const okResult = { summary: 'Done.', sections: [{ title: 'Replies', items: ['a', 'b'] }], preview_html: '<p>draft</p>' };

test('catalog has the shared actors and hides agent instructions from the public list', () => {
  assert.ok(['research', 'docs', 'gbp', 'reviews', 'website', 'offer', 'missed', 'adspy', 'reviews_intel', 'price', 'localfinder'].every(id => ACTORS[id]));
  assert.equal(new Set(Object.values(ACTORS).map(a => a.id)).size, Object.keys(ACTORS).length);
  const pub = publicCatalog();
  assert.equal(pub.length, Object.keys(ACTORS).length);
  assert.ok(pub.every((a) => a.instructions === undefined && a.cost > 0));
  assert.equal(ACTORS.adspy.beta, true);
});

test('a new actor spends its own price, shows its own title, and claim returns its instructions', async () => {
  const s = store();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 30 });
  const r = await s.submit(token, { actor: 'reviews', reviews: 'Great place, loved it! 5 stars. Terrible wait, 2 stars.', business: 'Smith Plumbing' });
  assert.equal(r.credits_left, 26);
  assert.equal(r.search_cost, 4);
  const c = await s.claim({ job_id: r.job_id });
  assert.equal(c.actor, 'reviews');
  assert.match(c.instructions, /Review Reply Writer/);
  assert.match(c.instructions, /untrusted/);
  assert.equal(c.competitor, 'Smith Plumbing');
  const done = await s.complete({ job_id: r.job_id, result: okResult });
  assert.equal(done.status, 'done');
  const st = await s.status(token, { job_id: r.job_id });
  assert.equal(st.actor, 'reviews');
  assert.equal(st.result.sections[0].title, 'Replies');
  assert.equal((await s.walletInfo({ link_id })).credits, 26);
});

test('a failed new-actor job restores exactly its price', async () => {
  const s = store();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 20 });
  const r = await s.submit(token, { actor: 'gbp', business: 'Smith Plumbing, Des Moines' });
  assert.equal((await s.walletInfo({ link_id })).credits, 10);
  await s.claim({ job_id: r.job_id });
  const f = await s.complete({ job_id: r.job_id, error: 'could not find the business' });
  assert.equal(f.refunded, true);
  assert.equal((await s.walletInfo({ link_id })).credits, 20);
});

test('new actors need credits, validate input, and reject unknown actors or fields', async () => {
  const s = store();
  const runs = await s.createLink({ label: 'Old', runs: 3 });
  await assert.rejects(() => s.submit(runs.token, { actor: 'offer', business: 'X Co', what: 'widgets' }), (e) => e.code === 'NO_CREDITS');
  const w = await s.createLink({ label: 'W', credits: 5 });
  await assert.rejects(() => s.submit(w.token, { actor: 'nope', business: 'x' }), (e) => e.code === 'UNKNOWN_ACTOR');
  await assert.rejects(() => s.submit(w.token, { actor: 'offer', business: 'X Co' }));
  await assert.rejects(() => s.submit(w.token, { actor: 'offer', business: 'X Co', what: 'widgets', sneaky: 'x' }));
  await assert.rejects(() => s.submit(w.token, { actor: 'gbp', business: 'Smith Plumbing, Des Moines' }), (e) => e.code === 'NO_CREDITS');
  const ok = await s.submit(w.token, { actor: 'missed', type: 'plumber' });
  assert.equal(ok.credits_left, 2);
});

test('competitor research still works the old way, with and without the actor field', async () => {
  const s = store();
  const w = await s.createLink({ label: 'W', credits: 20 });
  const a = await s.submit(w.token, { competitor: 'Pizza Ranch' });
  const b = await s.submit(w.token, { actor: 'research', competitor: 'Casey' });
  assert.equal(a.credits_left, 12);
  assert.equal(b.credits_left, 4);
  const c = await s.claim({ job_id: a.job_id });
  assert.equal(c.claimed, true);
  assert.match(c.instructions, /Research the competitor/);
});

test('generic result is strict and the draft page has a size cap', () => {
  assert.ok(genericResultSchema.parse(okResult));
  assert.throws(() => genericResultSchema.parse({ summary: 'x', sections: [] }));
  assert.throws(() => genericResultSchema.parse({ ...okResult, extra: 1 }));
  assert.throws(() => genericResultSchema.parse({ ...okResult, preview_html: 'x'.repeat(40001) }));
});

test('catalog endpoint is public and checkout can return to an actor page', async () => {
  const posts = [];
  const h = createActorCreditsHandler({ store: store(), configured: () => true, secret: () => 'sec', post: async (p, b) => { posts.push(b); return { url: 'u' }; }, get: async () => ({}) });
  const res = () => { const r = { code: 0, body: null, setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
  const req = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body });
  const r1 = res(); await h(req({ action: 'catalog' }), r1);
  assert.equal(r1.body.data.actors.length, Object.keys(ACTORS).length);
  const r2 = res(); await h(req({ action: 'checkout', pack: 'p5', from: 'actor-gbp' }), r2);
  assert.match(posts[0].success_url, /\/actor\.html\?a=gbp&paid=1&session_id=/);
  assert.match(posts[0].cancel_url, /\/actor\.html\?a=gbp$/);
});
