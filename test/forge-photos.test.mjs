import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createForgePhotosHandler } from '../api/forge-photos.js';
import { cleanCustomize } from '../lib/forgeCustomize.js';
import { generateSiteVariants } from '../public/site-compose.mjs';

const res = () => { const r = { setHeader() {}, status(c) { r.code = c; return r; }, json(b) { r.body = b; return r; } }; return r; };
const req = body => ({ method: 'POST', headers: { origin: 'https://x.test', host: 'x.test' }, body });
const cand = { id: 'pixabay:photo:1', kind: 'photo', thumb_url: 'https://cdn.pixabay.com/t.jpg', download_url: 'https://cdn.pixabay.com/p.jpg', credit: 'A on Pixabay', title: 'barber', license: 'Pixabay Content License', source: 'pixabay' };

test('photo finder: forge accounts only, returns credited photos', async () => {
  const base = { worker: async () => true, search: async () => ({ candidates: [cand, { ...cand, id: 'x', credit: '' }] }) };
  let r = res(); await createForgePhotosHandler({ ...base, user: async () => null })(req({ query: 'barber' }), r); assert.equal(r.code, 401);
  r = res(); await createForgePhotosHandler({ ...base, user: async () => 'c', worker: async () => false })(req({ query: 'barber' }), r); assert.equal(r.code, 403);
  r = res(); await createForgePhotosHandler({ ...base, user: async () => 'c' })(req({ query: 'x' }), r); assert.equal(r.code, 400);
  r = res(); await createForgePhotosHandler({ ...base, user: async () => 'c' })(req({ query: 'barber haircut' }), r);
  assert.equal(r.code, 200); assert.equal(r.body.photos.length, 1); assert.equal(r.body.photos[0].url, cand.download_url);
});

test('customize photos: only finder hosts, https, credit required, max 6', () => {
  const ok = { url: 'https://cdn.pixabay.com/p.jpg', credit: 'A on Pixabay', alt: 'cut' };
  assert.equal(cleanCustomize({ photos: [ok] }, []).content.photos[0].stock, true);
  assert.ok(cleanCustomize({ photos: [{ ...ok, url: 'https://evil.test/a.jpg' }] }, []).error);
  assert.ok(cleanCustomize({ photos: [{ ...ok, url: 'http://cdn.pixabay.com/a.jpg' }] }, []).error);
  assert.ok(cleanCustomize({ photos: [{ ...ok, credit: '' }] }, []).error);
  assert.ok(cleanCustomize({ photos: Array(7).fill(ok) }, []).error);
  assert.deepEqual(cleanCustomize({ photos: [] }, []).content.photos, []);
});

test('stock photos reach all 3 looks, are credited, and are labelled as illustration', () => {
  const lead = { businessName: 'Shop', category: 'barber', location: 'Des Moines, Iowa', siteContent: { photos: [0, 1, 2, 3].map(i => ({ url: `https://cdn.pixabay.com/p${i}.jpg`, alt: 'cut', credit: 'A on Pixabay', stock: true })) } };
  for (const v of generateSiteVariants(lead)) {
    assert.ok(v.html.includes('https://cdn.pixabay.com/p0.jpg'), v.id);
    assert.ok(v.html.includes('A on Pixabay'));
    assert.ok(/Stock photos for illustration only/.test(v.html), v.id);
  }
});
