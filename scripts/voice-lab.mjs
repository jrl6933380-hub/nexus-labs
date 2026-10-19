#!/usr/bin/env node
// Render test phrases with the code voice and write WAVs plus a manifest (timings, render cost). Pair with
// scripts/voice-asr.py, which transcribes the WAVs with a speech recognizer and reports word error rate: a rough,
// repeatable stand-in for "is this understandable" when nobody is there to listen.
//
//   node scripts/voice-lab.mjs --out /tmp/o [--set ads|classes|all] [--variants spoken,bright,rap] [--lead 0.3] [--voice '{"emphasis":0.5}']
import fs from 'node:fs';
import path from 'node:path';
import {speak, toStereo} from '../lib/adVoice.js';
import {encodeWav} from '../lib/adSong.js';

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, all) => (v.startsWith('--') ? [...a, [v.slice(2), all[i + 1]]] : a), []));
const out = args.out || './voice-out', lead = Number(args.lead ?? 0.3), voiceOpts = args.voice ? JSON.parse(args.voice) : {};
fs.mkdirSync(out, {recursive: true});

// Short ad lines, and one sentence per consonant class so a weak sound shows up on its own.
export const ADS = [
  'Build your next idea with Nexus.', 'Hot fresh pizza made for you.', 'Call now and save big today.',
  'The best crew in town.', 'Get a free quote in one minute.', 'Your golden crust is ready.',
];
export const CLASSES = {
  K: 'Call the cat and keep the cold coat.', P: 'Put the pen in the pot please.', T: 'Take two tea to town today.', B: 'Bring the big blue bag back.',
  D: 'Dad did a deep dive down.', G: 'Go get the green game gear.', S: 'See six sun sets soon.', F: 'Five fine fish for four.',
  SH: 'She sells shiny shells.', Z: 'Zoe sees zero zebras.', V: 'Very vivid views of vans.', TH: 'Three thin things thank them.',
  CH: 'Cheap cheese chips please.', JH: 'Jump just in June.', M: 'My mom made more milk.', N: 'No new news now.', L: 'Late last lunch let loose.',
  R: 'Run red rabbit race.', W: 'We were wet and wise.', Y: 'Yes you young yak.', H: 'He had his hat on.',
};
const set = args.set || 'ads';
const phrases = args.phrases ? JSON.parse(fs.readFileSync(args.phrases, 'utf8')).map((t, i) => [`p${i}`, t])
  : [...(set === 'classes' ? [] : ADS.map((t, i) => [`ad${i}`, t])), ...(set === 'ads' ? [] : Object.entries(CLASSES))];
const variants = {
  spoken: (t) => speak(t, {lead, voice: {preset: 'narrator', ...voiceOpts}}),
  bright: (t) => speak(t, {voice: {preset: 'bright', ...voiceOpts}, lead}),
  rap: (t) => speak(t, {mode: 'rap', bpm: 100, startSec: Math.max(lead, 0.3), voice: {preset: 'narrator', ...voiceOpts}}),
};
const chosen = (args.variants || 'spoken').split(',');
const manifest = [];
for (const vname of chosen) {
  for (const [id, text] of phrases) {
    const t0 = performance.now();
    const r = variants[vname](text);
    const ms = performance.now() - t0;
    const file = `${vname}_${id}.wav`;
    fs.writeFileSync(path.join(out, file), encodeWav(toStereo(r.audio)));
    manifest.push({file, variant: `${vname}:${id.startsWith('ad') ? 'ads' : id.startsWith('p') ? 'phrases' : 'classes'}`, id, text, seconds: r.audio.seconds, renderMs: Math.round(ms), words: r.words});
  }
}
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify({files: manifest.length, totalSeconds: +manifest.reduce((s, m) => s + m.seconds, 0).toFixed(1), totalRenderMs: manifest.reduce((s, m) => s + m.renderMs, 0), heapMB: Math.round(process.memoryUsage().heapUsed / 1e6)}));
