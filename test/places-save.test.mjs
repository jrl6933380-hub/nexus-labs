import { test } from 'node:test';
import assert from 'node:assert/strict';
import { saveBuiltLead } from '../lib/placesSave.js';
import { buildFromPlace, readLead } from '../lib/placesBuild.js';

const body = (extra = {}) => ({ business: 'barber', city: 'Des Moines, Iowa', lead: { name: 'Baghdad Barber Shop', address: '5806 Franklin Ave', phone: '(773) 807-6741', rating: 5, reviewCount: 228, map_url: 'https://maps.google.com/?cid=1', status: 'no_dedicated_site_found', ...extra } });
const fakes = (existing = []) => { const calls = []; return { calls, list: async () => existing,
  create: async (i, o) => { calls.push(['create', i, o]); return { id: 'lead_1' }; },
  enrich: async (id, e) => { calls.push(['enrich', id, e]); }, site: async (id, s) => { calls.push(['site', id, s]); } }; };

test('saves a new lead with phone, rating and the three looks', async () => {
  const b = body(), f = fakes();
  const r = await saveBuiltLead({ lead: readLead(b), built: buildFromPlace(b), createdBy: 'justin' }, f);
  assert.equal(r.status, 'saved'); assert.equal(r.leadId, 'lead_1');
  assert.deepEqual(f.calls.map(c => c[0]), ['create', 'enrich', 'site']);
  assert.equal(f.calls[0][1].phone, '(773) 807-6741'); assert.equal(f.calls[0][2].createdBy, 'justin');
  assert.equal(f.calls[2][2].variants.length, 3); assert.equal(f.calls[2][2].status, 'ready');
});
test('does not add the same business and phone twice', async () => {
  const b = body(), f = fakes([{ id: 'old', businessName: 'baghdad barber shop', phone: '773-807-6741' }]);
  const r = await saveBuiltLead({ lead: readLead(b), built: buildFromPlace(b) }, f);
  assert.equal(r.status, 'already'); assert.equal(r.leadId, 'old'); assert.equal(f.calls.length, 0);
});
test('a lead with no phone is built but not saved', async () => {
  const b = body({ phone: '' }), f = fakes();
  const r = await saveBuiltLead({ lead: readLead(b), built: buildFromPlace(b) }, f);
  assert.equal(r.status, 'skipped'); assert.equal(f.calls.length, 0);
});
