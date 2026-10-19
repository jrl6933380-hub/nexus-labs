import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderManifest, compareManifests, pinWarnings, hashProject, mixPlan, checkFinalFile, parseEbur128 } from '../lib/adFinal.js';

const env = { browser: 'Chromium 141', ffmpeg: '6.1', node: 'v22', os: 'linux', fonts: ['Inter 4'], playerSha: 'abc', vocabularyVersion: '1.0.0' };
test('project hash ignores key order; manifests diff in plain words', () => {
  assert.equal(hashProject({ a: 1, b: { c: 2, d: 3 } }), hashProject({ b: { d: 3, c: 2 }, a: 1 }));
  const a = renderManifest({ project: { x: 1 }, env, assets: { 'med-a': '1' }, options: { fps: 30 } });
  assert.deepEqual(compareManifests(a, renderManifest({ project: { x: 1 }, env, assets: { 'med-a': '1' }, options: { fps: 30 } })), []);
  const b = renderManifest({ project: { x: 2 }, env: { ...env, browser: 'Chromium 142' }, assets: { 'med-a': '2', 'med-b': '1' }, options: { fps: 60 } });
  const d = compareManifests(a, b);
  assert.ok(d.includes('project changed') && d.some((x) => x.startsWith('environment.browser')) && d.some((x) => x.startsWith('asset med-a')) && d.some((x) => x.startsWith('asset med-b')) && d.includes('render options changed'));
  assert.ok(pinWarnings(renderManifest({ project: {}, env: {} })).length >= 5);
  assert.equal(pinWarnings(a).length, 0);
});
test('mixPlan ducks music under narration, places effects, normalizes loudness', () => {
  const p = mixPlan({ video: 'v.mp4', out: 'o.mp4', narration: 'n.wav', music: 'm.mp3', effects: [{ path: 'h.wav', atSec: 1.5 }], durationSec: 10 });
  assert.match(p.filter, /sidechaincompress/); assert.match(p.filter, /adelay=1500\|1500/); assert.match(p.filter, /loudnorm=I=-16/); assert.match(p.filter, /afade=t=out:st=9/);
  assert.ok(!mixPlan({ video: 'v', out: 'o', music: 'm', durationSec: 5 }).filter.includes('sidechaincompress'));
  assert.throws(() => mixPlan({ video: 'v', out: 'o', durationSec: 5 }));
  assert.throws(() => mixPlan({ video: 'v', out: 'o', music: 'm', durationSec: 0 }));
});
test('checkFinalFile passes a good probe and names each failure', () => {
  const good = { streams: [{ codec_type: 'video', codec_name: 'h264', pix_fmt: 'yuv420p', width: 1080, height: 1920, avg_frame_rate: '30/1' }, { codec_type: 'audio', codec_name: 'aac', sample_rate: '48000', channels: 2, duration: '15.0' }], format: { duration: '15.0', size: '900000' } };
  assert.equal(checkFinalFile(good, { width: 1080, height: 1920, fps: 30, durationSec: 15 }, { integratedLufs: -16.4, truePeakDb: -1.6 }).ok, true);
  const bad = { streams: [{ codec_type: 'video', codec_name: 'vp9', pix_fmt: 'yuv444p', width: 1081, height: 1920, avg_frame_rate: '24/1' }], format: { duration: '9', size: '100' } };
  const r = checkFinalFile(bad, { fps: 30, durationSec: 15 });
  assert.equal(r.ok, false);
  for (const name of ['video codec', 'pixel format', 'frame rate', 'even dimensions', 'duration', 'file size', 'has audio stream']) assert.ok(r.failures.some((f) => f.startsWith(name)), name);
  assert.equal(checkFinalFile(good, {}, { integratedLufs: -9, truePeakDb: 0 }).ok, false);
  assert.equal(parseEbur128('x\nSummary:\n  Integrated loudness:\n    I:         -16.2 LUFS\n  True peak:\n    Peak:       -1.4 dBFS').integratedLufs, -16.2);
});
const haveFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0;
test('end to end: mix real audio under a real video and pass the final check', { skip: !haveFfmpeg }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'final-'));
  const f = (name, args) => { const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...args, join(dir, name)]); assert.equal(r.status, 0, r.stderr && r.stderr.toString()); return join(dir, name); };
  const video = f('v.mp4', ['-f', 'lavfi', '-i', 'testsrc2=size=320x240:rate=30:duration=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']);
  const nar = f('n.wav', ['-f', 'lavfi', '-i', 'sine=frequency=220:duration=2']);
  const mus = f('m.wav', ['-f', 'lavfi', '-i', 'anoisesrc=color=pink:duration=4:amplitude=0.3']);
  const fx = f('h.wav', ['-f', 'lavfi', '-i', 'sine=frequency=880:duration=0.2']);
  const out = join(dir, 'final.mp4');
  const r = spawnSync('node', [new URL('../scripts/ad-final.mjs', import.meta.url).pathname, 'mix', '--video', video, '--out', out, '--narration', nar, '--music', mus, '--effect', fx + '@1.5'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.ok(existsSync(out) && JSON.parse(r.stdout).ok);
  const c = spawnSync('node', [new URL('../scripts/ad-final.mjs', import.meta.url).pathname, 'check', '--file', out, '--width', '320', '--height', '240', '--fps', '30', '--duration', '4'], { encoding: 'utf8' });
  assert.equal(c.status, 0, c.stdout);
});
