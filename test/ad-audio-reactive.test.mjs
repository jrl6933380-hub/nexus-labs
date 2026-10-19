import test from 'node:test';
import assert from 'node:assert/strict';
import { envelopesFromPcm, envelopeToSceneParams, AUDIO_MAX_SAMPLES } from '../lib/adAudio.js';
import { validateProjectV2, REGISTRY, LAYER_REACTS } from '../public/ad-vocabulary.mjs';
import { GRAPHIC_DEMOS } from '../lib/adGraphicDemos.js';

const SR = 16000;
// Kick-like 60 Hz bursts on every beat (0.5s) and 5 kHz ticks on every 16th (0.125s).
const track = (seconds = 4) => {
  const out = new Float32Array(seconds * SR);
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    out[i] = 0.9 * Math.sin(2 * Math.PI * 60 * t) * Math.exp(-8 * (t % 0.5)) + 0.4 * Math.sin(2 * Math.PI * 5000 * t) * Math.exp(-30 * (t % 0.125));
  }
  return out;
};
const project = (params) => ({
  specVersion: 2, name: 'Audio test', mood: 'bold', palette: 'ocean-blue', concept: true,
  platform: { format: 'square', lengthSec: 6 },
  scenes: [
    { id: 'a', type: 'graphic', duration: 4, params: { layers: [{ shape: 'circle', x: 50, y: 50, w: 10 }], ...params } },
    { id: 'end', type: 'end_card', duration: 2, params: { cta: 'Go' } },
  ],
});
const ok = (params) => validateProjectV2(project(params));

test('envelopes have the requested rate, length and 0-100 range', () => {
  const env = envelopesFromPcm(track(4), SR, { rate: 20 });
  assert.equal(env.rate, 20);
  assert.equal(env.seconds, 4);
  for (const k of ['audioLow', 'audioMid', 'audioHigh']) {
    assert.equal(env[k].length, 80, k);
    assert.ok(env[k].every((v) => Number.isInteger(v) && v >= 0 && v <= 100), k);
  }
});

test('the low band follows the kick and the high band follows the ticks', () => {
  const env = envelopesFromPcm(track(4), SR, { rate: 20 });
  // Beats fall on samples 0, 10, 20 ... (0.5s at 20/s): the low band peaks there and is quiet in between.
  const onBeat = [0, 10, 20, 30, 40].map((i) => env.audioLow[i]);
  const offBeat = [6, 16, 26, 36, 46].map((i) => env.audioLow[i]);
  assert.ok(onBeat.every((v) => v >= 90), `on-beat low ${onBeat}`);
  assert.ok(offBeat.every((v) => v <= 35), `off-beat low ${offBeat}`);
  const highPeak = Math.max(...env.audioHigh), lowAvg = env.audioLow.reduce((a, b) => a + b, 0) / env.audioLow.length;
  assert.ok(highPeak >= 90);
  assert.ok(lowAvg < 60);
});

test('analysis is deterministic and silence stays at zero', () => {
  const a = envelopesFromPcm(track(2), SR), b = envelopesFromPcm(track(2), SR);
  assert.deepEqual(a, b);
  const silent = envelopesFromPcm(new Float32Array(SR), SR, { rate: 10 });
  assert.ok(silent.audioLow.every((v) => v === 0) && silent.audioHigh.every((v) => v === 0));
});

test('rate, sample rate and length limits', () => {
  assert.throws(() => envelopesFromPcm(track(1), SR, { rate: 1 }), /rate/);
  assert.throws(() => envelopesFromPcm(track(1), SR, { rate: 61 }), /rate/);
  assert.throws(() => envelopesFromPcm(track(1), 1000), /sampleRate/);
  const long = envelopesFromPcm(new Float32Array(SR * 40).fill(0.1), SR, { rate: 60 });
  assert.ok(long.audioLow.length <= AUDIO_MAX_SAMPLES);
  assert.ok(long.seconds <= 30);
});

test('analysed envelopes validate as scene params', () => {
  const params = envelopeToSceneParams(envelopesFromPcm(track(4), SR, { rate: 20 }));
  const r = ok({ ...params, bpm: 120, beatZoom: 0.03, beatShake: 0.5 });
  assert.deepEqual(r.errors, []);
});

test('registry exposes beat, audio and react fields', () => {
  const g = REGISTRY.sceneTypes.find((t) => t.id === 'graphic');
  for (const f of ['bpm', 'beatOffset', 'beatZoom', 'beatShake', 'audioRate', 'audioLow', 'audioMid', 'audioHigh']) assert.ok(g.params[f], f);
  for (const f of ['react', 'rScale', 'rStretch', 'rOpacity', 'rX', 'rY', 'rRot', 'rGlow']) assert.ok(g.params.layers.fields[f], f);
  assert.deepEqual(LAYER_REACTS, ['beat', 'low', 'mid', 'high', 'level']);
});

test('beat and audio params enforce bounds and types', () => {
  assert.equal(ok({ bpm: 120, beatOffset: 0.2, audioRate: 20, audioLow: [0, 50, 100] }).ok, true);
  for (const bad of [{ bpm: 10 }, { bpm: 400 }, { beatZoom: 1 }, { beatShake: 9 }, { audioRate: 1 }, { audioRate: 100 },
    { audioLow: [101] }, { audioLow: [-1] }, { audioLow: ['5'] }, { audioLow: [NaN] }, { audioLow: 'loud' }, { audioMid: new Array(AUDIO_MAX_SAMPLES + 1).fill(1) }]) {
    assert.equal(ok(bad).ok, false, JSON.stringify(bad).slice(0, 60));
  }
  assert.equal(ok({ audioHigh: new Array(AUDIO_MAX_SAMPLES).fill(1) }).ok, true);
});

test('react fields validate per layer', () => {
  const withLayer = (o) => {
    const p = project({});
    p.scenes[0].params.layers = [{ shape: 'rect', x: 50, y: 80, w: 4, h: 4, origin: 'bottom', ...o }];
    return validateProjectV2(p);
  };
  for (const react of LAYER_REACTS) assert.equal(withLayer({ react, rScale: 0.3, rStretch: 6, rOpacity: -0.2, rX: 2, rY: -3, rRot: 20, rGlow: 5 }).ok, true, react);
  for (const bad of [{ react: 'bass' }, { rScale: 5 }, { rStretch: 50 }, { rOpacity: 2 }, { rX: 99 }, { rRot: 400 }, { rGlow: 99 }]) {
    assert.equal(withLayer({ react: 'low', ...bad }).ok, false, JSON.stringify(bad));
  }
});

test('the pulse demo validates and stays well under the config size cap', () => {
  const demo = GRAPHIC_DEMOS.pulse;
  assert.deepEqual(validateProjectV2(demo.project).errors, []);
  assert.ok(JSON.stringify(demo.project).length < 20000);
});
