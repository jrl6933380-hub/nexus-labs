#!/usr/bin/env node
// Final sound and final-file checks.
//   node scripts/ad-final.mjs mix   --video in.mp4 --out final.mp4 [--narration n.wav] [--music m.mp3] [--effect hit.wav@1.5[:gainDb]]... [--lufs -16]
//   node scripts/ad-final.mjs check --file final.mp4 [--width 1080 --height 1920 --fps 30 --duration 15 --no-audio]
//   node scripts/ad-final.mjs manifest --project ad.json [--images images.json] --out render.manifest.json [--chromium path] [--fonts "Inter 4.0,Georgia"] [--fps 30]
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import os from 'node:os';
import { mixPlan, checkFinalFile, parseEbur128, renderManifest } from '../lib/adFinal.js';

const argv = process.argv.slice(2);
const mode = argv.shift();
const opts = { effect: [] };
for (let i = 0; i < argv.length; i++) {
  const k = argv[i];
  if (!k.startsWith('--')) continue;
  const key = k.slice(2);
  if (key === 'no-audio') { opts.noAudio = true; continue; }
  const v = argv[++i];
  if (key === 'effect') opts.effect.push(v); else opts[key] = v;
}
const run = (cmd, args) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const fail = (m) => { console.log(JSON.stringify({ ok: false, error: m })); process.exit(1); };
const probe = (file) => { const r = run('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]); if (r.status !== 0) fail('ffprobe failed: ' + r.stderr.slice(0, 300)); return JSON.parse(r.stdout); };
const loudness = (file) => { const r = run('ffmpeg', ['-nostats', '-hide_banner', '-i', file, '-vn', '-af', 'ebur128=peak=true', '-f', 'null', '-']); return parseEbur128(r.stderr); };

if (mode === 'mix') {
  if (!opts.video || !opts.out) fail('--video and --out are required');
  const dur = Number(probe(opts.video).format.duration);
  const effects = opts.effect.map((e) => { const [p, rest = '0'] = e.split('@'); const [at, gain] = rest.split(':'); return { path: p, atSec: Number(at), ...(gain !== undefined ? { gainDb: Number(gain) } : {}) }; });
  const plan = mixPlan({ video: opts.video, out: opts.out, narration: opts.narration || null, music: opts.music || null, effects, durationSec: dur, settings: opts.lufs ? { targetLufs: Number(opts.lufs) } : {} });
  const r = run('ffmpeg', plan.args);
  if (r.status !== 0) fail('ffmpeg failed: ' + r.stderr.slice(0, 500));
  const report = checkFinalFile(probe(opts.out), { durationSec: Math.round(dur * 100) / 100 }, loudness(opts.out));
  console.log(JSON.stringify({ ok: report.ok, out: opts.out, settings: plan.settings, report }, null, 2));
  process.exit(report.ok ? 0 : 2);
} else if (mode === 'check') {
  if (!opts.file) fail('--file is required');
  const exp = { expectAudio: !opts.noAudio };
  for (const k of ['width', 'height', 'fps']) if (opts[k]) exp[k] = Number(opts[k]);
  if (opts.duration) exp.durationSec = Number(opts.duration);
  const report = checkFinalFile(probe(opts.file), exp, opts.noAudio ? null : loudness(opts.file));
  console.log(JSON.stringify({ ok: report.ok, file: opts.file, ...report }, null, 2));
  process.exit(report.ok ? 0 : 2);
} else if (mode === 'manifest') {
  if (!opts.project || !opts.out) fail('--project and --out are required');
  const project = JSON.parse(await readFile(opts.project, 'utf8'));
  const images = opts.images ? JSON.parse(await readFile(opts.images, 'utf8')) : {};
  const assets = Object.fromEntries(Object.entries(images).map(([id, v]) => [id, createHash('sha256').update(String(v.src || v.data || '')).digest('hex')]));
  const ff = run('ffmpeg', ['-version']).stdout.split('\n')[0].replace(/^ffmpeg version\s+/, '').split(' ')[0];
  const chromium = opts.chromium ? run(opts.chromium, ['--version']).stdout.trim() : 'unknown';
  const player = await readFile(new URL('../public/ad-designs/vocabulary-player.html', import.meta.url), 'utf8');
  const { VOCABULARY_VERSION } = await import('../public/ad-vocabulary.mjs').catch(() => ({}));
  const manifest = renderManifest({ project, assets, env: { browser: chromium, ffmpeg: ff, node: process.version, os: `${os.platform()} ${os.release()}`, fonts: opts.fonts ? opts.fonts.split(',') : [], playerSha: createHash('sha256').update(player).digest('hex'), vocabularyVersion: VOCABULARY_VERSION || 'unknown' }, options: { fps: opts.fps ? Number(opts.fps) : undefined } });
  await writeFile(opts.out, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ ok: true, out: opts.out, environmentSha256: manifest.environmentSha256 }));
} else fail('mode: mix | check | manifest');
