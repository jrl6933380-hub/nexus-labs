import test from 'node:test';
import assert from 'node:assert/strict';
import { evidencePlan, EVIDENCE_LIMITS } from '../lib/adEvidence.js';
import { promoVideo } from '../lib/adMotionKit.js';

const promo = () => promoVideo({ brand: 'Nexus', hook: 'Build your next idea', points: ['One', 'Two', 'Three'], stat: { value: '60s', label: 'idea to video' }, cta: 'Try Nexus', bpm: 92 });

test('every scene, transition, call to action and the loop seam is covered', () => {
  const p = promo(), plan = evidencePlan(p);
  assert.equal(plan.coverage.scenes_covered, p.scenes.length);
  assert.equal(plan.coverage.transitions_covered, plan.coverage.transitions);
  assert.ok(plan.coverage.transitions >= 3);
  assert.equal(plan.coverage.cta, true);
  assert.equal(plan.coverage.loop_boundary, true);
  assert.ok(plan.shots.length <= EVIDENCE_LIMITS.defaultFrames);
  const ts = plan.shots.map((s) => s.t_ms);
  assert.deepEqual(ts, [...ts].sort((a, b) => a - b));
  assert.ok(ts[0] === 0 && ts[ts.length - 1] < plan.totalMs);
});

test('a short scene is never skipped, even under a tight frame cap', () => {
  const p = promo();
  p.scenes[1].duration = 1.5;
  const plan = evidencePlan(p, { maxFrames: EVIDENCE_LIMITS.minFrames });
  assert.equal(plan.shots.length, EVIDENCE_LIMITS.minFrames);
  assert.ok(plan.shots.some((s) => s.kind === 'cta'));
  assert.ok(plan.shots.some((s) => s.kind === 'loop_start') && plan.shots.some((s) => s.kind === 'loop_end'));
  assert.equal(plan.coverage.transitions_covered, plan.coverage.transitions);
});

test('shots sit inside the transition window and times are valid', () => {
  const p = promo(), plan = evidencePlan(p);
  let start = 0;
  for (const s of p.scenes) {
    const D = s.duration * 1000;
    if (s.transitionOut && s.transitionOut !== 'cut' && p.scenes.indexOf(s) < p.scenes.length - 1) {
      const win = Math.min(s.transitionMs || 400, D * 0.4);
      const mid = plan.shots.find((x) => x.kind === 'transition' && x.scene_id === s.id);
      assert.ok(mid && mid.t_ms > start + D - win && mid.t_ms < start + D, `${s.id} transition midpoint inside its window`);
    }
    start += D;
  }
});

test('bad input is refused', () => {
  assert.throws(() => evidencePlan({ scenes: [] }), /scenes/);
  assert.throws(() => evidencePlan(promo(), { maxFrames: 3 }), /maxFrames/);
  assert.throws(() => evidencePlan(promo(), { maxFrames: 500 }), /maxFrames/);
});
