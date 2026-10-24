import test from 'node:test';
import assert from 'node:assert/strict';
import { wakeWaitlistBuilder, builderWakeText, publicBuildStatus } from '../lib/waitlistBuilderWake.js';

const ID = '123e4567-e89b-12d3-a456-426614174000';
const env = { CLAUDE_BUILDER_FIRE_URL: 'https://example.invalid/fire', CLAUDE_BUILDER_TRIGGER_TOKEN: 'tok-secret' };

function fakeCommand() {
  const kv = new Map();
  return async (p) => {
    const [c, k] = p;
    if (c === 'INCR') { const n = Number(kv.get(k) || 0) + 1; kv.set(k, n); return n; }
    if (c === 'EXPIRE') return 1;
    throw new Error('unexpected ' + c);
  };
}

test('does nothing when the builder env vars are missing', async () => {
  let fired = false;
  const r = await wakeWaitlistBuilder(ID, { env: {}, command: fakeCommand(), fire: async () => { fired = true; } });
  assert.deepEqual(r, { woke: false, reason: 'not configured' });
  assert.equal(fired, false);
});

test('fires with a pointer-only payload and passes the builder url and token', async () => {
  let seen;
  const r = await wakeWaitlistBuilder(ID, { env, command: fakeCommand(), fire: async (envelope, options) => { seen = { envelope, options }; } });
  assert.equal(r.woke, true);
  assert.equal(seen.envelope.idempotency_key, 'waitlist:' + ID);
  assert.equal(seen.options.fireUrl, env.CLAUDE_BUILDER_FIRE_URL);
  assert.equal(seen.options.triggerToken, env.CLAUDE_BUILDER_TRIGGER_TOKEN);
  assert.equal(seen.options.text, builderWakeText(ID));
  assert.ok(seen.options.text.includes(ID));
});

test('enforces the daily cap', async () => {
  const command = fakeCommand();
  let fires = 0;
  const opts = { env, command, dailyCap: 2, fire: async () => { fires++; } };
  assert.equal((await wakeWaitlistBuilder(ID, opts)).woke, true);
  assert.equal((await wakeWaitlistBuilder(ID, opts)).woke, true);
  assert.deepEqual(await wakeWaitlistBuilder(ID, opts), { woke: false, reason: 'daily cap' });
  assert.equal(fires, 2);
});

test('never throws and never leaks the token when the fire fails', async () => {
  const r = await wakeWaitlistBuilder(ID, { env, command: fakeCommand(), fire: async () => { throw new Error('boom tok-secret'); } });
  assert.deepEqual(r, { woke: false, reason: 'fire failed' });
  assert.ok(!JSON.stringify(r).includes('tok-secret'));
});

test('rejects a malformed entry id', async () => {
  assert.deepEqual(await wakeWaitlistBuilder('not an id!', { env, command: fakeCommand(), fire: async () => {} }), { woke: false, reason: 'bad id' });
});

test('public status maps saved statuses and hides everything else', () => {
  const hosts = ['site.example', 'claude.ai'];
  assert.deepEqual(publicBuildStatus({ status: 'waiting', email: 'a@b.co' }, { allowedHosts: hosts }), { stage: 'queued' });
  assert.deepEqual(publicBuildStatus({ status: 'previewing' }, { allowedHosts: hosts }), { stage: 'building' });
  assert.deepEqual(publicBuildStatus({ status: 'passed' }, { allowedHosts: hosts }), { stage: 'closed' });
  assert.equal(publicBuildStatus(null, { allowedHosts: hosts }), null);
});

test('preview link only appears for an allowed https host', () => {
  const hosts = ['site.example', 'claude.ai'];
  const ok = publicBuildStatus({ status: 'preview_sent', note: 'ad 12 https://claude.ai/artifact/abc' }, { allowedHosts: hosts });
  assert.deepEqual(ok, { stage: 'ready', preview_url: 'https://claude.ai/artifact/abc' });
  const evil = publicBuildStatus({ status: 'preview_sent', note: 'see https://evil.example/x' }, { allowedHosts: hosts });
  assert.deepEqual(evil, { stage: 'ready' });
  const http = publicBuildStatus({ status: 'preview_sent', note: 'http://site.example/x' }, { allowedHosts: hosts });
  assert.deepEqual(http, { stage: 'ready' });
  const none = publicBuildStatus({ status: 'preview_sent', note: 'no link yet' }, { allowedHosts: hosts });
  assert.deepEqual(none, { stage: 'ready' });
});

// ---- handler wiring ----
import { createWaitlistStore } from '../lib/waitlist.js';
import { handleWaitlist } from '../api/waitlist.js';

function fakeRedis() {
  const kv = new Map(); const lists = new Map();
  return async (p) => {
    const [c, k, a, b] = p;
    if (c === 'SET') { if (p.includes('NX') && kv.has(k)) return null; kv.set(k, a); return 'OK'; }
    if (c === 'GET') return kv.has(k) ? kv.get(k) : null;
    if (c === 'DEL') { kv.delete(k); return 1; }
    if (c === 'RPUSH') { const l = lists.get(k) || []; l.push(a); lists.set(k, l); return l.length; }
    if (c === 'LRANGE') return (lists.get(k) || []).slice(Number(a), Number(b) + 1);
    if (c === 'LSET') { lists.get(k)[Number(a)] = b; return 'OK'; }
    if (c === 'LLEN') return (lists.get(k) || []).length;
    throw new Error('unexpected ' + c);
  };
}
const mockRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const good = { name: 'Sam', business: 'Sam Lawn Care', kind: 'website', what: 'A simple site with my services and a call button', email: 'sam@example.com', consent: true };

test('a new request wakes the builder and returns the status handle', async () => {
  const store = createWaitlistStore({ command: fakeRedis() });
  let wokeWith;
  const res = mockRes();
  await handleWaitlist({ method: 'POST', body: good, headers: {} }, res, { store, allow: async () => true, wake: async (id) => { wokeWith = id; return { woke: true }; } });
  assert.equal(res.code, 200);
  assert.equal(res.body.building, true);
  assert.equal(res.body.id, wokeWith);
});

test('if the wake does not fire, the page gets no handle and the submit still succeeds', async () => {
  const store = createWaitlistStore({ command: fakeRedis() });
  const res = mockRes();
  await handleWaitlist({ method: 'POST', body: good, headers: {} }, res, { store, allow: async () => true, wake: async () => ({ woke: false }) });
  assert.deepEqual(res.body, { ok: true, duplicate: false });
});

test('a wake that throws never breaks the submit', async () => {
  const store = createWaitlistStore({ command: fakeRedis() });
  const res = mockRes();
  await handleWaitlist({ method: 'POST', body: good, headers: {} }, res, { store, allow: async () => true, wake: async () => { throw new Error('x'); } });
  assert.equal(res.code, 200);
  assert.equal(res.body.building, undefined);
});

test('a duplicate request does not wake anything', async () => {
  const store = createWaitlistStore({ command: fakeRedis() });
  let wakes = 0;
  const deps = { store, allow: async () => true, wake: async () => { wakes++; return { woke: true }; } };
  await handleWaitlist({ method: 'POST', body: good, headers: {} }, mockRes(), deps);
  const res = mockRes();
  await handleWaitlist({ method: 'POST', body: good, headers: {} }, res, deps);
  assert.equal(res.body.duplicate, true);
  assert.equal(wakes, 1);
});

test('status endpoint returns only the stage, never contact details', async () => {
  const store = createWaitlistStore({ command: fakeRedis() });
  const { id } = await store.add({ name: 'Sam', business: 'B', kind: 'website', what: 'x'.repeat(12), extra: '', links: '', email: 'sam@example.com', phone: '', consent: true }, []);
  const res = mockRes();
  await handleWaitlist({ method: 'GET', query: { status: id }, headers: { host: 'site.example' } }, res, { store });
  assert.deepEqual(res.body, { ok: true, stage: 'queued' });
  await store.update(id, { status: 'preview_sent', note: 'https://site.example/p/1' });
  const res2 = mockRes();
  await handleWaitlist({ method: 'GET', query: { status: id }, headers: { host: 'site.example' } }, res2, { store });
  assert.deepEqual(res2.body, { ok: true, stage: 'ready', preview_url: 'https://site.example/p/1', pay_url: `https://buy.stripe.com/00w6oH15NaHj9pf2mR4Ja02?client_reference_id=${id}` });
  await store.update(id, { status: 'paid' });
  const res3 = mockRes();
  await handleWaitlist({ method: 'GET', query: { status: id }, headers: { host: 'site.example' } }, res3, { store });
  assert.equal(res3.body.pay_url, undefined); // no pay button once they have paid
  assert.equal(res3.body.paid, true);
  assert.ok(!JSON.stringify(res2.body).includes('sam@example.com'));
});

test('status endpoint 404s on a bad or unknown id', async () => {
  const store = createWaitlistStore({ command: fakeRedis() });
  const bad = mockRes();
  await handleWaitlist({ method: 'GET', query: { status: 'nope' }, headers: {} }, bad, { store });
  assert.equal(bad.code, 404);
  const unknown = mockRes();
  await handleWaitlist({ method: 'GET', query: { status: '123e4567-e89b-12d3-a456-426614174999' }, headers: {} }, unknown, { store });
  assert.equal(unknown.code, 404);
});
