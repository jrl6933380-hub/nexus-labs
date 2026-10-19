#!/usr/bin/env node
// Put a generated beat under a recording. Needs ffmpeg. The beat starts `--delay` seconds in (the track's
// beat_offset, so the first beat lines up), loops to cover the recording, and the result is as long as the recording.
//
//   node scripts/make-freestyle.mjs ... (or any song.json)      # writes beat.wav
//   node scripts/mix-beat.mjs --recording voice.m4a --beat beat.wav --delay 0.3 --out mixed.wav [--beat-volume 0.7]
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const USAGE = 'Usage: node scripts/mix-beat.mjs --recording <file> --beat <file.wav> --out <file.wav> [--delay seconds] [--beat-volume 0-2]';
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
export function mixArgs({ recording, beat, out, delay = 0, volume = 0.7 }) {
  const ms = Math.max(0, Math.round(Number(delay) * 1000));
  const filter = `[1:a]adelay=${ms}|${ms},volume=${Number(volume)}[b];[0:a][b]amix=inputs=2:duration=first:normalize=0[m]`;
  return ['-v', 'error', '-nostdin', '-y', '-i', recording, '-stream_loop', '-1', '-i', beat, '-filter_complex', filter, '-map', '[m]', out];
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) { console.log(USAGE); return; }
  if (!args.recording || !args.beat || !args.out) throw new Error(USAGE);
  const delay = Number(args.delay ?? 0), volume = Number(args['beat-volume'] ?? 0.7);
  if (!(delay >= 0 && delay <= 10) || !(volume >= 0 && volume <= 2)) throw new Error('--delay is 0-10 seconds and --beat-volume is 0-2');
  const argv = mixArgs({ recording: resolve(args.recording), beat: resolve(args.beat), out: resolve(args.out), delay, volume });
  await new Promise((res, rej) => {
    const child = spawn('ffmpeg', argv, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    child.stderr.on('data', (d) => { err = (err + d).slice(-2000); });
    child.on('error', (e) => rej(e.code === 'ENOENT' ? new Error('ffmpeg was not found on PATH.') : e));
    child.on('close', (code) => (code === 0 ? res() : rej(new Error(`ffmpeg exited with code ${code}: ${err.trim()}`))));
  });
  console.log(JSON.stringify({ ok: true, out: resolve(args.out), delay, volume }));
}
if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error(`mix failed: ${e.message}`); process.exitCode = 1; });
