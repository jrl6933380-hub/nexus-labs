import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForgeDemoHandler, looksOf } from '../api/forge-demo.js';
import { createLink, getLink, revokeLink, allowView } from '../lib/forgeDemoLinks.js';
import { cleanCustomize } from '../lib/forgeCustomize.js';
import { generateSiteVariants, renderSiteVariant } from '../public/site-compose.mjs';

const fakeRedis = () => { const m = new Map(); return async c => { const [op, k, v] = c; if (op === 'GET') return m.get(k) ?? null; if (op === 'SET') { m.set(k, v); return 'OK'; } if (op === 'DEL') { m.delete(k); return 1; } if (op === 'INCR') { const n = Number(m.get(k) || 0) + 1; m.set(k, String(n)); return n; } return 1; }; };
const res = () => { const r = { headers: {}, setHeader(k, v) { r.headers[k] = v; }, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const lead = { id: 'l1', businessName: 'Shop', category: 'barber', location: 'Des Moines, Iowa', assignedTo: 'caller01', siteVariants: [{ id: 'a', label: 'A', html: '<p>a</p>' }, { id: 'b', label: 'B', html: '<p>b</p>' }, { id: 'c', label: 'C', html: '<p>c</p>' }], phone: '555', pitch: { secret: 1 } };
const post = body => ({ method: 'POST', headers: { origin: 'https://x.test', host: 'x.test', 'content-type': 'application/json' }, body });

test('link: one stable token per lead, revoke kills it', async () => {
  const redis = fakeRedis();
  const a = await createLink('l1', 'c', { redis }), b = await createLink('l1', 'c', { redis });
  assert.equal(a.token, b.token); assert.ok(b.reused); assert.match(a.token, /^[A-Za-z0-9_-]{20,40}$/);
  assert.equal((await getLink(a.token, { redis })).leadId, 'l1');
  await revokeLink('l1', { redis });
  assert.equal(await getLink(a.token, { redis }), null);
});

test('public GET returns only name + looks, no phone or pitch', async () => {
  const h = createForgeDemoHandler({ link: async () => ({ leadId: 'l1' }), lead: async () => lead, allow: async () => true });
  const r = res(); await h({ method: 'GET', query: { t: 'A'.repeat(24) }, headers: {} }, r);
  assert.equal(r.code, 200); assert.equal(r.body.looks.length, 3);
  assert.deepEqual(Object.keys(r.body).sort(), ['looks', 'name']);
  assert.ok(!JSON.stringify(r.body).includes('555') && !JSON.stringify(r.body).includes('secret'));
  assert.match(r.headers['X-Robots-Tag'], /noindex/);
});

test('public GET: bad token 404, unknown 404, rate limit 429', async () => {
  const h = createForgeDemoHandler({ link: async () => null, lead: async () => null, allow: async () => true });
  let r = res(); await h({ method: 'GET', query: { t: 'x' }, headers: {} }, r); assert.equal(r.code, 404);
  r = res(); await h({ method: 'GET', query: { t: 'A'.repeat(24) }, headers: {} }, r); assert.equal(r.code, 404);
  const h2 = createForgeDemoHandler({ allow: async () => false });
  r = res(); await h2({ method: 'GET', query: { t: 'A'.repeat(24) }, headers: {} }, r); assert.equal(r.code, 429);
});

test('rate limiter blocks after the limit', async () => {
  const redis = fakeRedis(); let ok = 0;
  for (let i = 0; i < 5; i++) if (await allowView('1.1.1.1', { redis, limit: 3, now: () => 0 })) ok++;
  assert.equal(ok, 3);
});

test('create: needs login, own lead only, manager any', async () => {
  const base = { worker: async () => true, lead: async () => lead, create: async () => ({ token: 'T'.repeat(24), reused: false }) };
  let r = res(); await createForgeDemoHandler({ ...base, user: async () => null })(post({ leadId: 'l1', action: 'create' }), r); assert.equal(r.code, 401);
  r = res(); await createForgeDemoHandler({ ...base, user: async () => 'other', manager: async () => false })(post({ leadId: 'l1', action: 'create' }), r); assert.equal(r.code, 403);
  r = res(); await createForgeDemoHandler({ ...base, user: async () => 'caller01', manager: async () => false })(post({ leadId: 'l1', action: 'create' }), r);
  assert.equal(r.code, 200); assert.equal(r.body.path, '/demo.html?t=' + 'T'.repeat(24));
  r = res(); await createForgeDemoHandler({ ...base, user: async () => 'boss', manager: async () => true })(post({ leadId: 'l1', action: 'create' }), r); assert.equal(r.code, 200);
  r = res(); const bad = post({ leadId: 'l1', action: 'create' }); bad.headers.origin = 'https://evil.test';
  await createForgeDemoHandler({ ...base, user: async () => 'caller01', manager: async () => false })(bad, r); assert.equal(r.code, 403);
});

test('looksOf falls back to the single built site and drops empties', () => {
  assert.equal(looksOf({ siteHtml: '<p>x</p>' }).length, 1);
  assert.equal(looksOf({}).length, 0);
});

test('customize: validates, clips, rejects unknown color', () => {
  assert.ok(cleanCustomize({}, ['sky']).error);
  assert.ok(cleanCustomize({ palette: 'nope' }, ['sky']).error);
  const c = cleanCustomize({ headline: ' Hi <b>x</b> ', services: [{ name: 'Cut', price: '$20' }, { name: '' }], palette: 'sky' }, ['sky']);
  assert.equal(c.palette, 'sky'); assert.deepEqual(c.content.services, [{ name: 'Cut', price: '$20' }]); assert.ok(!/[<>]/.test(c.content.headline));
});

test('customized content and color reach all three looks; prices render as supplied', () => {
  const l = { businessName: 'Shop', category: 'barber', location: 'Des Moines, Iowa', siteContent: { headline: 'Fresh fades daily', services: [{ name: 'Skin fade', price: '$30' }], hours: [{ day: 'Mon', time: '9-5' }] } };
  for (const v of generateSiteVariants(l)) { assert.ok(v.html.includes('Fresh fades daily')); assert.ok(v.html.includes('Skin fade')); assert.ok(v.html.includes('$30')); }
  assert.notEqual(renderSiteVariant(l, 'bold', { theme: { palette: 'sky' } }), renderSiteVariant(l, 'bold'));
});

test('claim words are refused by the composer so callers cannot put unverifiable claims on a sample', () => {
  const l = { businessName: 'Shop', category: 'barber', siteContent: { headline: 'Best barber in town' } };
  assert.throws(() => generateSiteVariants(l));
});
