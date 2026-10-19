// Beat generator and lyric timing for the song synth (lib/adSong.js). Two ways in:
//   * typed freestyle: you give words (and optionally a style or tempo); we write a beat and place every word on it.
//   * recorded freestyle: the track library has the tempo and beat offset; we write a beat at that tempo to play under it.
// Everything is deterministic: the same inputs (and seed) always give the same song, so renders stay reproducible.
// The beat is a synth instrumental. Word times for typed lyrics are placed by syllable count on the bars, so they are
// an estimate of where a rapper would land them, not a measurement of anyone's voice.
import {SONG_LIMITS, validateSong, renderSong, songToMono} from './adSong.js';
import {envelopesFromPcm} from '../public/ad-audio.mjs';

export const BEAT_STYLES = Object.freeze(['boom_bap', 'trap', 'lofi', 'hype']);
const ROOTS = {C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11};
const M = [0, 3, 7], MAJ = [0, 4, 7], M7 = [0, 3, 7, 10], DOM7 = [0, 4, 7, 10], MAJ7 = [0, 4, 7, 11];
// Each style: tempo range, chords (semitones above the key, with chord shape), scale for the hook, drum patterns, bass rhythm.
const STYLE = {
  boom_bap: {
    bpm: [84, 96], prog: [[0, M7], [5, M7], [0, M7], [7, M]], scale: [0, 3, 5, 7, 10], hook: 'bell',
    kick: ['x.....x..x......', 'x.......x.x.....', 'x..x....x.......'], snare: ['....x.......x...'], hat: ['x.o.x.o.x.o.x.o.', 'x.x.x.x.x.x.x.x.'],
    ohat: '..............x.', bass: [[0, 0.75], [1.5, 0.5], [2.5, 0.5], [3.5, 0.25]],
  },
  trap: {
    bpm: [130, 150], prog: [[0, M], [8, MAJ], [3, MAJ], [10, MAJ]], scale: [0, 3, 5, 7, 10], hook: 'bell',
    kick: ['x.........x..x..', 'x..x......x.....'], snare: ['........x.......'], hat: ['x.x.x.x.xxx.x.x.', 'xoxoxoxoxxoxoxox'],
    ohat: '..........x.....', bass: [[0, 3], [3.5, 0.5]],
  },
  lofi: {
    bpm: [70, 84], prog: [[2, M7], [7, DOM7], [0, MAJ7], [9, M7]], scale: [0, 2, 4, 7, 9], hook: 'pluck',
    kick: ['x......x..x.....', 'x.....x...x.....'], snare: ['....o.......x...'], hat: ['o.o.o.o.o.o.o.o.'],
    ohat: null, bass: [[0, 1.5], [2, 1.5]],
  },
  hype: {
    bpm: [118, 128], prog: [[0, MAJ], [7, MAJ], [9, M], [5, MAJ]], scale: [0, 2, 4, 7, 9], hook: 'lead',
    kick: ['x...x...x...x...'], snare: ['....x.......x...'], hat: ['..x...x...x...x.'],
    ohat: '..x...x...x...x.', bass: [[0, 0.5], [1, 0.5], [1.5, 0.5], [2, 0.5], [3, 0.5], [3.5, 0.5]],
  },
};

function rng(seed) { // mulberry32
  let a = (Number(seed) || 1) >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => list[Math.floor(r() * list.length)];
const fail = (message) => Object.assign(new Error(message), {status: 400, code: 'BEAT_INVALID'});

/** How many bars fit in `seconds` at `bpm`. */
export const barsThatFit = (bpm, seconds = SONG_LIMITS.secondsMax) => Math.min(SONG_LIMITS.barsMax, Math.floor((seconds * bpm) / 240));

/**
 * Write a beat as a song (the format in docs/ad-song.md).
 * @param {{style?: string, bpm?: number, bars?: number, key?: string, seed?: number, name?: string}} opts
 */
export function generateBeat(opts = {}) {
  const style = opts.style === undefined ? 'boom_bap' : opts.style;
  const S = STYLE[style];
  if (!S) throw fail(`style must be one of ${BEAT_STYLES.join(', ')}.`);
  const bpm = opts.bpm === undefined ? Math.round((S.bpm[0] + S.bpm[1]) / 2) : opts.bpm;
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < SONG_LIMITS.bpmMin || bpm > SONG_LIMITS.bpmMax) throw fail(`bpm must be between ${SONG_LIMITS.bpmMin} and ${SONG_LIMITS.bpmMax}.`);
  const key = opts.key === undefined ? 'A' : opts.key;
  if (!(key in ROOTS)) throw fail(`key must be one of ${Object.keys(ROOTS).join(', ')}.`);
  const fit = barsThatFit(bpm);
  let bars = opts.bars;
  if (bars === undefined) bars = fit >= 8 ? Math.floor(fit / 4) * 4 : fit;
  if (!Number.isInteger(bars) || bars < 2 || bars > SONG_LIMITS.barsMax) throw fail(`bars must be a whole number from 2 to ${SONG_LIMITS.barsMax}.`);
  if (bars > fit) throw fail(`${bars} bars at ${bpm} BPM is longer than ${SONG_LIMITS.secondsMax}s. Use at most ${fit} bars.`);
  const r = rng(opts.seed ?? 1), root = ROOTS[key];

  const chordAt = (i) => { const [deg, shape] = S.prog[i % S.prog.length]; return {pc: (root + deg) % 12, shape}; };
  const pad = [], bass = [];
  S.prog.forEach((_, i) => {
    const {pc, shape} = chordAt(i);
    pad.push([i * 4, shape.map((n) => 48 + pc + n), 4]);
    for (const [beat, len] of S.bass) {
      const octave = style === 'hype' && r() < 0.35 ? 12 : 0;
      bass.push([i * 4 + beat, 36 + pc + octave, len]);
    }
  });
  // Hook: a short walk on the key's pentatonic scale, four bars, repeating.
  const hook = [];
  let idx = Math.floor(r() * S.scale.length);
  for (let bar = 0; bar < 4; bar++) {
    const slots = pick(r, [[0, 1.5, 3], [0, 2, 3.5], [0.5, 2, 3], [1, 2.5]]);
    for (const beat of slots) {
      idx = Math.max(0, Math.min(S.scale.length * 2 - 1, idx + pick(r, [-2, -1, -1, 1, 1, 2])));
      const note = 60 + root + S.scale[idx % S.scale.length] + (idx >= S.scale.length ? 12 : 0);
      hook.push([bar * 4 + beat, note, beat === slots[slots.length - 1] ? 1 : 0.5, 0.6 + r() * 0.3]);
    }
  }
  const tracks = [
    {voice: 'pad', notes: pad, loopBars: 4, vol: 0.5, pan: -0.15},
    {voice: 'hat', pattern: pick(r, S.hat), vol: 0.5, pan: 0.2},
    {voice: 'kick', pattern: pick(r, S.kick), vol: 0.9, startBar: 1},
    {voice: 'snare', pattern: pick(r, S.snare), vol: 0.7, startBar: 1},
    {voice: 'bass', notes: bass, loopBars: 4, vol: style === 'trap' ? 0.9 : 0.75, startBar: 1},
    {voice: S.hook, notes: hook, loopBars: 4, vol: 0.4, pan: 0.3, startBar: Math.min(2, bars - 1)},
  ];
  if (S.ohat) tracks.push({voice: 'ohat', pattern: S.ohat, vol: 0.35, pan: -0.2, startBar: 1});
  const song = {name: String(opts.name || `${style.replace('_', ' ')} ${bpm}`).slice(0, SONG_LIMITS.nameMax), bpm, bars, tracks};
  const checked = validateSong(song);
  if (!checked.ok) throw fail('Generated beat did not validate: ' + checked.errors.slice(0, 3).join('; '));
  return song;
}

/** Rough syllable count for English-ish words; always at least 1. */
export function countSyllables(word) {
  const w = String(word).toLowerCase().replace(/[^a-z]/g, '');
  if (!w) return 1;
  let n = (w.match(/[aeiouy]+/g) || []).length;
  if (n > 1 && /e$/.test(w) && !/le$/.test(w)) n--;
  return Math.max(1, n);
}

/**
 * Place typed lyrics on the bars of a beat. Lines are split on new lines or "/". A line takes one bar (up to 12
 * syllables) or more, starts on the downbeat, and its words are spread by syllable with a short breath at the end.
 * Returns word times in seconds. `barrier` is a bar number that no line may cross (used to cut scenes).
 */
export function timeLyrics(text, {bpm, startBar = 1, maxBars, barrier = null} = {}) {
  if (typeof text !== 'string' || !text.trim()) throw fail('lyrics are required.');
  if (typeof bpm !== 'number' || !(bpm > 0)) throw fail('bpm is required to time lyrics.');
  const barSec = 240 / bpm, step = barSec / 16;
  const rawLines = text.split(/\r?\n|\//).map((l) => l.trim()).filter(Boolean);
  const lines = [], truncated = [];
  let cursor = startBar;
  for (const raw of rawLines) {
    const tokens = raw.split(/\s+/).map((t) => t.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')).filter(Boolean);
    if (!tokens.length) continue;
    const syl = tokens.map(countSyllables), total = syl.reduce((a, b) => a + b, 0);
    const span = Math.max(1, Math.ceil(total / 13));
    if (barrier !== null && cursor < barrier && cursor + span > barrier) cursor = barrier;
    if (maxBars !== undefined && cursor + span > maxBars) { truncated.push(raw); continue; }
    const usable = span * 16 - (span === 1 ? 2 : 3);
    const words = [];
    let cum = 0, prevStart = -1;
    tokens.forEach((token, i) => {
      let a = Math.round((cum / total) * usable);
      if (a <= prevStart) a = prevStart + 1;
      cum += syl[i];
      let b = Math.round((cum / total) * usable);
      if (b <= a) b = a + 1;
      prevStart = a;
      const s = (cursor * 16 + a) * step;
      words.push({w: token.slice(0, 40), s: Math.round(s * 1000) / 1000, e: Math.round((s + Math.max(step, (b - a - 0.4) * step)) * 1000) / 1000});
    });
    lines.push({text: raw, bar: cursor, bars: span, start: words[0].s, end: words[words.length - 1].e, words});
    cursor += span;
  }
  if (!lines.length) throw fail(maxBars !== undefined ? 'None of the lines fit in the beat. Shorten them or lower the tempo.' : 'No words found in the lyrics.');
  return {lines, words: lines.flatMap((l) => l.words), barsUsed: cursor, truncated};
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const r3 = (v) => Math.round(v * 1000) / 1000;

/**
 * Typed freestyle to a finished ad: a beat, the words placed on it, and a graphic ad whose captions land on the
 * words and whose shapes pulse with the beat. Returns { project, audio, song, lines, words, notes }.
 */
export function freestyleAd({lyrics, style, bpm, key, seed, title, mood = 'bold', palette = 'ocean-blue', format = 'portrait'} = {}) {
  const S = STYLE[style === undefined ? 'boom_bap' : style];
  if (!S) throw fail(`style must be one of ${BEAT_STYLES.join(', ')}.`);
  const tempo = bpm === undefined ? Math.round((S.bpm[0] + S.bpm[1]) / 2) : bpm;
  if (typeof tempo !== 'number' || tempo < 60 || tempo > 200) throw fail('bpm must be between 60 and 200.');
  const barSec = 240 / tempo, half = Math.floor(15 / barSec); // bars per scene (a scene is at most 15 s)
  if (half < 2) throw fail('That tempo is too slow for a freestyle ad (bars are longer than 7 seconds).');
  const maxBars = Math.min(half * 2, barsThatFit(tempo));
  const timed = timeLyrics(lyrics, {bpm: tempo, startBar: 1, maxBars: maxBars - 1, barrier: half < maxBars ? half : null});
  const needed = timed.barsUsed + 1; // one outro bar
  const bars = Math.min(maxBars, Math.max(4, needed));
  const song = generateBeat({style, bpm: tempo, bars, key, seed, name: title || 'Freestyle'});
  const audio = renderSong(song);
  const env = envelopesFromPcm(songToMono(audio), audio.sampleRate, {rate: 20, maxSeconds: 30});
  const total = (bars * 240) / tempo;
  const cut = half < bars ? half * barSec : null;
  const windows = cut ? [[0, cut], [cut, total]] : [[0, total]];
  const spb = 60 / tempo;
  const scenes = windows.map(([from, to], i) => {
    const dur = r3(to - from), a = Math.round(from * env.rate), b = Math.min(env.audioLow.length, a + Math.ceil(dur * env.rate));
    const layers = [
      {shape: 'circle', x: 50, y: 36, w: 64, color: i ? 'pink' : 'orange', color2: i ? 'violet' : 'red', angle: 150, blur: 7, blend: 'screen', opacity: 0.5, react: 'low', rScale: 0.22, rOpacity: 0.4},
      {shape: 'circle', x: 50, y: 36, w: 28, color: 'yellow', color2: 'orange', angle: 90, glow: 2, react: 'low', rScale: 0.4, rGlow: 6},
      {shape: 'ring', x: 50, y: 36, w: 50, thickness: 0.6, color: 'white', opacity: 0.5, react: 'beat', rScale: 0.3, rOpacity: -0.35},
      {shape: 'star', x: 14, y: 20, w: 8, color: 'yellow', glow: 2, react: 'high', rRot: 40, rScale: 0.7, count: 3, stepX: 8, stepY: 14},
      {shape: 'star', x: 86, y: 20, w: 8, color: 'pink', glow: 2, react: 'mid', rRot: -40, rScale: 0.7, count: 3, stepX: -8, stepY: 14},
      {shape: 'text', x: 50, y: 7, text: String(title || 'Freestyle').slice(0, 40), size: 4.4, weight: 800, spacing: 0.12, caps: true, color: 'white', shadow: 3, fixed: true},
    ];
    for (const line of timed.lines) {
      if (line.start < from - 0.01 || line.start >= to - 0.01) continue; // word times are rounded to the millisecond
      const s = Math.max(0, r3(line.start - from)), e = r3(Math.min(dur - 0.05, line.end - from + 0.35));
      const lead = Math.max(0, s - 0.06);
      const keys = [];
      if (lead > 0) keys.push({t: 0, opacity: 0});
      keys.push({t: r3(lead), opacity: 0, scale: 1.18}, {t: r3(lead + 0.14), opacity: 1, scale: 1, ease: 'smooth'}, {t: r3(Math.max(lead + 0.2, e)), opacity: 1, scale: 1}, {t: r3(Math.max(lead + 0.3, e) + 0.25), opacity: 0});
      layers.push({shape: 'text', x: 50, y: 68, text: line.text.slice(0, 90), size: clamp(9.5 - line.text.length / 14, 4.6, 9.5), weight: 900, caps: true, maxw: 88, color: 'white', stroke: 'black', strokeW: 1.1, shadow: 6, fixed: true, keys});
    }
    const params = {layers, bpm: tempo, beatZoom: 0.02, beatShake: 0.2, audioRate: env.rate, audioLow: env.audioLow.slice(a, b), audioMid: env.audioMid.slice(a, b), audioHigh: env.audioHigh.slice(a, b), beatOffset: r3((spb - (from % spb)) % spb)};
    return {id: i ? 'verse2' : 'verse1', type: 'graphic', duration: dur, background: 'gradient', params};
  });
  // A graphic ad needs at least two scenes: a short beat gets an end card.
  if (scenes.length < 2) scenes.push({id: 'end', type: 'end_card', duration: 2, params: {cta: String(title || 'Freestyle').slice(0, 40), tagline: 'Beat and words in code'}, background: 'orbits'});
  const shown = scenes.reduce((n, sc) => n + sc.duration, 0);
  const project = {specVersion: 2, name: String(title || 'Freestyle').slice(0, 60), mood, palette, concept: true, platform: {format, lengthSec: shown > 15 ? 30 : 15}, scenes};
  const notes = [`Beat: ${song.name}, ${tempo} BPM, ${bars} bars (${total.toFixed(1)}s).`, 'Word times are placed by syllable on the bars (an estimate); the beat is instrumental. Record a voice over it for a real vocal.'];
  if (timed.truncated.length) notes.push(`${timed.truncated.length} line(s) did not fit in ${total.toFixed(0)} seconds and were left out.`);
  return {project, audio, song, lines: timed.lines, words: timed.words, truncated: timed.truncated, notes};
}
