import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdCampaignStore } from '../lib/adCampaigns.js';
import { projectFromInput } from '../lib/adExport.js';
import { validateProjectV2, withFootageDefaults, totalDurationV2, CINEMATIC } from '../public/ad-vocabulary.mjs';

const project = () => ({
  specVersion: 2, name: 'Footage treatment', mood: 'bold', platform: { format: 'portrait' },
  scenes: [
    { id: 'launch', type: 'graphic', duration: 4, params: { layers: [
      { id: 'clip', shape: 'video', imageId: 'med-test', x: 42, y: 62, w: 100, h: 38, fit: 'contain', trimIn: 3, rate: 1, focusX: 54 },
      { id: 'caption', shape: 'text', x: 8, y: 20, text: 'BUILD.', size: 12 },
    ] } },
    { id: 'close', type: 'end_card', duration: 2, params: { cta: 'Create' } },
  ],
});

function setup(seed) {
  const rows = new Map(seed ? [['ad', JSON.stringify(seed)]] : []);
  let version = 0;
  return createAdCampaignStore({ uuid: () => `v${++version}`, now: () => 123,
    command: async ([op, ...args]) => {
      if (op === 'HGET') return rows.get(args[1]) || null;
      if (op === 'EVAL') {
        const [, , , id, previous, next] = args;
        if ((rows.get(id) || '') !== previous) return 0;
        rows.set(id, next); return 1;
      }
      throw Error(op);
    },
  });
}

test('new saved footage fills the frame and crossfades; read uses the exact saved project', async () => {
  const store = setup(), input = project(), before = structuredClone(input);
  const saved = await store.save('owner', { campaign_id: 'ad', project: input });
  const scene = saved.project.scenes[0], video = scene.params.layers[0];
  assert.deepEqual([video.x, video.y, video.w, video.h, video.fit, video.origin, video.radius], [50, 50, 100, 100, 'cover', 'center', 0]);
  assert.equal(video.footageLayout, 'full_bleed');
  assert.equal(video.imageId, 'med-test'); assert.equal(video.trimIn, 3); assert.equal(video.focusX, 54);
  assert.equal(scene.transitionOut, 'crossfade'); assert.equal(scene.transitionMs, 400);
  assert.deepEqual(scene.params.layers[2], input.scenes[0].params.layers[1]);
  assert.equal(totalDurationV2(saved.project), 6);
  assert.deepEqual(input, before);
  assert.deepEqual((await store.read('owner', 'ad')).project, saved.project);
  assert.deepEqual(validateProjectV2(saved.project).value, saved.project);
  assert.deepEqual(projectFromInput(saved), saved.project);
  assert.equal(saved.project.scenes[1].transitionOut, undefined);
});

test('cinematic defaults add a push-in and a shade under text; author choices and custom layouts are left alone', () => {
  const out = withFootageDefaults(project()).scenes[0].params.layers;
  assert.deepEqual(out.map(l => l.id), ['clip', 'shade', 'caption']);
  assert.deepEqual(out[0].keys, [{ t: 0, scale: 1 }, { t: 4, scale: CINEMATIC.pushInScale, ease: 'smooth' }]);
  assert.deepEqual([out[1].shape, out[1].color, out[1].opacity, out[1].w, out[1].h], ['rect', 'black', CINEMATIC.shadeOpacity, 100, 100]);
  assert.equal(validateProjectV2(withFootageDefaults(project())).ok, true);
  const own = project(); own.scenes[0].params.layers[0].keys = [{ t: 0, scale: 1 }, { t: 4, scale: 1.2 }];
  own.scenes[0].params.layers.splice(1, 0, { shape: 'rect', id: 'mine', x: 50, y: 50, w: 100, h: 100, color: 'black', opacity: 0.5 });
  const kept = withFootageDefaults(own).scenes[0].params.layers;
  assert.deepEqual(kept.map(l => l.id), ['clip', 'mine', 'caption']);
  assert.deepEqual(kept[0].keys, own.scenes[0].params.layers[0].keys);
  const custom = project(); custom.scenes[0].params.layers[0].footageLayout = 'custom';
  assert.deepEqual(withFootageDefaults(custom).scenes[0].params.layers.map(l => l.id), ['clip', 'caption']);
  const noText = project(); noText.scenes[0].params.layers.pop();
  assert.deepEqual(withFootageDefaults(noText).scenes[0].params.layers.map(l => l.id), ['clip']);
});

test('custom inset, explicit cut, and explicit crossfade length survive creation', async () => {
  for (const transitionOut of ['cut', 'crossfade']) {
    const p = project(), scene = p.scenes[0];
    scene.params.layers[0].footageLayout = 'custom';
    scene.transitionOut = transitionOut; scene.transitionMs = 600;
    const saved = await setup().save('owner', { campaign_id: 'ad', project: p });
    assert.deepEqual(saved.project.scenes[0].params.layers[0], scene.params.layers[0]);
    assert.equal(saved.project.scenes[0].transitionOut, transitionOut);
    assert.equal(saved.project.scenes[0].transitionMs, 600);
  }
});

test('old saved footage keeps its thin box and omitted transition when edited', async () => {
  const p = project(), store = setup({ campaign_id: 'ad', baseline: 'old', project: p });
  const saved = await store.save('owner', { campaign_id: 'ad', baseline: 'old', project: { ...p, name: 'Renamed' } });
  assert.deepEqual(saved.project.scenes, p.scenes);
  await assert.rejects(store.save('owner', { campaign_id: 'ad', baseline: 'old', project: p }), e => e.status === 409);
});

test('saved full-bleed treatment remains stable, with custom as an explicit layout override', async () => {
  const store = setup();
  let saved = await store.save('owner', { campaign_id: 'ad', project: project() });
  saved = await store.save('owner', { campaign_id: 'ad', baseline: saved.baseline, project: saved.project });
  assert.equal(saved.project.scenes[0].params.layers[0].h, 100);
  const edited = structuredClone(saved.project);
  Object.assign(edited.scenes[0].params.layers[0], { footageLayout: 'custom', w: 80, h: 38 });
  const custom = await store.save('owner', { campaign_id: 'ad', baseline: saved.baseline, project: edited });
  assert.equal(custom.project.scenes[0].params.layers[0].h, 38);
});

test('full-bleed rejects effects that expose the background; custom enables deliberate composites', () => {
  for (const extra of [
    { keys: [{ t: 0, x: 42 }, { t: 4, x: 51 }] },
    { scale: 0.5 }, { rotate: 15 }, { motion: 'slide_up' },
    { mask: 'fade_edges' }, { key: 'green' }, { cropL: 10 },
  ]) {
    const p = project(); Object.assign(p.scenes[0].params.layers[0], extra);
    const checked = validateProjectV2(withFootageDefaults(p));
    assert.equal(checked.ok, false, JSON.stringify(extra));
    assert.match(checked.errors.join(' '), /footageLayout: custom/);
    p.scenes[0].params.layers[0].footageLayout = 'custom';
    assert.equal(validateProjectV2(withFootageDefaults(p)).ok, true, JSON.stringify(extra));
  }
});

test('invalid layout and non-video usage are rejected; validation alone preserves legacy layout', () => {
  const p = project();
  assert.deepEqual(validateProjectV2(p).value.scenes, p.scenes);
  p.scenes[0].params.layers[0].footageLayout = 'tiny';
  assert.equal(validateProjectV2(p).ok, false);
  delete p.scenes[0].params.layers[0].footageLayout;
  p.scenes[0].params.layers[1].footageLayout = 'full_bleed';
  assert.match(validateProjectV2(p).errors.join(' '), /only video/);
});
