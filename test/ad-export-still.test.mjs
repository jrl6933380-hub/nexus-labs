import test from 'node:test';
import assert from 'node:assert/strict';
import { planStill, defaultStillName, projectFromInput, STILL_DEFAULT_PROGRESS } from '../lib/adExport.js';

const project = projectFromInput({
  specVersion: 2, name: 'Still test', mood: 'bold', palette: 'midnight-gold', concept: true,
  platform: { format: 'portrait', lengthSec: 15 },
  scenes: [
    { id: 'a', type: 'hook_text', duration: 4, params: { headline: 'Hello' } },
    { id: 'b', type: 'end_card', duration: 6, params: { cta: 'Go' } },
  ],
});

test('still defaults to the middle of the ad at scale 2', () => {
  const plan = planStill(project);
  assert.equal(plan.timeMs, 5000);
  assert.equal(plan.width, 720);
  assert.equal(plan.height, 1280);
});

test('--at picks a time in seconds and rejects times past the end', () => {
  assert.equal(planStill(project, { at: '3.5' }).timeMs, 3500);
  assert.equal(planStill(project, { at: 10 }).timeMs, 10000);
  assert.throws(() => planStill(project, { at: 10.5 }), /past the end/);
  assert.throws(() => planStill(project, { at: -1 }), /0 or more/);
  assert.throws(() => planStill(project, { at: 'abc' }), /seconds/);
});

test('--scene uses the scene start plus progress, default settled', () => {
  assert.equal(planStill(project, { scene: 'a' }).timeMs, 4000 * STILL_DEFAULT_PROGRESS);
  assert.equal(planStill(project, { scene: 'b', progress: 0 }).timeMs, 4000);
  assert.equal(planStill(project, { scene: 'b', progress: '0.5' }).timeMs, 7000);
  assert.throws(() => planStill(project, { scene: 'nope' }), /Unknown scene.*a, b/);
  assert.throws(() => planStill(project, { scene: 'a', progress: 2 }), /0 to 1/);
});

test('--at and --scene cannot be combined, scale is validated', () => {
  assert.throws(() => planStill(project, { at: 1, scene: 'a' }), /not both/);
  assert.equal(planStill(project, { scale: 1 }).width, 360);
  assert.throws(() => planStill(project, { scale: 5 }), /scale/);
});

test('still file name carries format and time', () => {
  assert.equal(defaultStillName(project, planStill(project, { at: 2 })), 'still-test-portrait-2000ms.png');
});
