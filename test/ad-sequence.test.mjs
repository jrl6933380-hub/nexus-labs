import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { planSequence, sequenceFrameMs, SEQUENCE_MAX_FRAMES } from '../lib/adExport.js';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const p = () => JSON.parse(JSON.stringify(GRAPHIC_DEMOS.loadout.project));
test('planSequence: range, frame count, hard cap, and bounds', () => {
  const pr = p(), total = pr.scenes.reduce((a, s) => a + s.duration, 0);
  const all = planSequence(pr, { fps: 24, from: 0, to: 2 });
  assert.equal(all.frames, 48); assert.equal(all.startMs, 0); assert.equal(all.endMs, 2000);
  assert.equal(sequenceFrameMs(all, 0), 0); assert.equal(sequenceFrameMs(all, 24), 1000);
  assert.ok(sequenceFrameMs(planSequence(pr, { fps: 24, from: total - 0.1, to: total }), 99) < total * 1000);
  assert.throws(() => planSequence(pr, { fps: 24, from: 2, to: 1 }), /after from/);
  assert.throws(() => planSequence(pr, { fps: 24, from: 0, to: total + 5 }), /past the end/);
  assert.throws(() => planSequence(pr, { fps: 60, from: 0, to: Math.min(total, SEQUENCE_MAX_FRAMES / 60 + 1) }), /exceeds/);
});
test('the player has a transparent mode that clears the background and the export script honours it', () => {
  const html = readFileSync(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
  assert.ok(html.includes('transparent=1') && html.includes('html.tr'));
  const still = readFileSync(new URL('../scripts/export-ad-still.mjs', import.meta.url), 'utf8');
  assert.ok(still.includes('omitBackground'));
});
