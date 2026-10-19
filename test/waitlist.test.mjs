import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWaitlistEntry, createWaitlistStore, allowWaitlist, waitlistPrice } from '../lib/waitlist.js';
import { handleWaitlist } from '../api/waitlist.js';

const good = { name: 'Sam', business: 'Sam Lawn Care', kind: 'website', what: 'A simple site with my services and a call button', email: 'Sam@Example.com', consent: true };

function fakeRedis() {
  const kv = new Map(); const lists = new Map();
  return async (p) => {
    const [c, k, a, b] = p;
    if (c === 'SET') { if (p.includes('NX') && kv.has(k)) return null; kv.set(k, a); return 'OK'; }
    if (c === 'DEL') { kv.delete(k); return 1; }
    if (c === 'RPUSH') { const l = lists.get(k) || []; l.push(a); lists.set(k, l); return l.length; }
    if (c === 'LRANGE') return (lists.get(k) || []).slice(Number(a), Number(b) + 1);
    if (c === 'LLEN') return (lists.get(k) || []).length;
    if (c === 'INCR') { const n = Number(kv.get(k) || 0) + 1; kv.set(k, n); return n; }
    if (c === 'EXPIRE') return 1;
    throw new Error('unexpected ' + c);
  };
}
const mockRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };

test('accepts a good entry and normalizes email', () => {
  const r = validateWaitlistEntry(good);
  assert.equal(r.ok, true);
  assert.equal(r.entry.email, 'sam@example.com');
});
test('rejects short request, missing contact, bad email, no consent', () => {
  assert.equal(validateWaitlistEntry({ ...good, what: 'site' }).ok, false);
  assert.equal(validateWaitlistEntry({ ...good, email: '' }).ok, false);
  assert.equal(validateWaitlistEntry({ ...good, email: 'nope' }).ok, false);
  assert.equal(validateWaitlistEntry({ ...good, consent: false }).ok, false);
  assert.equal(validateWaitlistEntry({ ...good, what: 'x'.repeat(601) }).ok, false);
});
test('phone alone is enough; bad phone rejected', () => {
  assert.equal(validateWaitlistEntry({ ...good, email: '', phone: '(515) 555-0123' }).ok, true);
  assert.equal(validateWaitlistEntry({ ...good, email: '', phone: '123' }).ok, false);
});
test('honeypot is silently accepted without an entry', () => {
  const r = validateWaitlistEntry({ ...good, company_website: 'spam.com' });
  assert.equal(r.ok, true); assert.equal(r.honeypot, true); assert.equal(r.entry, undefined);
});
test('store dedupes the same contact and lists entries', async () => {
  const store = createWaitlistStore({ command: fakeRedis(), now: () => 1, id: () => 'a' });
  const e = validateWaitlistEntry(good).entry;
  assert.equal((await store.add(e)).duplicate, false);
  assert.equal((await store.add(e)).duplicate, true);
  assert.equal(await store.count(), 1);
  assert.equal((await store.list())[0].business, 'Sam Lawn Care');
});
test('rate limit blocks after the limit', async () => {
  const command = fakeRedis(); const req = { headers: { 'x-forwarded-for': '1.2.3.4' } };
  for (let i = 0; i < 2; i++) assert.equal(await allowWaitlist(req, { limit: 2, command }), true);
  assert.equal(await allowWaitlist(req, { limit: 2, command }), false);
});
test('price defaults to 9 and honors a valid override', () => {
  assert.equal(waitlistPrice({}), 9);
  assert.equal(waitlistPrice({ WAITLIST_PRICE_USD: '7' }), 7);
  assert.equal(waitlistPrice({ WAITLIST_PRICE_USD: '500' }), 9);
});
test('handler: submit, duplicate, validation, list is owner only', async () => {
  const store = createWaitlistStore({ command: fakeRedis() });
  const deps = { store, allow: async () => true, getUser: async () => null };
  let res = mockRes(); await handleWaitlist({ method: 'POST', body: good, headers: {} }, res, deps);
  assert.equal(res.code, 200); assert.equal(res.body.duplicate, false);
  res = mockRes(); await handleWaitlist({ method: 'POST', body: good, headers: {} }, res, deps);
  assert.equal(res.body.duplicate, true);
  res = mockRes(); await handleWaitlist({ method: 'POST', body: { ...good, what: '' }, headers: {} }, res, deps);
  assert.equal(res.code, 400);
  res = mockRes(); await handleWaitlist({ method: 'GET', query: { list: '1' }, headers: {} }, res, deps);
  assert.equal(res.code, 403);
  res = mockRes(); await handleWaitlist({ method: 'GET', query: {}, headers: {} }, res, deps);
  assert.equal(res.body.price, 9);
  res = mockRes(); await handleWaitlist({ method: 'POST', body: good, headers: {} }, res, { ...deps, allow: async () => false });
  assert.equal(res.code, 429);
});
