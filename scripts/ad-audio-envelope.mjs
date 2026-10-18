#!/usr/bin/env node
// Analyse an audio file into the loudness envelopes a graphic scene reacts to. Needs Node 20+ and ffmpeg.
//
//   node scripts/ad-audio-envelope.mjs --audio music.mp3 --out env.json [--rate 20] [--start 0] [--duration 15]
//   node scripts/ad-audio-envelope.mjs --audio music.mp3 --project ad.json --scene bow --out ad-reactive.json
//
// The first form writes { rate, seconds, audioLow, audioMid, audioHigh }. The second copies the project and sets
// audioRate/audioLow/audioMid/audioHigh on the named graphic scene (use the same file as --audio when you export
// the MP4, so sound and picture line up). The numbers live in the ad, so rendering never reads the audio file.
import { readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { envelopesFromPcm, envelopeToSceneParams } from '../lib/adAudio.js';
import { projectFromInput } from '../lib/adExport.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';

const USAGE = 'Usage: node scripts/ad-audio-envelope.mjs --audio <file> --out <file.json> [--rate 2-60] [--start s] [--duration s] [--project <file> --scene <id>]';
const SAMPLE_RATE = 16000;

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

function decode(file, start, duration) {
  return new Promise((res, reject) => {
    const args = ['-v', 'error', '-nostdin'];
    if (start > 0) args.push('-ss', String(start));
    args.push('-i', file, '-t', String(duration), '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1');
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = []; let stderr = '';
    child.stdout.on('data', (d) => chunks.push(d));
    child.stderr.on('data', (d) => { stderr = (stderr + d).slice(-2000); });
    child.on('error', (e) => reject(e.code === 'ENOENT' ? new Error('ffmpeg was not found on PATH.') : e));
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffmpeg exited with code ${code}: ${stderr.trim()}`));
      const buf = Buffer.concat(chunks);
      res(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)));
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.audio || !args.out) throw new Error(USAGE);
  const rate = Number(args.rate || 20), start = Number(args.start || 0), duration = Math.min(30, Number(args.duration || 30));
  if (!(start >= 0) || !(duration > 0)) throw new Error('--start must be 0 or more and --duration above 0');
  const samples = await decode(resolve(args.audio), start, duration);
  if (!samples.length) throw new Error('No audio was decoded from that file.');
  const env = envelopesFromPcm(samples, SAMPLE_RATE, { rate, maxSeconds: duration });
  let output = env;
  if (args.project || args.scene) {
    if (!args.project || !args.scene) throw new Error('--project and --scene go together');
    const project = projectFromInput(JSON.parse(await readFile(args.project, 'utf8')));
    const scene = project.scenes.find((s) => s.id === args.scene);
    if (!scene) throw new Error(`No scene "${args.scene}". Scenes: ${project.scenes.map((s) => s.id).join(', ')}`);
    if (scene.type !== 'graphic') throw new Error(`Scene "${args.scene}" is a ${scene.type}; only graphic scenes react to audio.`);
    Object.assign(scene.params, envelopeToSceneParams(env));
    const check = validateProjectV2(project);
    if (!check.ok) throw new Error(`The result does not validate: ${check.errors.slice(0, 3).join(' | ')}`);
    output = project;
  }
  await writeFile(resolve(args.out), `${JSON.stringify(output)}\n`);
  console.log(JSON.stringify({ ok: true, out: resolve(args.out), rate: env.rate, seconds: env.seconds, samples: env.audioLow.length }));
}

main().catch((e) => { console.error(`audio analysis failed: ${e.message}`); process.exitCode = 1; });
