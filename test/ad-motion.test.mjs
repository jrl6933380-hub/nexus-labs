import test from 'node:test';
import assert from 'node:assert/strict';
import { bezierEase, CURVES, spring, springSettle, sampleKeys, pathPoint, pathKeys, anticipation, followThrough, hold, sequence, POSES, poseKeys, mergeKeys, MAX_KEYS } from '../lib/adMotion.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const withKeys = (keys) => {
  const p = JSON.parse(JSON.stringify(GRAPHIC_DEMOS.loadout.project));
  p.scenes[0].params.layers = [{ shape: 'circle', x: 50, y: 50, w: 10, keys }];
  return validateProjectV2(p);
};

test('bezier easing is monotone for ease curves, hits the ends, and overshoots for back_out', () => {
  const f = CURVES.ease_in_out;
  assert.equal(f(0), 0); assert.equal(f(1), 1);
  let prev = -1; for (let i = 0; i <= 20; i++) { const v = f(i / 20); assert.ok(v >= prev); prev = v; }
  assert.ok(Math.max(...Array.from({ length: 40 }, (_, i) => CURVES.back_out(i / 39))) > 1.02);
  assert.throws(() => bezierEase(2, 0, 0.5, 1));
});
test('spring converges to 1, overshoots when underdamped, not when overdamped, and is repeatable', () => {
  const f = spring({ stiffness: 200, damping: 8 });
  assert.ok(Math.max(...Array.from({ length: 200 }, (_, i) => f(i / 100))) > 1.05);
  assert.ok(Math.abs(f(5) - 1) < 1e-3);
  const o = spring({ stiffness: 100, damping: 40 });
  assert.ok(Math.max(...Array.from({ length: 200 }, (_, i) => o(i / 50))) <= 1.0001);
  assert.equal(f(0.37), spring({ stiffness: 200, damping: 8 })(0.37));
  assert.ok(springSettle({ stiffness: 170, damping: 14 }) > 0.2);
});
test('sampleKeys runs from..to, respects the key cap and validates in a scene', () => {
  const k = sampleKeys({ x: { from: 10, to: 90, curve: 'snappy' }, scale: { from: 0.5, to: 1, spring: { stiffness: 200, damping: 10 } } }, { duration: 1.2, n: 16 });
  assert.equal(k[0].x, 10); assert.equal(k[k.length - 1].x, 90); assert.equal(k[0].t, 0);
  assert.ok(k.length <= MAX_KEYS && Math.abs(k[k.length - 1].scale - 1) < 0.05);
  assert.equal(withKeys(k).ok, true, JSON.stringify(withKeys(k).errors));
  assert.equal(sampleKeys({ x: { from: 0, to: 1 } }, { n: 99 }).length, MAX_KEYS);
  assert.throws(() => sampleKeys({ speed: { from: 0, to: 1 } }));
  assert.throws(() => sampleKeys({ x: { from: 0, to: 1, curve: 'nope' } }));
});
test('curved paths follow the control points and can orient the layer', () => {
  const pts = [{ x: 10, y: 80 }, { x: 40, y: 10 }, { x: 90, y: 80 }];
  assert.deepEqual(pathPoint(pts, 0), { x: 10, y: 80 });
  const k = pathKeys(pts, { duration: 2, n: 12, orient: true });
  assert.ok(Math.min(...k.map((q) => q.y)) < 50 && k[0].x === 10 && k[k.length - 1].x === 90);
  assert.ok(k.some((q) => q.rotate !== k[0].rotate));
  assert.equal(withKeys(k).ok, true);
  assert.throws(() => pathPoint([{ x: 0, y: 0 }], 0.5));
});
test('anticipation pulls back first, follow-through overshoots then lands, hold and sequence compose', () => {
  const a = anticipation('x', 20, 80);
  assert.ok(a[1].x < 20 && a[a.length - 1].x === 80);
  const f = followThrough('x', 20, 80);
  assert.ok(Math.max(...f.map((q) => q.x)) > 80 && Math.abs(f[f.length - 1].x - 80) < 3);
  const h = hold(a, 0.5); assert.equal(h[h.length - 1].x, 80); assert.equal(h[h.length - 1].t, +(a[a.length - 1].t + 0.5).toFixed(3));
  const s = sequence(a, f);
  assert.ok(s.every((q, i) => i === 0 || q.t > s[i - 1].t));
  assert.equal(withKeys(s.slice(0, MAX_KEYS)).ok, true);
});
test('poses offset the resting transform and merge onto one timeline', () => {
  const k = poseKeys({ x: 50, y: 70, rotate: 0, scale: 1 }, [{ pose: 'crouch', t: 0.2 }, { pose: 'jump', t: 0.5, ease: 'bounce' }, { pose: 'rest', t: 0.9 }]);
  assert.equal(k[0].y, 71.4); assert.equal(k[1].y, 64); assert.equal(k[2].y, 70);
  assert.throws(() => poseKeys({}, [{ pose: 'nope', t: 0 }]));
  assert.ok(POSES.punch.rotate > 0);
  const m = mergeKeys([{ t: 0, x: 1 }, { t: 1, x: 2 }], [{ t: 0.5, scale: 2 }, { t: 1, scale: 1 }]);
  assert.equal(m.length, 3); assert.equal(m[2].x, 2); assert.equal(m[2].scale, 1);
  assert.equal(withKeys(k).ok, true);
});
