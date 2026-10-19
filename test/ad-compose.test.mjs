import test from 'node:test';
import assert from 'node:assert/strict';
import { measureEm, wrapLines, fitText, fittedText, makeGrid, alignBoxes, distribute, stack, focalCrop, reflowLayer, recomposeProject, validateBrandKit, checkBrand, applyBrand } from '../lib/adCompose.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

test('measuring is deterministic and caps/wide letters cost more', () => {
  assert.equal(measureEm('Hello'), measureEm('Hello'));
  assert.ok(measureEm('WWW') > measureEm('iii'));
  assert.ok(measureEm('abc', { spacing: 0.1 }) > measureEm('abc'));
});
test('wrapLines wraps on words and keeps long words whole', () => {
  const l = wrapLines('one two three four five six', 8);
  assert.ok(l.length > 1 && l.join(' ') === 'one two three four five six');
  assert.deepEqual(wrapLines('supercalifragilistic', 3), ['supercalifragilistic']);
});
test('fitText fits the box, grows into a bigger box and reports an overflow', () => {
  const small = fitText('Fast same-day plumbing', { x: 0, y: 0, w: 50, h: 20 });
  const big = fitText('Fast same-day plumbing', { x: 0, y: 0, w: 90, h: 40 });
  assert.ok(small.fits && big.fits && big.size >= small.size);
  assert.ok(small.heightPct <= 20.5 && small.widthPct <= 50.5);
  const no = fitText('A very long headline that cannot possibly fit in a tiny box', { x: 0, y: 0, w: 10, h: 4 }, { maxLines: 2 });
  assert.equal(no.fits, false);
  const t = fittedText('Hi', { x: 10, y: 10, w: 80, h: 20 });
  assert.equal(t.layer.shape, 'text'); assert.equal(t.layer.x, 50);
});
test('grid cells tile inside the margins', () => {
  const g = makeGrid({ cols: 4, rows: 4, margin: 8, gutter: 2 });
  const a = g.cell(0, 0), z = g.cell(3, 3);
  assert.equal(a.x, 8); assert.ok(Math.abs(z.x + z.w - 92) < 0.05); assert.ok(Math.abs(g.cell(0, 0, 4, 1).w - 84) < 0.05);
});
test('align, distribute and stack', () => {
  const b = [{ x: 10, y: 0, w: 20, h: 10 }, { x: 40, y: 20, w: 10, h: 10 }, { x: 80, y: 60, w: 10, h: 10 }];
  assert.ok(alignBoxes(b, 'left').every((x) => x.x === 10));
  assert.ok(alignBoxes(b, 'right').every((x) => x.x + x.w === 90));
  const d = distribute(b, 'x');
  assert.equal(d[1].x - (d[0].x + d[0].w), d[2].x - (d[1].x + d[1].w));
  assert.equal(stack([10, 10, 10], { gap: 5 }).height, 40);
  assert.throws(() => alignBoxes(b, 'nope'));
});
test('focalCrop keeps the focus, flags a keep-rect that cannot fit', () => {
  const c = focalCrop({ srcW: 4000, srcH: 3000, focus: { x: 0.8, y: 0.5 }, aspect: 9 / 16 });
  assert.ok(c.x + c.w <= 1 && c.x > 0.5 && c.kept);
  const wide = focalCrop({ srcW: 4000, srcH: 3000, focus: { x: 0.2, y: 0.5 }, aspect: 9 / 16, keep: { x: 0.0, y: 0.1, w: 0.9, h: 0.5 } });
  assert.equal(wide.kept, false);
});
test('reflow keeps margins and recomposes a whole project to a valid one', () => {
  const l = reflowLayer({ shape: 'circle', x: 10, y: 90, w: 10 }, 'landscape', 'portrait');
  assert.ok(l.x > 0 && l.x < 30 && l.y > 80);
  const src = GRAPHIC_DEMOS.loadout.project;
  for (const to of ['portrait', 'landscape']) {
    const out = recomposeProject(src, to);
    assert.equal(out.platform.format, to);
    assert.equal(validateProjectV2(out).ok, true, to);
  }
  assert.equal(recomposeProject(src, src.platform.format), src);
});
test('brand kits validate and police palette, mood and assets', () => {
  assert.equal(validateBrandKit({ name: '', palettes: [], moods: [] }).ok, false);
  const k = validateBrandKit({ name: 'Acme Plumbing', palettes: ['ocean-blue'], moods: ['clean'], logo: 'med-logo1', assets: { products: ['med-van01'] }, voice: 'Plain and friendly' });
  assert.equal(k.ok, true);
  const p = { palette: 'sunset-warm', mood: 'bold', scenes: [{ params: { imageId: 'med-other', layers: [{ imageId: 'med-van01' }] } }] };
  assert.equal(checkBrand(p, k.value).length, 3);
  const fixed = applyBrand(p, k.value);
  assert.equal(fixed.palette, 'ocean-blue'); assert.equal(fixed.mood, 'clean');
  assert.equal(validateBrandKit({ name: 'x', palettes: ['nope'], moods: ['clean'] }).ok, false);
});
