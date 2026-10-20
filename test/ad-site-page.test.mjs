import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGISTRY, VOCABULARY_VERSION, describeVocabulary, validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { imageIdsOf } from '../lib/adImages.js';
import { PLAYER_SUPPORT } from '../lib/adVocabularyTools.js';

const page = (params = {}) => ({
  specVersion: 2,
  name: 'Pairline concept',
  brand: 'Pairline',
  initial: 'P',
  mood: 'bold',
  palette: 'midnight-gold',
  platform: { format: 'portrait', lengthSec: 15 },
  concept: true,
  scenes: [
    {
      id: 'pg', type: 'site_page', duration: 10, camera: 'static', background: 'solid',
      params: {
        siteName: 'Pairline', headline: 'Pairs worth the hunt', eyebrow: 'Fresh this week', subhead: 'Photographed and checked by hand.',
        cta: 'Shop new drops', layout: 'poster', type: 'condensed', bg: '#E9E7E1', ink: '#101010', accent: '#2A38F5', accent2: '#FF5A36',
        imageId: 'img-hero00001', nav: [{ label: 'New drops' }, { label: 'Sell' }], strip: 'New pairs every Friday',
        cards: [{ title: 'Court Low', sub: 'Size 10', tag: 'Deadstock', color: '#C9D2E4', imageId: 'img-card00001' }, { title: 'Runner 90' }],
        points: [{ title: 'Checked by hand' }, { title: 'Real photos', detail: 'The exact pair.' }],
        closer: 'Got pairs to move?', closerCta: 'Sell your pair', scroll: true, ...params,
      },
    },
    { id: 'end', type: 'end_card', duration: 3, params: { cta: 'Join the waitlist' } },
  ],
});

test('site_page is in the vocabulary and the player supports it', () => {
  assert.equal(VOCABULARY_VERSION, '1.4.0');
  assert.ok(REGISTRY.sceneTypes.some((t) => t.id === 'site_page'));
  assert.ok(describeVocabulary().sceneTypes.some((t) => t.id === 'site_page'));
  assert.ok(PLAYER_SUPPORT.full.includes('site_page'));
  const html = readFileSync(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
  assert.match(html, /\n {2}site_page\(cam,sc,ctx\)\{/);
});

test('a full site_page project validates', () => {
  const r = validateProjectV2(page());
  assert.equal(r.ok, true, (r.errors || []).join('\n'));
});

test('a minimal site_page validates and bad fields are rejected', () => {
  assert.equal(validateProjectV2(page({ eyebrow: undefined, subhead: undefined, cta: undefined, imageId: undefined, nav: undefined, strip: undefined, cards: undefined, points: undefined, closer: undefined, closerCta: undefined })).ok, true);
  const bad = (params) => { const r = validateProjectV2(page(params)); assert.equal(r.ok, false); return r.errors.join('\n'); };
  assert.match(bad({ layout: 'zigzag' }), /layout/);
  assert.match(bad({ accent: 'blue' }), /accent/);
  assert.match(bad({ cards: Array.from({ length: 9 }, (_, i) => ({ title: 'P' + i })) }), /cards/);
  assert.match(bad({ cards: [{ sub: 'no title' }] }), /title/);
  assert.match(bad({ points: [{ title: 'only one' }] }), /points/);
  assert.match(bad({ headline: 'x'.repeat(66) }), /headline/);
  assert.match(bad({ scriptTag: '<script>' }), /scriptTag|unknown/i);
});

test('every picture a site_page points at is collected for resolving', () => {
  assert.deepEqual(imageIdsOf(page()).sort(), ['img-card00001', 'img-hero00001']);
});
