// Rendering consistency and final sound. Pure planning and checking; scripts/ad-final.mjs runs ffmpeg/ffprobe with these.
import { createHash } from 'node:crypto';

// ---- pinned render environment ----------------------------------------------------------------------
// A render manifest records everything that can change pixels. Two renders are only comparable (and a before/after
// diff only meaningful) when their environment hashes match.
const sha = (v) => createHash('sha256').update(typeof v === 'string' || Buffer.isBuffer(v) ? v : JSON.stringify(v)).digest('hex');
export const hashProject = (project) => sha(canonical(project));
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}
// env: { browser: 'Chromium 141.0', ffmpeg: '6.1.1', node: 'v22.22.0', os, fonts: ['Inter 4.0', ...], playerSha, vocabularyVersion }
// assets: { id: sha256-of-bytes-or-version }
export function renderManifest({ project, env = {}, assets = {}, options = {} }) {
  const environment = { browser: env.browser || 'unknown', ffmpeg: env.ffmpeg || 'unknown', node: env.node || 'unknown', os: env.os || 'unknown', fonts: [...(env.fonts || [])].sort(), playerSha: env.playerSha || 'unknown', vocabularyVersion: env.vocabularyVersion || 'unknown' };
  const assetEntries = Object.fromEntries(Object.keys(assets).sort().map((k) => [k, assets[k]]));
  return { manifestVersion: 1, projectSha256: hashProject(project), environment, environmentSha256: sha(environment), assets: assetEntries, assetsSha256: sha(assetEntries), options: canonical(options) };
}
// What differs between two manifests, in plain words (empty list = reproducible).
export function compareManifests(a, b) {
  const d = [];
  if (a.projectSha256 !== b.projectSha256) d.push('project changed');
  for (const k of Object.keys(a.environment)) if (JSON.stringify(a.environment[k]) !== JSON.stringify(b.environment[k])) d.push(`environment.${k}: ${JSON.stringify(a.environment[k])} -> ${JSON.stringify(b.environment[k])}`);
  const ids = new Set([...Object.keys(a.assets), ...Object.keys(b.assets)]);
  for (const id of [...ids].sort()) if (a.assets[id] !== b.assets[id]) d.push(`asset ${id}: ${a.assets[id] ?? 'missing'} -> ${b.assets[id] ?? 'missing'}`);
  if (JSON.stringify(a.options) !== JSON.stringify(b.options)) d.push('render options changed');
  return d;
}
// Warn about environment parts that make output non-portable (unpinned or unknown).
export function pinWarnings(m) {
  const w = [];
  for (const k of ['browser', 'ffmpeg', 'node', 'playerSha', 'vocabularyVersion']) if (m.environment[k] === 'unknown') w.push(`${k} is not recorded`);
  if (!m.environment.fonts.length) w.push('no fonts recorded: text may reflow on another machine');
  return w;
}

// ---- narration / music / effects mix with ducking ---------------------------------------------------
export const MIX_DEFAULTS = Object.freeze({ narrationDb: 0, musicDb: -14, effectsDb: -6, duckDb: -12, duckThreshold: 0.03, duckRatio: 8, attackMs: 20, releaseMs: 350, fadeOutSec: 1, targetLufs: -16, truePeakDb: -1.5, sampleRate: 48000 });
const dbToGain = (db) => Math.pow(10, db / 20);
// inputs: { narration?: path, music?: path, effects?: [{path, atSec, gainDb?}] }, durationSec of the video.
// Returns { args (ffmpeg args after the video input), filter } producing one stereo AAC track:
// music is ducked under narration (sidechain), effects are placed at their times, then loudness-normalized.
export function mixPlan({ video, out, narration = null, music = null, effects = [], durationSec, settings = {} }) {
  const s = { ...MIX_DEFAULTS, ...settings };
  if (!(durationSec > 0)) throw new Error('durationSec is required');
  if (!narration && !music && !effects.length) throw new Error('nothing to mix');
  const args = ['-y', '-loglevel', 'error', '-i', video];
  const parts = [];
  const buses = [];
  let n = 1;
  const input = (p) => { args.push('-i', p); return n++; };
  const prep = (i, label, db, extra = '') => parts.push(`[${i}:a]aresample=${s.sampleRate},aformat=channel_layouts=stereo,volume=${dbToGain(db).toFixed(4)}${extra}[${label}]`);
  let nIdx = null;
  // pad narration with silence to the full length, or the sidechain (and the music under it) would end with the voice
  if (narration) { nIdx = input(narration); prep(nIdx, 'nar', s.narrationDb, `,apad=whole_dur=${durationSec}`); }
  if (music) {
    const m = input(music);
    prep(m, 'mus0', s.musicDb, `,atrim=0:${durationSec},afade=t=out:st=${Math.max(0, durationSec - s.fadeOutSec)}:d=${s.fadeOutSec}`);
    if (narration) {
      parts.push('[nar]asplit=2[nar_a][nar_b]');
      parts.push(`[mus0][nar_b]sidechaincompress=threshold=${s.duckThreshold}:ratio=${s.duckRatio}:attack=${s.attackMs}:release=${s.releaseMs}:makeup=1[mus]`);
      buses.push('[nar_a]', '[mus]');
    } else buses.push('[mus0]');
  } else if (narration) buses.push('[nar]');
  effects.forEach((e, i) => {
    const x = input(e.path), ms = Math.max(0, Math.round((e.atSec || 0) * 1000));
    prep(x, `fx${i}`, e.gainDb ?? s.effectsDb, `,adelay=${ms}|${ms}`);
    buses.push(`[fx${i}]`);
  });
  parts.push(`${buses.join('')}amix=inputs=${buses.length}:normalize=0:duration=longest,atrim=0:${durationSec},loudnorm=I=${s.targetLufs}:TP=${s.truePeakDb}:LRA=11[aout]`);
  args.push('-filter_complex', parts.join(';'), '-map', '0:v:0', '-map', '[aout]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-ar', String(s.sampleRate), '-movflags', '+faststart', '-shortest', out);
  return { args, filter: parts.join(';'), settings: s };
}

// ---- final encoded-file checks ----------------------------------------------------------------------
export const FINAL_EXPECT = Object.freeze({ videoCodec: 'h264', pixFmt: 'yuv420p', audioCodec: 'aac', minSampleRate: 44100, durationTolSec: 0.25, lufsTarget: -16, lufsTol: 2, maxTruePeakDb: -0.5, minFileBytes: 20000 });
// probe: parsed `ffprobe -show_streams -show_format -of json`; loud: {integratedLufs, truePeakDb} from ebur128 (optional).
export function checkFinalFile(probe, expected = {}, loud = null) {
  const e = { ...FINAL_EXPECT, ...expected };
  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok: !!ok, detail });
  const v = (probe.streams || []).find((s) => s.codec_type === 'video');
  const a = (probe.streams || []).find((s) => s.codec_type === 'audio');
  add('has video stream', v, v ? `${v.codec_name} ${v.width}x${v.height}` : 'missing');
  if (v) {
    add('video codec', v.codec_name === e.videoCodec, v.codec_name);
    add('pixel format', v.pix_fmt === e.pixFmt, v.pix_fmt);
    if (e.width) add('width', v.width === e.width, String(v.width));
    if (e.height) add('height', v.height === e.height, String(v.height));
    if (e.fps) { const [n, d] = String(v.avg_frame_rate || '0/1').split('/').map(Number); const f = d ? n / d : 0; add('frame rate', Math.abs(f - e.fps) < 0.01, f.toFixed(3)); }
    add('even dimensions', v.width % 2 === 0 && v.height % 2 === 0, `${v.width}x${v.height}`);
  }
  const dur = Number(probe.format && probe.format.duration);
  if (e.durationSec) add('duration', Math.abs(dur - e.durationSec) <= e.durationTolSec, `${dur.toFixed(2)}s vs ${e.durationSec}s`);
  add('file size', Number(probe.format && probe.format.size) >= e.minFileBytes, String(probe.format && probe.format.size));
  if (e.expectAudio !== false) {
    add('has audio stream', a, a ? `${a.codec_name} ${a.sample_rate}Hz ${a.channels}ch` : 'missing');
    if (a) {
      add('audio codec', a.codec_name === e.audioCodec, a.codec_name);
      add('sample rate', Number(a.sample_rate) >= e.minSampleRate, a.sample_rate);
      const ad = Number(a.duration || dur);
      add('audio length matches video', Math.abs(ad - dur) <= 0.5, `${ad.toFixed(2)}s vs ${dur.toFixed(2)}s`);
    }
    if (loud) {
      add('loudness near target', Math.abs(loud.integratedLufs - e.lufsTarget) <= e.lufsTol, `${loud.integratedLufs} LUFS (target ${e.lufsTarget})`);
      add('true peak below limit', loud.truePeakDb <= e.maxTruePeakDb, `${loud.truePeakDb} dBTP`);
    }
  }
  return { ok: checks.every((c) => c.ok), checks, failures: checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`) };
}
// Parse the summary block ffmpeg's ebur128 filter prints with -nostats (stderr).
export function parseEbur128(stderr) {
  const i = String(stderr).lastIndexOf('Summary:');
  const tail = i >= 0 ? String(stderr).slice(i) : String(stderr);
  const lufs = /I:\s+(-?[\d.]+)\s+LUFS/.exec(tail), tp = /Peak:\s+(-?[\d.]+)\s+dBFS/.exec(tail);
  if (!lufs) return null;
  return { integratedLufs: Number(lufs[1]), truePeakDb: tp ? Number(tp[1]) : null };
}
