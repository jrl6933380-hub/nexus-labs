import test from 'node:test';
import assert from 'node:assert/strict';
import { freshPreset, validateProject, totalDuration } from '../public/ad-maker-model.mjs';
import {
  REGISTRY, VOCABULARY_VERSION, LIMITS, describeVocabulary, isSpecV2,
  validateProjectV2, totalDurationV2, frameAtV2,
} from '../public/ad-vocabulary.mjs';

const good = () => ({
  specVersion: 2,
  name: "Pat's Plumbing",
  brand: "PAT'S PLUMBING",
  initial: 'P',
  accent: '#E6C572',
  background: '#0c1812',
  mood: 'bold',
  platform: { format: 'portrait', lengthSec: 15 },
  tags: { industry: 'plumber', goal: 'call', tone: 'bold', hook: 'pain_point' },
  concept: true,
  scenes: [
    { id: 's1', type: 'hook_text', duration: 3, params: { headline: 'Burst pipe at 2am?', support: 'We answer.', textAnim: 'kinetic_stack' }, camera: 'push_in', background: 'grain', transitionOut: 'wipe_left', transitionMs: 400 },
    { id: 's2', type: 'site_mockup', duration: 4, params: { siteName: "Pat's Plumbing", headline: 'Fast local help', cta: 'Call now', style: 'dark', scroll: true } },
    { id: 's3', type: 'end_card', duration: 4, params: { cta: 'Call now', destination: '555-0100' } },
  ],
});
const errs = (mutate) => { const p = good(); mutate(p); const r = validateProjectV2(p); assert.equal(r.ok, false); return r.errors.join('\n'); };

test('legacy presets are untouched by v2 and still validate', () => {
  for (const key of ['team', 'business', 'life']) {
    const p = freshPreset(key);
    assert.equal(isSpecV2(p), false);
    const v = validateProject(p);
    assert.equal(v.scenes.length, 4);
    assert.ok(totalDuration(v) >= 8);
  }
});

test('legacy normalizer never carries v2 fields (v2 must use its own path)', () => {
  const v = validateProject({ ...freshPreset('team'), specVersion: 2, mood: 'bold' });
  assert.equal(v.specVersion, undefined);
  assert.equal(v.mood, undefined);
});

test('legacy ads are rejected by the v2 validator', () => {
  assert.equal(validateProjectV2(freshPreset('team')).ok, false);
});

test('a valid v2 project passes and is normalized', () => {
  const r = validateProjectV2(good());
  assert.deepEqual(r.errors, []);
  assert.equal(r.value.accent, '#e6c572');
  assert.equal(r.value.scenes.length, 3);
  assert.equal(totalDurationV2(r.value), 11);
});

test('validator does not mutate its input', () => {
  const p = good();
  const copy = JSON.stringify(p);
  validateProjectV2(p);
  assert.equal(JSON.stringify(p), copy);
});

test('unknown ids and fields are rejected', () => {
  assert.match(errs((p) => { p.mood = 'neon'; }), /mood/);
  assert.match(errs((p) => { p.scenes[0].type = 'confetti'; }), /scenes\[0\]\.type/);
  assert.match(errs((p) => { p.scenes[0].camera = 'spin'; }), /camera/);
  assert.match(errs((p) => { p.scenes[0].background = 'video'; }), /background/);
  assert.match(errs((p) => { p.scenes[0].transitionOut = 'explode'; }), /transitionOut/);
  assert.match(errs((p) => { p.scenes[0].params.textAnim = 'shake'; }), /textAnim/);
  assert.match(errs((p) => { p.tags.industry = 'spaceship'; }), /tags\.industry/);
  assert.match(errs((p) => { p.platform.format = 'tall'; }), /platform\.format/);
  assert.match(errs((p) => { p.extra = 1; }), /extra: unknown/);
  assert.match(errs((p) => { p.scenes[0].html = '<script>'; }), /html: unknown/);
  assert.match(errs((p) => { p.scenes[0].params.onclick = 'x'; }), /onclick: unknown/);
});

test('limits: text, scene count, duration, total length', () => {
  assert.match(errs((p) => { p.scenes[0].params.headline = 'x'.repeat(LIMITS.headline + 1); }), /headline/);
  assert.match(errs((p) => { p.scenes[0].params.headline = ''; }), /headline/);
  assert.match(errs((p) => { p.scenes[2].params.cta = 'x'.repeat(LIMITS.cta + 1); }), /cta/);
  assert.match(errs((p) => { p.scenes.pop(); p.scenes.pop(); }), /needs 2 to 8/);
  assert.match(errs((p) => { p.scenes = Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, type: 'end_card', duration: 2, params: { cta: 'Go' } })); }), /needs 2 to 8/);
  assert.match(errs((p) => { p.scenes[0].duration = 1.4; }), /duration/);
  assert.match(errs((p) => { p.scenes[0].duration = 16; }), /duration/);
  assert.match(errs((p) => { p.scenes = Array.from({ length: 4 }, (_, i) => ({ id: `s${i}`, type: 'end_card', duration: 10, params: { cta: 'Go' } })); }), /exceeds 30s/);
  assert.match(errs((p) => { p.scenes[0].transitionMs = 100; }), /transitionMs/);
});

test('v2 allows 1.5s scenes (6 second ads) that legacy rejects', () => {
  const p = good();
  p.platform.lengthSec = 6;
  p.scenes = [
    { id: 'a', type: 'hook_text', duration: 1.5, params: { headline: 'Hi' } },
    { id: 'b', type: 'end_card', duration: 1.5, params: { cta: 'Go' } },
  ];
  assert.equal(validateProjectV2(p).ok, true);
});

test('scene ids: format and uniqueness', () => {
  assert.match(errs((p) => { p.scenes[1].id = 's1'; }), /duplicate/);
  assert.match(errs((p) => { p.scenes[1].id = 'Bad Id'; }), /id/);
});

test('required fields and bad types', () => {
  assert.match(errs((p) => { delete p.name; }), /name/);
  assert.match(errs((p) => { delete p.mood; }), /mood/);
  assert.match(errs((p) => { delete p.platform; }), /platform/);
  assert.match(errs((p) => { p.accent = 'red'; }), /accent/);
  assert.match(errs((p) => { p.concept = 'yes'; }), /concept/);
  assert.match(errs((p) => { p.scenes[1].params = {}; }), /siteName/);
  assert.match(errs((p) => { p.scenes[0].duration = NaN; }), /duration/);
  assert.match(errs((p) => { p.specVersion = 3; }), /specVersion/);
  assert.equal(validateProjectV2(null).ok, false);
  assert.equal(validateProjectV2([]).ok, false);
});

test('control characters are rejected in text', () => {
  assert.match(errs((p) => { p.scenes[0].params.headline = 'a\u0000b'; }), /control/);
});

test('steps_list, stat_counter and testimonial params are validated', () => {
  const p = good();
  p.scenes = [
    { id: 'a', type: 'steps_list', duration: 3, params: { items: [{ title: 'Call' }, { title: 'We arrive', detail: 'Fast' }] } },
    { id: 'b', type: 'stat_counter', duration: 3, params: { value: 30, suffix: ' min', label: 'avg arrival', numberFormat: 'integer' } },
    { id: 'c', type: 'testimonial', duration: 3, params: { quote: 'Great.', sourceRef: 'approval-123' } },
  ];
  assert.equal(validateProjectV2(p).ok, true);
  p.scenes[0].params.items = [{ title: 'only one' }];
  assert.match(validateProjectV2(p).errors.join(), /items/);
  p.scenes[0].params.items = [{ title: 'a' }, { detail: 'no title' }];
  assert.match(validateProjectV2(p).errors.join(), /title/);
  p.scenes[0].params.items = [{ title: 'a' }, { title: 'b' }];
  p.scenes[1].params.value = 'lots';
  assert.match(validateProjectV2(p).errors.join(), /value/);
});

test('size model: the 180,000 byte config cap is part of the limits', () => {
  const p = good();
  p.scenes = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, type: 'steps_list', duration: 3, params: { items: [{ title: 'x' }, { title: 'y' }] } }));
  assert.equal(validateProjectV2(p).ok, true);
  assert.equal(LIMITS.configBytesMax, 180000);
});

test('registry is frozen, versioned and self-consistent', () => {
  assert.equal(REGISTRY.vocabularyVersion, VOCABULARY_VERSION);
  assert.throws(() => { 'use strict'; REGISTRY.sceneTypes.push({}); });
  assert.throws(() => { 'use strict'; REGISTRY.limits.scenesMax = 99; });
  const d = describeVocabulary();
  assert.deepEqual(d, JSON.parse(JSON.stringify(REGISTRY)));
  d.sceneTypes.length = 0;
  assert.equal(REGISTRY.sceneTypes.length, 9);
  for (const group of ['sceneTypes', 'textAnims', 'cameras', 'easings', 'transitions', 'backgrounds', 'moods', 'formats', 'lengths']) {
    const idsList = REGISTRY[group].map((x) => x.id);
    assert.equal(new Set(idsList).size, idsList.length, `${group} ids unique`);
  }
  assert.deepEqual(REGISTRY.sceneTypes.filter((t) => t.priority).map((t) => t.id), ['hook_text', 'site_mockup', 'end_card']);
  for (const m of REGISTRY.moods) {
    assert.ok(REGISTRY.easings.some((e) => e.id === m.easing));
    assert.ok(REGISTRY.textAnims.some((a) => a.id === m.textAnim));
    assert.doesNotMatch(m.heading + m.body, /https?:|url\(/);
  }
  assert.deepEqual(REGISTRY.tags.tone, REGISTRY.moods.map((m) => m.id));
});

test('frameAtV2 is deterministic and matches legacy boundary semantics', () => {
  const p = validateProjectV2(good()).value;
  assert.deepEqual(frameAtV2(p, 1500), frameAtV2(p, 1500));
  assert.equal(frameAtV2(p, 0).id, 's1');
  assert.equal(frameAtV2(p, 1500).progress, 0.5);
  assert.equal(frameAtV2(p, 3000).id, 's2');
  assert.equal(frameAtV2(p, 3000).progress, 0);
  const last = frameAtV2(p, 11000);
  assert.equal(last.id, 's3');
  assert.equal(last.progress, 1);
  assert.equal(frameAtV2(p, 99999).id, 's3');
  assert.equal(frameAtV2(p, -5).progress, 0);
});

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return (x + 0.05) / (y + 0.05); };

test('palettes: ids, tags and colours are valid and legible', () => {
  assert.ok(REGISTRY.palettes.length >= 8);
  const moodIds = REGISTRY.moods.map((m) => m.id);
  for (const p of REGISTRY.palettes) {
    for (const c of Object.values(p.colors)) assert.match(c, /^#[0-9a-f]{6}$/i);
    assert.ok(p.tags.mood.length > 0 && p.tags.mood.every((m) => moodIds.includes(m)), `${p.id} mood tags`);
    assert.ok(p.tags.industry.length > 0 && p.tags.industry.every((i) => REGISTRY.tags.industry.includes(i)), `${p.id} industry tags`);
    assert.ok(contrast(p.colors.text, p.colors.bg) >= 7, `${p.id} text contrast`);
    assert.ok(contrast(p.colors.muted, p.colors.bg) >= 4.5, `${p.id} muted contrast`);
    assert.ok(contrast(p.colors.accent, p.colors.bg) >= 3, `${p.id} accent contrast`);
  }
  for (const m of moodIds) assert.ok(REGISTRY.palettes.some((p) => p.tags.mood.includes(m)), `${m} has a palette`);
  for (const i of REGISTRY.tags.industry.filter((x) => x !== 'other')) assert.ok(REGISTRY.palettes.some((p) => p.tags.industry.includes(i)), `${i} has a palette`);
});

test('palette is optional, validated, and never overrides explicit colours', () => {
  const p = good();
  p.palette = 'midnight-gold';
  const r = validateProjectV2(p);
  assert.equal(r.ok, true);
  assert.equal(r.value.palette, 'midnight-gold');
  assert.equal(r.value.accent, '#e6c572');
  p.palette = 'neon-vomit';
  assert.match(validateProjectV2(p).errors.join(), /palette/);
  delete p.palette;
  assert.equal(validateProjectV2(p).value.palette, undefined);
});
