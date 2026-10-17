import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildAdPlayer, PLAYER_PATH } from '../scripts/build-ad-player.mjs';
import { validateAdDesign } from '../public/ad-maker-design.js';
import { REGISTRY } from '../public/ad-vocabulary.mjs';

const committed = () => readFileSync(new URL(`../${PLAYER_PATH}`, import.meta.url), 'utf8');

test('committed player matches the registry build (run: node scripts/build-ad-player.mjs)', () => {
  assert.equal(committed(), buildAdPlayer());
});

test('player is a valid #617 creative design within its size cap', () => {
  const html = committed();
  assert.ok(html.length < 100000);
  const r = validateAdDesign({ name: 'Nexus vocabulary player', html });
  assert.equal(r.name, 'Nexus vocabulary player'); // validateAdDesign throws on invalid designs
  assert.match(html, /window\.renderAdFrame=/);
});

test('player is sandbox-safe: no network, no wall-clock or unseeded randomness in rendering', () => {
  const html = committed();
  assert.doesNotMatch(html, /https?:\/\//);
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|@import|url\(/i);
  assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|WebSocket|localStorage|sessionStorage|eval\(|new Function/);
  const renderPart = html.split('/* ---------- standalone preview')[0];
  assert.doesNotMatch(renderPart, /Math\.random|Date\.now|performance\.now|new Date/);
});

test('embedded tokens come from the registry (same moods, palettes, version)', () => {
  const html = committed();
  const m = html.match(/const VOCAB=(\{.*?\});\n/s);
  const vocab = JSON.parse(m[1].replace(/\\u003c/g, '<'));
  assert.equal(vocab.vocabularyVersion, REGISTRY.vocabularyVersion);
  assert.deepEqual(vocab.moods, JSON.parse(JSON.stringify(REGISTRY.moods)));
  assert.deepEqual(vocab.palettes, JSON.parse(JSON.stringify(REGISTRY.palettes)));
});

test('player handles every registered id the validator can emit', () => {
  const html = committed();
  for (const id of [...REGISTRY.textAnims, ...REGISTRY.cameras, ...REGISTRY.transitions, ...REGISTRY.backgrounds].map((x) => x.id)) {
    if (['static', 'cut', 'solid'].includes(id)) continue;
    assert.ok(html.includes(id), `player references ${id}`);
  }
  for (const t of REGISTRY.sceneTypes.map((x) => x.id)) assert.ok(html.includes(`${t}(`), `scene builder ${t}`);
  assert.match(html, /Concept preview — not a live site/);
});

test('honesty: stat_counter and testimonial tag unsourced content as SAMPLE and only show sourceRef when given', () => {
  const html = committed();
  assert.match(html, /return ghost\(pad,"sample","Sample"\)/);
  assert.match(html, /"Source: "\+P\.sourceRef/);
});

test('photo_focus only accepts data: image URIs (CSP-safe) and falls back to the brand mark', () => {
  const html = committed();
  assert.match(html, /function safeImg/);
  assert.match(html, /\^data:image\\\/\(png\|jpe\?g\|webp\|gif\|svg\\\+xml\);/);
  assert.match(html, /className="brandmark"/);
});

test('capture barrier: ?capture freezes the clock and __capture acknowledges each requested frame', () => {
  const html = committed();
  assert.match(html, /capture=q\.has\("capture"\)/);
  assert.match(html, /window\.__capture=async ms=>/);
  assert.match(html, /window\.__captureInfo=\(\)=>/);
  // waits for fonts, image decode and two paints before it acknowledges
  assert.match(html, /document\.fonts\.ready/);
  assert.match(html, /i\.decode\(\)/);
  assert.match(html, /requestAnimationFrame\(\(\)=>requestAnimationFrame\(r\)\)/);
  // ack is tied to the request: seq, DOM stamp, superseded-request rejection, render-error check
  assert.match(html, /stage\.dataset\.frameSeq=/);
  assert.match(html, /was superseded by a newer request/);
  assert.match(html, /Render error: /);
  assert.match(html, /Open the player with \?capture=1/);
  // the barrier lives in the standalone block, so the render path above stays free of wall-clock calls
  assert.ok(html.indexOf('window.__capture=') > html.indexOf('/* ---------- standalone preview'));
});
