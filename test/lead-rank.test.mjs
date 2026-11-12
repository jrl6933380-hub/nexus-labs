import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreLead, rankLeads } from '../lib/leadRank.js';
import { leadsFrom } from '../lib/placesLeads.js';

const L = (o = {}) => ({ name: 'x', status: 'no_dedicated_site_found', phone: '(515) 555-0100', rating: 4.8, reviewCount: 88, ...o });

test('no website with many good reviews and a phone ranks first, existing websites last', () => {
  const ranked = rankLeads([L({ name: 'booking', status: 'social_booking_only' }), L({ name: 'site', status: 'has_website' }), L({ name: 'best', reviewCount: 228, rating: 5 }), L({ name: 'solid', reviewCount: 20, rating: 4 })]);
  assert.deepEqual(ranked.map(l => l.name), ['best', 'solid', 'booking', 'site']);
});
test('a missing phone is marked and pushed down, and the reason says why', () => {
  const a = scoreLead(L()), b = scoreLead(L({ phone: '' }));
  assert.ok(a.score > b.score); assert.match(b.reason, /cannot go on the call list/);
});
test('no reviews adds nothing, and scores are never negative', () => {
  assert.match(scoreLead(L({ reviewCount: null, rating: null })).reason, /no reviews listed/);
  assert.ok(scoreLead({ status: 'has_website', phone: '' }).score >= 0);
});
test('same input always gives the same ranking', () => {
  const list = [L({ name: 'a', reviewCount: 10 }), L({ name: 'b', reviewCount: 50 }), L({ name: 'c', status: 'needs_checking' })];
  assert.deepEqual(rankLeads(list).map(l => l.name), rankLeads([...list].reverse()).map(l => l.name));
});
test('Places results come back ranked with a score and reason', () => {
  const P = (name, o = {}) => ({ id: name, displayName: { text: name }, businessStatus: 'OPERATIONAL', nationalPhoneNumber: '(515) 555-0100', ...o });
  const out = leadsFrom({ places: [P('Small', { rating: 4, userRatingCount: 4 }), P('Big', { rating: 5, userRatingCount: 228 })] }, 5);
  assert.deepEqual(out.map(l => l.name), ['Big', 'Small']); assert.ok(out[0].score > out[1].score); assert.match(out[0].reason, /228 reviews at 5/);
});
