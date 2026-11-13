import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stockPhotosFor, queryFor } from '../lib/stockPhotos.js';
import { buildFromPlace } from '../lib/placesBuild.js';

const cand = (i, extra = {}) => ({ kind: 'photo', download_url: `https://cdn.pixabay.com/p${i}.jpg`, credit: `c${i} on Pixabay`, title: `barber, haircut, fade ${i}`, width: 3000, ...extra });
const store = () => { const m = new Map(); return async c => { if (c[0] === 'GET') return m.get(c[1]) ?? null; if (c[0] === 'SET') { m.set(c[1], c[2]); return 'OK'; } }; };

test('trade -> search words; unknown trades get none', () => {
  assert.equal(queryFor('Barber'), 'barber haircut'); assert.equal(queryFor('Auto repair'), 'auto mechanic garage'); assert.equal(queryFor('florist'), '');
});

test('picks credited landscape photos, drops anything that could show minors, marks them stock', async () => {
  const search = async () => ({ candidates: [cand(1), cand(2, { title: 'kids haircut school' }), cand(3), cand(4, { width: 400 }), cand(5), cand(6), cand(7), cand(8)] });
  const p = await stockPhotosFor('barber', 'Shop A', { search, redis: store() });
  assert.equal(p.length, 5); assert.ok(p.every(x => x.stock === true && x.credit && x.url.startsWith('https://cdn.pixabay.com/')));
  assert.ok(!p.some(x => /p2\.jpg|p4\.jpg/.test(x.url)));
});

test('different businesses get different runs; same business is stable; shortlist is cached', async () => {
  let calls = 0; const redis = store();
  const search = async () => { calls++; return { candidates: [1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => cand(i)) }; };
  const a = await stockPhotosFor('barber', 'Shop A', { search, redis }), a2 = await stockPhotosFor('barber', 'Shop A', { search, redis }), b = await stockPhotosFor('barber', 'Shop B', { search, redis });
  assert.deepEqual(a, a2); assert.notDeepEqual(a.map(x => x.url), b.map(x => x.url)); assert.equal(calls, 1);
});

test('failures and unknown trades return [] without throwing', async () => {
  assert.deepEqual(await stockPhotosFor('barber', 's', { search: async () => { throw new Error('down'); }, redis: store() }), []);
  assert.deepEqual(await stockPhotosFor('florist', 's', { search: async () => { throw new Error('no'); }, redis: store() }), []);
});

test('built demo carries the photos into all 3 looks and into the saved site content', () => {
  const photos = [1, 2, 3, 4].map(i => ({ url: `https://cdn.pixabay.com/p${i}.jpg`, alt: 'cut', credit: `c${i} on Pixabay`, stock: true }));
  const built = buildFromPlace({ business: 'barber', city: 'Des Moines, Iowa', lead: { name: 'Baghdad Barber Shop', status: 'no_dedicated_site_found', phone: '(773) 807-6741', address: '5806 Franklin Ave' } }, { photos });
  assert.equal(built.siteContent.photos.length, 4); assert.equal(built.siteContent.address, '5806 Franklin Ave');
  for (const v of built.previews) { assert.ok(v.html.includes('cdn.pixabay.com/p1.jpg'), v.id); assert.ok(/Stock photos for illustration only/.test(v.html)); }
});
