#!/usr/bin/env node
// Render test phrases with the code voice and write WAVs plus a manifest (timings, render cost). Pair with
// scripts/voice-asr.py, which transcribes the WAVs with a speech recognizer and reports word error rate: a rough,
// repeatable stand-in for "is this understandable" when nobody is there to listen.
//
//   node scripts/voice-lab.mjs --out /tmp/o [--phrases phrases.json] [--lead 0.3]
import fs from 'node:fs';
import path from 'node:path';
import {speak, toStereo} from '../lib/adVoice.js';
import {encodeWav} from '../lib/adSong.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const out = args.out || './voice-out', lead = Number(args.lead ?? 0.3);
fs.mkdirSync(out, {recursive: true});
const phrases = args.phrases ? JSON.parse(fs.readFileSync(args.phrases, 'utf8')) : [
  'Build your next idea with Nexus.',
  'Hot fresh pizza made for you.',
  'Call now and save big today.',
  'The best crew in town.',
  'Get a free quote in one minute.',
  'Your golden crust is ready.',
];
const variants = {
  spoken: (t) => speak(t, {lead}),
  bright: (t) => speak(t, {voice: 'bright', lead}),
  rap: (t) => speak(t, {mode: 'rap', bpm: 100, startSec: Math.max(lead, 0.3)}),
};
const manifest = [];
for (const [vname, fn] of Object.entries(variants)) {
  phrases.forEach((text, i) => {
    const t0 = performance.now();
    const r = fn(text);
    const ms = performance.now() - t0;
    const file = `${vname}_${i}.wav`;
    fs.writeFileSync(path.join(out, file), encodeWav(toStereo(r.audio)));
    manifest.push({file, variant: vname, text, seconds: r.audio.seconds, renderMs: Math.round(ms), words: r.words});
  });
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify({files: manifest.length, totalSeconds: manifest.reduce((s, m) => s + m.seconds, 0).toFixed(1), totalRenderMs: manifest.reduce((s, m) => s + m.renderMs, 0), heapMB: Math.round(process.memoryUsage().heapUsed / 1e6)}));
