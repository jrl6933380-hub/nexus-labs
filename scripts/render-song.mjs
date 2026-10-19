#!/usr/bin/env node
// Render a song written as data (lib/adSong.js) to a WAV file, and optionally wire it into an ad so the visuals
// react to it. No ffmpeg and no network: the synth is plain JavaScript.
//
//   node scripts/render-song.mjs --song song.json --out song.wav
//   node scripts/render-song.mjs --demo jingle --out jingle.wav [--ad jingle-ad.json]
//   node scripts/render-song.mjs --song song.json --out song.wav --project ad.json --scene bow --out-project ad-music.json
//
// With --project and --scene the script sets bpm / beatOffset and the audioLow / audioMid / audioHigh envelopes on that
// graphic scene, cut to the part of the song that plays while the scene is on screen (scenes run one after another,
// so the window starts after the scenes before it). Then export with sound:
//   node scripts/export-ad-mp4.mjs --project ad-music.json --audio song.wav --out ad.mp4
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { renderSong, encodeWav, songToMono, validateSong } from '../lib/adSong.js';
import { SONG_DEMOS, jingleAd } from '../lib/adSongDemos.js';
import { envelopesFromPcm, envelopeToSceneParams } from '../lib/adAudio.js';
import { projectFromInput } from '../lib/adExport.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';

const USAGE = 'Usage: node scripts/render-song.mjs (--song <file.json> | --demo jingle) --out <file.wav> [--ad <file.json>] [--project <file> --scene <id> --out-project <file> [--rate 2-60]]';

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
  if (!args.out || (!args.song && !args.demo)) throw new Error(USAGE);

  if (args.demo) {
    if (args.demo !== 'jingle') throw new Error(`Unknown demo "${args.demo}". Demos: ${Object.keys(SONG_DEMOS).join(', ')}`);
    const { project, audio, song } = jingleAd();
    await writeFile(resolve(args.out), encodeWav(audio));
    if (args.ad) await writeFile(resolve(args.ad), `${JSON.stringify(project)}\n`);
    console.log(JSON.stringify({ ok: true, out: resolve(args.out), ad: args.ad ? resolve(args.ad) : undefined, song: song.name, seconds: audio.seconds }));
    return;
  }

  const raw = JSON.parse(await readFile(args.song, 'utf8'));
  const song = raw && raw.song && raw.tracks === undefined ? raw.song : raw; // accepts { song: {...} } too
  const checked = validateSong(song);
  if (!checked.ok) throw new Error(`The song does not validate:\n  ${checked.errors.join('\n  ')}`);
  const audio = renderSong(song);
  await writeFile(resolve(args.out), encodeWav(audio));
  const summary = { ok: true, out: resolve(args.out), song: checked.value.name, bpm: song.bpm, bars: song.bars, seconds: checked.value.seconds };

  if (args.project || args.scene || args['out-project']) {
    if (!args.project || !args.scene || !args['out-project']) throw new Error('--project, --scene and --out-project go together');
    const rate = Number(args.rate || 20);
    const project = projectFromInput(JSON.parse(await readFile(args.project, 'utf8')));
    let start = 0, scene = null;
    for (const s of project.scenes) { if (s.id === args.scene) { scene = s; break; } start += s.duration; }
    if (!scene) throw new Error(`No scene "${args.scene}". Scenes: ${project.scenes.map((s) => s.id).join(', ')}`);
    if (scene.type !== 'graphic') throw new Error(`Scene "${args.scene}" is a ${scene.type}; only graphic scenes react to audio.`);
    const env = envelopesFromPcm(songToMono(audio), audio.sampleRate, { rate, maxSeconds: 30 });
    const from = Math.round(start * env.rate), to = Math.min(env.audioLow.length, from + Math.ceil(scene.duration * env.rate));
    if (from >= env.audioLow.length) throw new Error(`Scene "${args.scene}" starts at ${start}s, after the song ends (${checked.value.seconds.toFixed(1)}s).`);
    const cut = { rate: env.rate, audioLow: env.audioLow.slice(from, to), audioMid: env.audioMid.slice(from, to), audioHigh: env.audioHigh.slice(from, to) };
    const spb = 60 / song.bpm;
    Object.assign(scene.params, envelopeToSceneParams(cut), { bpm: song.bpm, beatOffset: Math.round(((spb - (start % spb)) % spb) * 1000) / 1000 });
    const check = validateProjectV2(project);
    if (!check.ok) throw new Error(`The result does not validate: ${check.errors.slice(0, 3).join(' | ')}`);
    await writeFile(resolve(args['out-project']), `${JSON.stringify(project)}\n`);
    Object.assign(summary, { outProject: resolve(args['out-project']), scene: scene.id, sceneStartSec: start, samples: cut.audioLow.length });
  }
  console.log(JSON.stringify(summary));
}

main().catch((e) => { console.error(`song render failed: ${e.message}`); process.exitCode = 1; });
