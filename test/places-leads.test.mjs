import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchPlaces, classify, leadsFrom, spec } from '../lib/placesLeads.js';
import { createForgePlacesHandler } from '../api/forge-places.js';

const P = (name, o = {}) => ({ id: name, displayName: { text: name }, formattedAddress: '1 Main St, Des Moines, IA', businessStatus: 'OPERATIONAL', ...o });
const reply = (places, ok = true, status = 200) => async () => ({ ok, status, json: async () => (ok ? { places } : places) });

test('classifies by the website field', () => {
  assert.equal(classify(P('a')).status, 'no_dedicated_site_found');
  assert.equal(classify(P('a', { websiteUri: 'https://www.facebook.com/x' })).status, 'social_booking_only');
  assert.equal(classify(P('a', { websiteUri: 'https://booksy.com/en-us/1' })).status, 'social_booking_only');
  assert.equal(classify(P('a', { websiteUri: 'https://hilltopcuts.com' })).status, 'has_website');
  assert.equal(classify(P('a', { websiteUri: 'not a url' })).status, 'needs_checking');
});
test('leads are filtered, de-duplicated, ranked and capped', () => {
  const places = [P('Has Site', { websiteUri: 'https://hilltopcuts.com' }), P('Closed', { businessStatus: 'CLOSED_PERMANENTLY' }), P('No Site', { nationalPhoneNumber: '(515) 555-0100' }), P('No Site'), P('FB', { websiteUri: 'https://facebook.com/fb' })];
  const l = leadsFrom({ places }, 2);
  assert.deepEqual(l.map(x => x.name), ['No Site', 'FB']);
  assert.equal(l[0].phone, '(515) 555-0100');
});
test('rating needs a review count', () => {
  assert.equal(leadsFrom({ places: [P('A', { rating: 4.5 })] }, 5)[0].rating, null);
  const r = leadsFrom({ places: [P('A', { rating: 4.5, userRatingCount: 12 })] }, 5)[0];
  assert.deepEqual([r.rating, r.reviewCount], [4.5, 12]);
});
test('search sends the key only in the header and validates input', async () => {
  let seen;
  const out = await searchPlaces({ business: 'barber', city: 'Des Moines, IA', count: 5 }, { key: 'K', fetchImpl: async (u, o) => { seen = { u, o }; return reply([P('Hilltop')])(); } });
  assert.equal(seen.o.headers['X-Goog-Api-Key'], 'K'); assert.ok(!seen.u.includes('K')); assert.match(seen.o.body, /barber in Des Moines/);
  assert.equal(out.leads.length, 1); assert.equal(out.counts.no_dedicated_site_found, 1);
  assert.throws(() => spec({ business: '<b>', city: 'x', count: 3 }));
  assert.throws(() => spec({ business: 'barber', city: 'Ames', count: 11 }));
  await assert.rejects(searchPlaces({ business: 'barber', city: 'Ames' }, { key: '' }), /not set/);
});
test('Google errors are reported without leaking the key', async () => {
  await assert.rejects(searchPlaces({ business: 'barber', city: 'Ames' }, { key: 'K', fetchImpl: reply({ error: { status: 'PERMISSION_DENIED', message: 'Bad key AIzaSyABC_def-123 here' } }, false, 403) }),
    e => /PERMISSION_DENIED/.test(e.message) && !/AIzaSy/.test(e.message));
});
test('the endpoint is owner-only, same-origin POST', async () => {
  const run = async (req, owner = { owner: true }) => {
    const h = createForgePlacesHandler({ resolveAccount: async () => owner, search: async i => ({ ok: i }) });
    const res = { h: {}, setHeader() {}, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } };
    await h({ method: 'POST', headers: { origin: 'https://a.test', host: 'a.test', 'content-type': 'application/json' }, body: { business: 'barber', city: 'Ames', count: 3 }, ...req }, res); return res;
  };
  assert.equal((await run({})).code, 200);
  assert.equal((await run({}, { owner: false })).code, 403);
  assert.equal((await run({ method: 'GET' })).code, 405);
  assert.equal((await run({ headers: { origin: 'https://evil.test', host: 'a.test', 'content-type': 'application/json' } })).code, 403);
  assert.equal((await run({ headers: { host: 'a.test', 'content-type': 'application/json' } })).code, 403);
});
