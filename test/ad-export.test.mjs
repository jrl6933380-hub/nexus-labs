import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import {
  EXPORT_LIMITS, normalizeExportOptions, projectFromInput, projectTotalMs, planExport, frameTimeMs, seedPlayerHtml,
  ffmpegArgs, verifyCaptureInfo, verifyFrameAck, pngSize, sha256Hex, framesFingerprint, buildManifest, defaultExportName,
} from '../lib/adExport.js';

const project = {
  specVersion: 2, name: 'Export check', brand: 'CHECK', initial: 'C', mood: 'bold', palette: 'midnight-gold',
  platform: { format: 'portrait', lengthSec: 6 }, concept: true,
  scenes: [
    { id: 'a', type: 'hook_text', duration: 3, params: { headline: 'Hello </script> & "world"', textAnim: 'fade_up' }, camera: 'push_in', background: 'grain', transitionOut: 'crossfade', transitionMs: 400 },
    { id: 'b', type: 'end_card', duration: 3, params: { cta: 'Call now' }, background: 'orbits' },
  ],
};
const PLAYER = readFileSync(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
const goodInfo = (plan) => ({ frozen: true, format: plan.format, logicalWidth: plan.logicalWidth, logicalHeight: plan.logicalHeight, viewport: { width: plan.logicalWidth, height: plan.logicalHeight }, dpr: plan.scale, vocabularyVersion: plan.vocabularyVersion, totalMs: plan.totalMs, sceneCount: plan.sceneCount, errors: [] });

test('the sample project used here is a valid v2 ad', () => {
  assert.equal(validateProjectV2(project).ok, true);
});

test('options: defaults, strings from the CLI, and clear errors', () => {
  assert.deepEqual(normalizeExportOptions(), { fps: 30, scale: 2, crf: 18, audio: null });
  assert.deepEqual(normalizeExportOptions({ fps: '60', scale: '1', crf: '20', audio: 'a.mp3' }), { fps: 60, scale: 1, crf: 20, audio: 'a.mp3' });
  assert.deepEqual(normalizeExportOptions({ fps: undefined, audio: '' }), { fps: 30, scale: 2, crf: 18, audio: null });
  assert.throws(() => normalizeExportOptions({ fps: 25 }), /fps must be one of 24, 30, 60/);
  assert.throws(() => normalizeExportOptions({ scale: 4 }), /scale must be one of 1, 2, 3/);
  assert.throws(() => normalizeExportOptions({ crf: 5 }), /crf/);
  assert.throws(() => normalizeExportOptions({ crf: 18.5 }), /crf/);
});

test('input: accepts a bare project or a saved record, refuses legacy and malformed ads', () => {
  assert.deepEqual(projectFromInput(project), validateProjectV2(project).value);
  assert.deepEqual(projectFromInput({ campaign_id: 'x', baseline: 'y', project }), validateProjectV2(project).value);
  assert.throws(() => projectFromInput({ specVersion: 1, name: 'legacy' }), /Not a valid vocabulary \(v2\) ad/);
  assert.throws(() => projectFromInput(null), /Not a valid vocabulary/);
  assert.throws(() => projectFromInput({ ...project, scenes: [project.scenes[0]] }), /Not a valid vocabulary/);
});

test('plan: frame counts, sizes and times for every format and fps', () => {
  const plan = planExport(project, { fps: 30, scale: 2 });
  assert.equal(projectTotalMs(project), 6000);
  assert.equal(plan.frames, 180);
  assert.equal(plan.durationSec, 6);
  assert.deepEqual([plan.logicalWidth, plan.logicalHeight, plan.width, plan.height], [360, 640, 720, 1280]);
  assert.equal(plan.concept, true);
  assert.equal(frameTimeMs(plan, 0), 0);
  assert.equal(frameTimeMs(plan, 1), 1000 / 30);
  assert.ok(frameTimeMs(plan, plan.frames - 1) < plan.totalMs, 'the last frame is before the end of the ad');
  assert.equal(planExport(project, { fps: 24, scale: 1 }).frames, 144);
  assert.equal(planExport(project, { fps: 60 }).frames, 360);
  for (const [format, w, h] of [['square', 560, 560], ['landscape', 800, 450]]) {
    const p = planExport({ ...project, platform: { format } }, { scale: 3 });
    assert.deepEqual([p.logicalWidth, p.logicalHeight, p.width, p.height], [w, h, w * 3, h * 3]);
    assert.equal(p.width % 2, 0, 'even width for yuv420p');
    assert.equal(p.height % 2, 0, 'even height for yuv420p');
  }
  assert.equal(planExport({ ...project, scenes: [{ ...project.scenes[0], duration: 1.5 }, { ...project.scenes[1], duration: 1.5 }] }, { fps: 30 }).frames, 90);
  const longest = { ...project, scenes: Array.from({ length: 2 }, (_, i) => ({ ...project.scenes[i], duration: 15 })) };
  assert.equal(planExport(longest, { fps: 60 }).frames, 1800);
  assert.ok(EXPORT_LIMITS.maxFrames >= 30 * 60, 'a 30 second ad at 60 fps fits');
});

test('seeding: the project becomes inert JSON data and round-trips; text cannot close the tag', () => {
  const html = seedPlayerHtml(PLAYER, project);
  assert.equal(html.split('id="ad-project"').length, 2);
  const m = html.match(/<script id="ad-project" type="application\/json">(.*?)<\/script>/s);
  assert.deepEqual(JSON.parse(m[1]), project);
  assert.ok(!m[1].includes('</script>'));
  assert.ok(m[1].includes('\\u003c/script>'));
  assert.ok(html.indexOf('id="ad-project"') < html.indexOf('window.renderAdFrame='), 'seed comes before the player script');
  assert.throws(() => seedPlayerHtml('<html></html>', project), /exactly one stage/);
  assert.throws(() => seedPlayerHtml(PLAYER + '<div id="stage"></div>', project), /exactly one stage/);
});

test('ffmpeg arguments: png on stdin to h264 yuv420p, bt709 tags, optional audio with a fade-out', () => {
  const plan = planExport(project, { fps: 30, scale: 2, crf: 20 });
  const a = ffmpegArgs(plan, 'out.mp4');
  assert.equal(a.at(-1), 'out.mp4');
  assert.deepEqual(a.slice(a.indexOf('-f'), a.indexOf('-f') + 2), ['-f', 'image2pipe']);
  assert.ok(a.includes('pipe:0'));
  assert.equal(a[a.indexOf('-crf') + 1], '20');
  assert.equal(a[a.indexOf('-r') + 1], '30');
  for (const flag of ['-colorspace', '-color_primaries', '-color_trc']) assert.equal(a[a.indexOf(flag) + 1], 'bt709');
  assert.match(a[a.indexOf('-vf') + 1], /format=yuv420p/);
  assert.ok(a.includes('+faststart'));
  assert.ok(!a.includes('-c:a'), 'no audio codec by default');
  assert.equal(a.filter((x) => x === '-i').length, 1, 'one input (the frames) by default');
  const withAudio = ffmpegArgs(planExport(project, { fps: 30, audio: 'music.mp3' }), 'out.mp4');
  assert.equal(withAudio.filter((x) => x === '-i').length, 2);
  assert.ok(withAudio.includes('music.mp3'));
  assert.ok(withAudio.includes('1:a:0'));
  assert.equal(withAudio[withAudio.indexOf('-af') + 1], 'afade=t=out:st=5:d=1');
  assert.equal(withAudio[withAudio.indexOf('-t') + 1], '6');
});

test('capture setup check: frozen, same size, DPR and vocabulary version, no page errors', () => {
  const plan = planExport(project, { scale: 2 });
  assert.doesNotThrow(() => verifyCaptureInfo(goodInfo(plan), plan));
  const bad = (patch, re) => assert.throws(() => verifyCaptureInfo({ ...goodInfo(plan), ...patch }, plan), re);
  bad({ frozen: false }, /not frozen/);
  bad({ dpr: 1 }, /dpr 1 != 2/);
  bad({ viewport: { width: 400, height: 640 } }, /viewport/);
  bad({ vocabularyVersion: '9.9.9' }, /vocabulary/);
  bad({ totalMs: 5000 }, /duration/);
  bad({ sceneCount: 5 }, /scene count/);
  bad({ errors: ['boom'] }, /page errors: boom/);
  assert.throws(() => verifyCaptureInfo(undefined, plan), /did not report/);
});

test('frame acknowledgement check: ready, seq = index + 1, exact time, DOM stamp agrees', () => {
  const t = 1000 / 30;
  const ok = { ack: { ready: true, seq: 2, timeMs: t, sceneId: 'a', sceneIndex: 0 }, stampSeq: '2', stampMs: String(t) };
  assert.doesNotThrow(() => verifyFrameAck(ok, { index: 1, timeMs: t }));
  const fails = (res, re) => assert.throws(() => verifyFrameAck(res, { index: 1, timeMs: t }), re);
  fails({ ...ok, ack: { ...ok.ack, ready: false } }, /not acknowledged/);
  fails({ ...ok, ack: undefined }, /not acknowledged/);
  fails({ ...ok, ack: { ...ok.ack, seq: 3 }, stampSeq: '3' }, /seq 3 != 2/);
  fails({ ...ok, ack: { ...ok.ack, timeMs: 50 }, stampMs: '50' }, /time 50/);
  fails({ ...ok, stampSeq: '1' }, /stamp seq/);
  fails({ ...ok, stampMs: '99' }, /stamp time/);
});

test('png size, hashing, fingerprint and manifest', () => {
  const header = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(header);
  header.writeUInt32BE(720, 16);
  header.writeUInt32BE(1280, 20);
  assert.deepEqual(pngSize(header), { width: 720, height: 1280 });
  assert.throws(() => pngSize(Buffer.from('not a png at all, definitely not one')), /Not a PNG/);
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(framesFingerprint(['a', 'b']), framesFingerprint(['a', 'b']));
  assert.notEqual(framesFingerprint(['a', 'b']), framesFingerprint(['b', 'a']), 'order matters');
  const plan = planExport(project, { fps: 30, scale: 2 });
  const m = buildManifest(plan, project, { framesSha256: 'f'.repeat(64), frameBytes: 123 });
  assert.deepEqual([m.frames, m.fps, m.width, m.height, m.concept, m.audio, m.frameBytes], [180, 30, 720, 1280, true, 'none', 123]);
  assert.equal(m.projectSha256, sha256Hex(JSON.stringify(project)));
  assert.equal(defaultExportName(project, plan), 'export-check-portrait-30fps.mp4');
  assert.equal(defaultExportName({ name: '  !!  ' }, plan), 'ad-portrait-30fps.mp4');
});

test('the export script exists and drives the player only through its capture barrier', () => {
  const script = readFileSync(new URL('../scripts/export-ad-mp4.mjs', import.meta.url), 'utf8');
  for (const needle of ['window.__capture(', 'window.__captureInfo()', '?capture=1', 'verifyFrameAck', 'verifyCaptureInfo', 'seedPlayerHtml', "route('**/*'", 'concept badge']) {
    assert.ok(script.includes(needle), `script uses ${needle}`);
  }
  assert.doesNotMatch(script, /__seek|setTimeout|waitForTimeout/, 'no sleeping or wall-clock waiting between frames');
  const help = spawnSync(process.execPath, [new URL('../scripts/export-ad-mp4.mjs', import.meta.url).pathname, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--project/);
  const missing = spawnSync(process.execPath, [new URL('../scripts/export-ad-mp4.mjs', import.meta.url).pathname], { encoding: 'utf8' });
  assert.equal(missing.status, 1);
});

// Needs Chromium (Playwright) and ffmpeg. Run it with: AD_EXPORT_E2E=1 node --test test/ad-export.test.mjs
test('end to end: a short ad exports to a real, reproducible MP4', { skip: !process.env.AD_EXPORT_E2E && 'set AD_EXPORT_E2E=1 (needs Chromium and ffmpeg)' }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'ad-export-e2e-'));
  try {
    const input = join(dir, 'ad.json');
    writeFileSync(input, JSON.stringify({ project }));
    const run = (name) => {
      const out = join(dir, `${name}.mp4`);
      const res = spawnSync(process.execPath, ['scripts/export-ad-mp4.mjs', '--project', input, '--out', out, '--fps', '24', '--scale', '1'], { encoding: 'utf8', cwd: new URL('..', import.meta.url).pathname });
      assert.equal(res.status, 0, res.stderr);
      return { out, summary: JSON.parse(res.stdout.trim().split('\n').at(-1)) };
    };
    const a = run('a'), b = run('b');
    assert.equal(a.summary.frames, 144);
    assert.equal(a.summary.framesSha256, b.summary.framesSha256, 'same input gives identical frames');
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=codec_name,width,height,nb_read_frames,pix_fmt,color_space', '-of', 'json', a.out], { encoding: 'utf8' })).streams[0];
    assert.deepEqual([probe.codec_name, probe.width, probe.height, probe.nb_read_frames, probe.pix_fmt, probe.color_space], ['h264', 360, 640, '144', 'yuv420p', 'bt709']);
    assert.ok(existsSync(a.out.replace(/\.mp4$/, '.manifest.json')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
