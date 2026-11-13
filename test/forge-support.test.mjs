import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportTokenFor, readToken, addMessage, listMessages, setMessageStatus } from '../lib/forgeSupport.js';
import { createForgeSupportHandler } from '../api/forge-support.js';
import { validateSite } from '../public/site-validate.mjs';

function fake() {
  const kv = new Map(), lists = new Map();
  return async c => {
    if (c[0] === 'GET') return kv.get(c[1]) ?? null;
    if (c[0] === 'SET') { kv.set(c[1], c[2]); return 'OK'; }
    if (c[0] === 'LPUSH') { const l = lists.get(c[1]) || []; l.unshift(c[2]); lists.set(c[1], l); return l.length; }
    if (c[0] === 'LTRIM') return 'OK';
    if (c[0] === 'LRANGE') return (lists.get(c[1]) || []).slice(0);
    if (c[0] === 'LSET') { lists.get(c[1])[Number(c[2])] = c[3]; return 'OK'; }
  };
}
const res = () => { const r = { setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = (method, body, query) => ({ method, headers: { origin: 'https://x.test', host: 'x.test' }, body, query });

test('one stable token per business; bad tokens are rejected', async () => {
  const redis = fake(); let n = 0;
  const a = await supportTokenFor('lead:1', 'Shop', { redis, rand: () => 'T'.repeat(23) + (n++) });
  const b = await supportTokenFor('lead:1', 'Shop', { redis, rand: () => 'U'.repeat(24) });
  assert.equal(a, b);
  assert.equal((await readToken(a, { redis })).businessName, 'Shop');
  assert.equal(await readToken('short', { redis }), null);
});

test('messages are stored, secrets redacted, short ones refused, and status can be set', async () => {
  const redis = fake();
  const t = await supportTokenFor('lead:1', 'Shop', { redis });
  assert.equal((await addMessage(t, { message: 'hi' }, { redis })).status, 400);
  assert.equal((await addMessage('nope', { message: 'hello there' }, { redis })).status, 404);
  const ok = await addMessage(t, { name: 'Sam', contact: '515-555-0100', message: 'Please change my hours' }, { redis });
  assert.equal(ok.entry.status, 'new');
  assert.equal((await listMessages(10, { redis })).length, 1);
  assert.ok(!(await setMessageStatus(ok.entry.id, 'done', { redis })).error);
  assert.equal((await listMessages(10, { redis }))[0].status, 'done');
  assert.ok((await setMessageStatus(ok.entry.id, 'bogus', { redis })).error);
});

test('API: public can post with a token, honeypot and rate limit work, only managers read or make links', async () => {
  const redis = fake(); const notes = [];
  const t = await supportTokenFor('lead:1', 'Shop', { redis });
  const d = { token: (k, n) => supportTokenFor(k, n, { redis }), read: x => readToken(x, { redis }), add: (x, m) => addMessage(x, m, { redis }), list: () => listMessages(10, { redis }), setStatus: (i, s) => setMessageStatus(i, s, { redis }), notify: m => { notes.push(m); } };
  const pub = createForgeSupportHandler({ ...d, user: async () => null, manager: async () => false, allow: async () => true });
  let r = res(); await pub(req('GET', undefined, { t }), r); assert.equal(r.body.name, 'Shop');
  r = res(); await pub(req('GET', undefined, { t: 'x'.repeat(24) }), r); assert.equal(r.code, 404);
  r = res(); await pub(req('POST', { t, message: 'help me please' }), r); assert.equal(r.code, 200); assert.equal(notes.length, 1);
  r = res(); await pub(req('POST', { t, message: 'spam spam', website: 'http://bot' }), r); assert.equal(r.code, 200); assert.equal((await listMessages(10, { redis })).length, 1);
  r = res(); await pub(req('GET', undefined, {}), r); assert.equal(r.code, 401);
  r = res(); await pub(req('POST', { action: 'link', key: 'a' }), r); assert.equal(r.code, 401);
  const limited = createForgeSupportHandler({ ...d, user: async () => null, manager: async () => false, allow: async () => false });
  r = res(); await limited(req('POST', { t, message: 'again again' }), r); assert.equal(r.code, 429);
  const boss = createForgeSupportHandler({ ...d, user: async () => 'boss', manager: async () => true, allow: async () => true });
  r = res(); await boss(req('GET', undefined, {}), r); assert.equal(r.body.messages.length, 1);
  r = res(); await boss(req('POST', { action: 'link', key: 'lead:9', businessName: 'Other' }), r); assert.match(r.body.path, /^\/support\.html\?s=[A-Za-z0-9_-]{20,40}$/);
  const caller = createForgeSupportHandler({ ...d, user: async () => 'caller01', manager: async () => false });
  r = res(); await caller(req('GET', undefined, {}), r); assert.equal(r.code, 403);
});

test('final sites show the support link; concept demos never do; bad urls are dropped', async () => {
  const { composeSite } = await import('../public/site-compose.mjs');
  const { renderSite } = await import('../public/site-render.mjs');
  const url = 'https://x.test/support.html?s=' + 'A'.repeat(24);
  const base = { businessName: 'Shop', category: 'barber', location: 'Des Moines, IA', phone: '515-555-0100' };
  const site = composeSite({ lead: { ...base, supportUrl: url }, recipe: 'editorial' });
  assert.equal(site.concept, true);
  assert.ok(!renderSite(site).includes('Message support'));
  const real = x => ({ ...x, concept: false, approval: 'Approved by owner 2026-11-12', business: { ...x.business, services: [{ name: 'Haircut', price: '$20' }] }, sections: x.sections.filter(sec => !sec.sample && sec.type !== 'gallery' && !sec.slots).map(sec => sec.variant === 'dialog' || sec.variant === 'demo' ? { ...sec, variant: 'call' } : sec) });
  const final = real(site);
  assert.ok(renderSite(final).includes(`href="${url}"`));
  const bad = composeSite({ lead: { ...base, supportUrl: 'https://evil.test/x' }, recipe: 'editorial' });
  assert.ok(!renderSite(real(bad)).includes('Message support'));
});
