import test from 'node:test';
import assert from 'node:assert/strict';
import { beforeAfterVideo, showcaseVideo, progressBar, checklist, confetti, versus } from '../lib/adMotionTemplates.js';

test('before/after and showcase templates validate across styles and formats', () => {
  for (const style of ['bright', 'warm', 'cool']) for (const format of ['portrait', 'landscape', 'square']) {
    const a = beforeAfterVideo({ brand: 'Nexus', hook: 'Stop doing it by hand', bars: [{ label: 'Speed', before: 20, after: 95 }], style, format, bpm: 92 });
    const b = showcaseVideo({ brand: 'Nexus', hook: 'All in one', features: ['One', 'Two', 'Three'], stat: { value: '10x', label: 'faster' }, style, format, bpm: 92 });
    assert.equal(a.specVersion, 2); assert.equal(b.specVersion, 2);
  }
});

test('new builders stay in the layer budget and clamp their input', () => {
  assert.ok(progressBar({ pct: 250 }).every((l) => !('w' in l) || l.w > 0));
  assert.equal(checklist({ items: Array(9).fill('x') }).length, 18);
  assert.ok(confetti({ count: 500 }).every((l) => l.emit <= 40));
  assert.equal(versus().length, 4);
  assert.throws(() => beforeAfterVideo({ hook: 'x' }), /brand/);
  assert.throws(() => showcaseVideo({ brand: 'x' }), /hook/);
});
