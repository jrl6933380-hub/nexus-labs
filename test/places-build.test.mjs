import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildFromPlace, readLead } from '../lib/placesBuild.js';

const lead = (extra = {}) => ({ name: 'Baghdad Barber Shop', address: '5806 Franklin Ave, Des Moines, IA 50310, USA', phone: '(773) 807-6741', rating: 5, reviewCount: 228,
  map_url: 'https://maps.google.com/?cid=1', status: 'no_dedicated_site_found', ...extra });
const req = (l = lead()) => ({ business: 'barber', city: 'Des Moines, Iowa', lead: l });

test('builds three previews and a pitch with the real phone, address and rating', () => {
  const out = buildFromPlace(req());
  assert.equal(out.previews.length, 3);
  assert.deepEqual(out.previews.map(p => p.id).sort(), ['bold', 'editorial', 'fresh']);
  for (const p of out.previews) {
    assert.match(p.html, /Baghdad Barber Shop/);
    assert.match(p.html, /SAMPLE PREVIEW/);
    assert.match(p.html, /807-6741/);
  }
  assert.match(out.previews.map(p => p.html).join(''), /5806 Franklin/);
  assert.match(out.pitch, /Phone: \(773\) 807-6741/);
  assert.match(out.pitch, /Google rating: 5 from 228 reviews/);
  assert.match(out.pitch, /Nothing has been sent/);
  assert.match(out.pitch, /Check the approved Forge offer/);
});

test('refuses a lead that already has a website, or an unknown status', () => {
  assert.throws(() => buildFromPlace(req(lead({ status: 'has_website' }))), /already has a website/);
  assert.throws(() => buildFromPlace(req(lead({ status: 'whatever' }))), /Unknown website status/);
  assert.throws(() => buildFromPlace({ business: 'barber', city: 'Des Moines' }), /Choose a lead/);
});

test('rating needs a review count, a bad phone and a non-https map link are dropped, text is escaped', () => {
  const l = readLead(req(lead({ reviewCount: null, phone: 'call me <b>', map_url: 'http://x.test' })));
  assert.equal(l.rating, null); assert.equal(l.phone, ''); assert.equal(l.mapUrl, '');
  const amp = buildFromPlace(req(lead({ name: 'Bob & Sons' }))).previews[0].html;
  assert.match(amp, /Bob &amp; Sons/); assert.doesNotMatch(amp, /Bob & Sons/);
});

test('rejects names with markup and over-long input', () => {
  assert.throws(() => buildFromPlace(req(lead({ name: 'Corner <b>Cuts</b>' }))), /needs a name/);
  assert.throws(() => buildFromPlace({ business: 'x'.repeat(41), city: 'Des Moines', lead: lead() }), /needs a name/);
});

test('no scripts reach out to the network', () => {
  for (const p of buildFromPlace(req()).previews) assert.doesNotMatch(p.html, /fetch\(|XMLHttpRequest|sendBeacon|<form[^>]+action=["']https?:/i);
});
