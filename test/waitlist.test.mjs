import test from 'node:test';
import assert from 'node:assert/strict';
import { validateWaitlistEntry, createWaitlistStore, allowWaitlist, waitlistPrice, validatePhotos } from '../lib/waitlist.js';
import { handleWaitlist } from '../api/waitlist.js';

const good = { name: 'Sam', business: 'Sam Lawn Care', kind: 'website', what: 'A simple site with my services and a call button', email: 'Sam@Example.com', consent: true };
const jpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==';

function fakeRedis() {
  const kv = new Map(); const lists = new Map();
  return async (p) => {
    const [c, k, a, b] = p;
    if (c === 'SET') { if (p.includes('NX') && kv.has(k)) return null; kv.set(k, a); return 'OK'; }
    if (c === 'GET') return kv.has(k) ? kv.get(k) : null;
    if (c === 'DEL') { kv.delete(k); return 1; }
    if (c === 'RPUSH') { const l = lists.get(k) || []; l.push(a); lists.set(k, l); return l.length; }
    if (c === 'LRANGE') return (lists.get(k) || []).slice(Number(a), Number(b) + 1);
    if (c === 'LLEN') return (lists.get(k) || []).length;
    if (c === 'INCR') { const n = Number(kv.get(k) || 0) + 1; kv.set(k, n); return n; }
    if (c === 'EXPIRE') return 1;
    throw new Error('unexpected ' + c);
  };
}
const mockRes = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; }, send(b) { r.sent = b; return r; } }; return r; };

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
test('extra notes keep line breaks and are length limited', () => {
  const r = validateWaitlistEntry({ ...good, extra: 'line one\n\n\n\nline two' });
  assert.equal(r.entry.extra, 'line one\n\nline two');
  assert.equal(validateWaitlistEntry({ ...good, extra: 'x'.repeat(1501) }).ok, false);
});
test('phone alone is enough; bad phone rejected', () => {
  assert.equal(validateWaitlistEntry({ ...good, email: '', phone: '(515) 555-0123' }).ok, true);
  assert.equal(validateWaitlistEntry({ ...good, email: '', phone: '123' }).ok, false);
});
test('honeypot is silently accepted without an entry', () => {
  const r = validateWaitlistEntry({ ...good, company_website: 'spam.com' });
  assert.equal(r.ok, true); assert.equal(r.honeypot, true); assert.equal(r.entry, undefined);
});
test('photos: accepts real image data URIs, rejects bad ones', () => {
  assert.equal(validatePhotos([jpeg]).ok, true);
  assert.equal(validatePhotos([jpeg, jpeg, jpeg, jpeg, jpeg]).ok, false);
  assert.equal(validatePhotos(['data:image/svg+xml;base64,PHN2Zz4=']).ok, false);
  assert.equal(validatePhotos(['data:image/jpeg;base64,AAAA']).ok, false); // wrong magic bytes
  assert.equal(validatePhotos(['data:image/jpeg;base64,/9j/' + 'A'.repeat(200_000)]).ok, false);
  assert.equal(validatePhotos(['https://evil.example/x.jpg']).ok, false);
  assert.equal(validatePhotos('nope').ok, false);
  assert.deepEqual(validatePhotos(undefined), { ok: true, photos: [] });
});
test('store dedupes the same contact, lists entries, and keeps photos', async () => {
  const store = createWaitlistStore({ command: fakeRedis(), now: () => 1, id: () => 'abcdef12-1' });
  const e = validateWaitlistEntry(good).entry;
  assert.equal((await store.add(e, [jpeg])).duplicate, false);
  assert.equal((await store.add(e, [jpeg])).duplicate, true);
  assert.equal(await store.count(), 1);
  const [row] = await store.list();
  assert.equal(row.business, 'Sam Lawn Care'); assert.equal(row.photos, 1);
  assert.equal(await store.photo('abcdef12-1', 0), jpeg);
  assert.equal(await store.photo('abcdef12-1', 3), null);
  assert.equal(await store.photo('../../x', 0), null);
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
test('handler: submit with photo, duplicate, validation, owner-only list and photo', async () => {
  const store = createWaitlistStore({ command: fakeRedis(), id: () => 'abcdef12-2' });
  const deps = { store, allow: async () => true, getUser: async () => null };
  let res = mockRes(); await handleWaitlist({ method: 'POST', body: { ...good, photos: [jpeg] }, headers: {} }, res, deps);
  assert.equal(res.code, 200); assert.equal(res.body.duplicate, false);
  res = mockRes(); await handleWaitlist({ method: 'POST', body: good, headers: {} }, res, deps);
  assert.equal(res.body.duplicate, true);
  res = mockRes(); await handleWaitlist({ method: 'POST', body: { ...good, what: '' }, headers: {} }, res, deps);
  assert.equal(res.code, 400);
  res = mockRes(); await handleWaitlist({ method: 'POST', body: { ...good, email: 'b@example.com', photos: ['data:text/html;base64,PGI+'] }, headers: {} }, res, deps);
  assert.equal(res.code, 400);
  res = mockRes(); await handleWaitlist({ method: 'GET', query: { list: '1' }, headers: {} }, res, deps);
  assert.equal(res.code, 403);
  res = mockRes(); await handleWaitlist({ method: 'GET', query: { photo: 'abcdef12-2', n: '0' }, headers: {} }, res, deps);
  assert.equal(res.code, 403);
  res = mockRes(); await handleWaitlist({ method: 'GET', query: {}, headers: {} }, res, deps);
  assert.equal(res.body.price, 9);
  res = mockRes(); await handleWaitlist({ method: 'POST', body: good, headers: {} }, res, { ...deps, allow: async () => false });
  assert.equal(res.code, 429);
});
