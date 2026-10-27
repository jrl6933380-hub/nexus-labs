import test from 'node:test';
import assert from 'node:assert/strict';
import {ACTORS,publicCatalog} from '../lib/actorCatalog.js';
import {parseActorInput} from '../lib/researchJobs.js';

test('review intelligence is in the catalog within the planned price range', () => {
  const a = ACTORS.reviews_intel;
  assert.ok(a);
  assert.ok(a.cost >= 10 && a.cost <= 15);
  assert.ok(publicCatalog().some(x => x.id === 'reviews_intel'));
  assert.ok(!('instructions' in publicCatalog().find(x => x.id === 'reviews_intel')));
});

test('instructions demand honest counts, real quotes, five actions and refund on unreadable pages', () => {
  const t = ACTORS.reviews_intel.instructions;
  for (const s of ['N of M reviews', 'exact', 'exactly 5', 'at most 200', 'error', 'blocked']) assert.ok(t.includes(s), s);
});

test('accepts pasted reviews and a link, requires a business, rejects unknown fields', () => {
  const ok = parseActorInput('reviews_intel', { business: 'Smith Plumbing', reviews: '5 stars - fast!\n2 stars - late', focus: 'late arrivals' });
  assert.equal(ok.title, 'Smith Plumbing');
  assert.equal(ok.data.reviews.includes('\n'), true);
  assert.equal(parseActorInput('reviews_intel', { business: 'Smith', place: 'https://maps.google.com/?cid=1' }).data.place.startsWith('https://'), true);
  assert.throws(() => parseActorInput('reviews_intel', { reviews: 'x' }));
  assert.throws(() => parseActorInput('reviews_intel', { business: 'Smith', extra: 'x' }));
  assert.throws(() => parseActorInput('reviews_intel', { business: 'Smith', reviews: 'x'.repeat(24001) }));
});
