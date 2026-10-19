import test from 'node:test';
import assert from 'node:assert/strict';
import { promoVideo, glowBlobs, kineticTitle, burst, logoReveal, cardStack, statPop, lowerThird, caption } from '../lib/adMotionKit.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';

const full = { brand: 'Nexus', hook: 'Build your next idea', points: [{ title: 'Describe it', sub: 'Plain words' }, 'Watch it build', 'Ship it'], stat: { value: '60s', label: 'idea to video' }, tagline: 'Your studio', cta: 'Try Nexus', bpm: 92 };

test('promoVideo returns a project the strict validator accepts', () => {
  const p = promoVideo(full);
  assert.equal(validateProjectV2(p).ok, true);
  assert.deepEqual(p.scenes.map((s) => s.id), ['hook', 'points', 'stat', 'brand', 'end']);
  assert.equal(p.scenes.at(-1).type, 'end_card');
});

test('points and stat are optional, and a bare promo still validates', () => {
  const p = promoVideo({ brand: 'Acme', hook: 'Fresh bread daily' });
  assert.deepEqual(p.scenes.map((s) => s.id), ['hook', 'brand', 'end']);
  assert.equal(validateProjectV2(p).ok, true);
});

test('every style and format validates', () => {
  for (const style of ['bright', 'warm', 'cool']) for (const format of ['portrait', 'square', 'landscape']) {
    assert.equal(validateProjectV2(promoVideo({ ...full, style, format })).ok, true, `${style} ${format}`);
  }
});

test('beat fields are added to graphic scenes only, and offsets are within one beat', () => {
  const p = promoVideo(full), spb = 60 / 92;
  for (const s of p.scenes) {
    if (s.type === 'graphic') { assert.equal(s.params.bpm, 92); assert.ok(s.params.beatOffset >= 0 && s.params.beatOffset < spb + 1e-6); } else assert.equal(s.params.bpm, undefined);
  }
});

test('output is deterministic', () => assert.equal(JSON.stringify(promoVideo(full)), JSON.stringify(promoVideo(full))));

test('bad input is refused with a clear error', () => {
  assert.throws(() => promoVideo({ hook: 'x' }), /brand is required/);
  assert.throws(() => promoVideo({ brand: 'x' }), /hook is required/);
  assert.throws(() => promoVideo({ ...full, style: 'neon' }), /style must be one of/);
});

test('long text is cut to the vocabulary limits instead of failing', () => {
  const long = 'x'.repeat(300);
  assert.equal(validateProjectV2(promoVideo({ ...full, hook: long, tagline: long, cta: long, points: [long, long], stat: { value: long, label: long } })).ok, true);
});

test('builders stay inside the layer budget and hand back plain objects', () => {
  const groups = [glowBlobs(), kineticTitle({ text: 'Hi' }), burst(), logoReveal({ letter: 'Nexus' }), cardStack({ cards: ['a', 'b', 'c', 'd', 'e'] }), statPop({ value: '9' }), lowerThird({ title: 't', sub: 's' }), caption({ text: 'hello', start: 1, end: 2 })];
  for (const g of groups) { assert.ok(Array.isArray(g) && g.length >= 1 && g.length <= 20); for (const l of g) assert.equal(typeof l.shape, 'string'); }
  assert.equal(cardStack({ cards: ['a', 'b', 'c', 'd', 'e'] }).filter((l) => l.shape === 'text').length, 4, 'at most four cards');
  assert.equal(logoReveal({ letter: 'Nexus' }).find((l) => l.text).text, 'N', 'the mark is one letter');
});
