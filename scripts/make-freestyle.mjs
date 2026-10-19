#!/usr/bin/env node
// Typed freestyle to files: a beat (WAV), the song JSON, the timed words and a graphic ad whose captions land on the
// words. No ffmpeg and no network for this step.
//
//   node scripts/make-freestyle.mjs --lyrics-file words.txt --out-dir out [--style boom_bap|trap|lofi|hype] [--bpm 90]
//        [--key A] [--seed 3] [--title "Slice Time"] [--format portrait|square|landscape]
//   node scripts/export-ad-mp4.mjs --project out/ad.json --audio out/beat.wav --out out/freestyle.mp4
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { freestyleAd } from '../lib/adBeat.js';
import { encodeWav } from '../lib/adSong.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';

const USAGE = 'Usage: node scripts/make-freestyle.mjs (--lyrics "text" | --lyrics-file file) --out-dir <dir> [--style s] [--bpm n] [--key K] [--seed n] [--title t] [--format f]';
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { out.help = true; continue; }
    if (!a.startsWith('--')) throw new Error(`Unexpected argument: ${a}`);
    const v = argv[++i];
    if (v === undefined) throw new Error(`${a} needs a value`);
    out[a.slice(2)] = v;
  }
  return out;
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args['out-dir'] || (!args.lyrics && !args['lyrics-file'])) throw new Error(USAGE);
  const lyrics = args.lyrics ?? await readFile(args['lyrics-file'], 'utf8');
  const r = freestyleAd({
    lyrics, style: args.style, bpm: args.bpm === undefined ? undefined : Number(args.bpm), key: args.key,
    seed: args.seed === undefined ? undefined : Number(args.seed), title: args.title, format: args.format,
  });
  const check = validateProjectV2(r.project);
  if (!check.ok) throw new Error(`The ad does not validate: ${check.errors.slice(0, 3).join(' | ')}`);
  const dir = resolve(args['out-dir']);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'beat.wav'), encodeWav(r.audio));
  await writeFile(join(dir, 'song.json'), `${JSON.stringify(r.song)}\n`);
  await writeFile(join(dir, 'words.json'), `${JSON.stringify({ lines: r.lines, words: r.words })}\n`);
  await writeFile(join(dir, 'ad.json'), `${JSON.stringify(r.project)}\n`);
  console.log(JSON.stringify({ ok: true, dir, bpm: r.song.bpm, bars: r.song.bars, lines: r.lines.length, notPlaced: r.truncated.length, notes: r.notes }));
}
main().catch((e) => { console.error(`freestyle failed: ${e.message}`); process.exitCode = 1; });
