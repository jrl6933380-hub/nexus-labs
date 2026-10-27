import test from 'node:test';
import assert from 'node:assert/strict';
import { createResearchStore } from '../lib/researchJobs.js';
import { PACKS, grantFromSession, walletToken } from '../lib/actorCredits.js';
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
const paid = (over = {}) => ({ id: 'cs_test_abcdefghij123456', payment_status: 'paid', metadata: { kind: 'actor_credits', pack: 'p10' }, ...over });
const res = () => { const r = { code: 0, body: null, headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body });

test('packs are the agreed prices and credits', () => {
  assert.deepEqual(Object.values(PACKS).map((p) => [p.cents, p.credits]), [[500, 50], [1000, 110], [2500, 300]]);
});

test('a paid session with no wallet makes one, and repeating it never doubles the credits', async () => {
  const s = store();
  const a = await grantFromSession(paid(), { store: s, secret: 'sec' });
  assert.equal(a.handled, true);
  assert.equal(a.credits, 110);
  assert.equal(a.token, walletToken('cs_test_abcdefghij123456', 'sec'));
  const b = await grantFromSession(paid(), { store: s, secret: 'sec' });
  assert.equal(b.credits, 110);
  const bal = await s.walletByToken(a.token);
  assert.equal(bal.credits, 110);
});

test('a paid session for an existing wallet tops it up once', async () => {
  const s = store();
  const { link_id } = await s.createLink({ label: 'W', credits: 8 });
  const sess = paid({ metadata: { kind: 'actor_credits', pack: 'p5', link_id } });
  assert.equal((await grantFromSession(sess, { store: s, secret: 'sec' })).credits, 58);
  assert.equal((await grantFromSession(sess, { store: s, secret: 'sec' })).credits, 58);
});

test('unpaid, unknown or foreign sessions add nothing', async () => {
  const s = store();
  assert.equal((await grantFromSession(paid({ payment_status: 'unpaid' }), { store: s, secret: 'sec' })).handled, false);
  assert.equal((await grantFromSession(paid({ metadata: { kind: 'actor_credits', pack: 'p999' } }), { store: s, secret: 'sec' })).handled, false);
  assert.equal((await grantFromSession(paid({ metadata: { kind: 'credit_pack' } }), { store: s, secret: 'sec' })).handled, false);
});

test('checkout builds the right Stripe session and claim hands a new buyer their wallet link', async () => {
  const s = store();
  const posts = [];
  const h = createActorCreditsHandler({ store: s, configured: () => true, secret: () => 'sec', post: async (p, b) => { posts.push([p, b]); return { url: 'https://stripe.test/pay' }; }, get: async () => paid() });
  const r1 = res(); await h(req({ action: 'checkout', pack: 'p25' }), r1);
  assert.equal(r1.body.data.url, 'https://stripe.test/pay');
  assert.equal(posts[0][1]['line_items[0][price_data][unit_amount]'], 2500);
  assert.equal(posts[0][1]['metadata[pack]'], 'p25');
  assert.equal(posts[0][1]['metadata[link_id]'], undefined);
  const r2 = res(); await h(req({ action: 'claim', session_id: 'cs_test_abcdefghij123456' }), r2);
  assert.equal(r2.body.data.credits, 110);
  assert.match(r2.body.data.path, /^\/research\.html\?k=[A-Za-z0-9_-]{32}$/);
  const r3 = res(); await h(req({ action: 'checkout', pack: 'nope' }), r3);
  assert.equal(r3.code, 400);
});

test('checkout with an existing wallet key tags the session with that wallet', async () => {
  const s = store();
  const { token, link_id } = await s.createLink({ label: 'W', credits: 8 });
  const posts = [];
  const h = createActorCreditsHandler({ store: s, configured: () => true, secret: () => 'sec', post: async (p, b) => { posts.push(b); return { url: 'u' }; }, get: async () => ({}) });
  const r = res(); await h(req({ action: 'checkout', pack: 'p5', key: token }), r);
  assert.equal(posts[0]['metadata[link_id]'], link_id);
  const bad = res(); await h(req({ action: 'checkout', pack: 'p5', key: 'x'.repeat(24) }), bad);
  assert.equal(bad.code, 404);
  const bal = res(); await h(req({ action: 'balance', key: token }), bal);
  assert.equal(bal.body.data.credits, 8);
});

test('checkout from the marketplace returns to the marketplace', async () => {
  const posts = [];
  const h = createActorCreditsHandler({ store: store(), configured: () => true, secret: () => 'sec', post: async (p, b) => { posts.push(b); return { url: 'u' }; }, get: async () => ({}) });
  const r = res(); await h(req({ action: 'checkout', pack: 'p5', from: 'market' }), r);
  assert.match(posts[0].success_url, /\/marketplace\.html\?paid=1&session_id=/);
  assert.match(posts[0].cancel_url, /\/marketplace\.html$/);
  const r2 = res(); await h(req({ action: 'checkout', pack: 'p5' }), r2);
  assert.match(posts[1].success_url, /\/research\.html\?paid=1/);
});

test('claim refuses an unpaid payment', async () => {
  const h = createActorCreditsHandler({ store: store(), configured: () => true, secret: () => 'sec', get: async () => paid({ payment_status: 'unpaid' }) });
  const r = res(); await h(req({ action: 'claim', session_id: 'cs_test_abcdefghij123456' }), r);
  assert.equal(r.code, 402);
});
