// Code-only voice for the Ad Machine: a rule-based formant ("Klatt style") synthesizer. No model, no download, no
// network, no browser speech API. Same input always gives the same samples, so the voice can be rendered on the
// server, in the browser or in a script and mixed with lib/adSong.js output.
//
// Pipeline (the "vocal score" is the data between steps 2 and 3):
//   1. text -> phonemes            lib/adPhonemes.js (overrides, dictionary, built-ins, letter rules)
//   2. phonemes -> timeline        planSpeech()  free speech timing and pitch
//                                  planMeter()   syllables placed on a beat grid; 'rap' (spoken on the beat) or 'sing'
//                                                (pitched notes, vowels held to fill each note)
//   3. timeline -> audio           synthesize()  glottal source -> formant filters, noise for consonants
// Every plan carries real word and phoneme times, so captions can follow the actual audio.
import {phonemize, syllabify, isVowelPhone} from './adPhonemes.js';

const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const round = (v, d = 3) => Math.round(v * 10 ** d) / 10 ** d;
function mulberry32(a) {
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

export const VOICE_LIMITS = Object.freeze({maxSeconds: 30, maxChars: 600, sampleRates: [16000, 22050, 44100, 48000]});

// ---------------------------------------------------------------------------------------------------------------
// Phone table. c: v vowel, d diphthong, l glide/liquid, n nasal, f fricative, s stop, a affricate, h aspirate.
// f/f2 are F1-F3 targets in Hz for a ~110 Hz adult male voice (scaled by voice.scale). d is the default duration (s).
const PH = {
  IY: {c: 'v', f: [270, 2290, 3010], d: 0.13}, IH: {c: 'v', f: [390, 1990, 2550], d: 0.085}, EH: {c: 'v', f: [530, 1840, 2480], d: 0.10},
  AE: {c: 'v', f: [660, 1720, 2410], d: 0.14}, AA: {c: 'v', f: [730, 1090, 2440], d: 0.14}, AO: {c: 'v', f: [570, 840, 2410], d: 0.14},
  UH: {c: 'v', f: [440, 1020, 2240], d: 0.09}, UW: {c: 'v', f: [300, 870, 2240], d: 0.14}, AH: {c: 'v', f: [640, 1190, 2390], d: 0.085},
  ER: {c: 'v', f: [490, 1350, 1690], d: 0.13},
  EY: {c: 'd', f: [530, 1840, 2480], f2: [390, 2050, 2600], d: 0.17}, AY: {c: 'd', f: [730, 1090, 2440], f2: [390, 1990, 2550], d: 0.19},
  OY: {c: 'd', f: [570, 840, 2410], f2: [390, 1990, 2550], d: 0.19}, AW: {c: 'd', f: [750, 1250, 2400], f2: [450, 1000, 2300], d: 0.19},
  OW: {c: 'd', f: [490, 910, 2400], f2: [340, 780, 2300], d: 0.17},
  L: {c: 'l', f: [380, 1250, 2800], d: 0.07}, R: {c: 'l', f: [310, 1060, 1380], d: 0.075}, W: {c: 'l', f: [290, 610, 2150], d: 0.065}, Y: {c: 'l', f: [260, 2070, 3020], d: 0.06},
  M: {c: 'n', f: [250, 1100, 2200], z: 1000, d: 0.075}, N: {c: 'n', f: [250, 1500, 2500], z: 1800, d: 0.07}, NG: {c: 'n', f: [250, 1900, 2600], z: 2800, d: 0.08},
  S: {c: 'f', fc: 5000, bw: 1800, amp: 1.0, v: 0, d: 0.105}, Z: {c: 'f', fc: 5000, bw: 1800, amp: 0.8, v: 1, d: 0.085},
  SH: {c: 'f', fc: 3100, bw: 1600, amp: 1.0, v: 0, d: 0.11}, ZH: {c: 'f', fc: 3100, bw: 1600, amp: 0.8, v: 1, d: 0.09},
  F: {c: 'f', fc: 5200, bw: 6000, amp: 0.6, v: 0, d: 0.095}, V: {c: 'f', fc: 5200, bw: 6000, amp: 0.5, v: 1, d: 0.06},
  TH: {c: 'f', fc: 5600, bw: 6000, amp: 0.5, v: 0, d: 0.09}, DH: {c: 'f', fc: 5600, bw: 6000, amp: 0.4, v: 1, d: 0.045},
  HH: {c: 'h', d: 0.07},
  P: {c: 's', v: 0, place: 'l', burst: {fc: 1300, bw: 3000, amp: 0.45}, clo: 0.065}, B: {c: 's', v: 1, place: 'l', burst: {fc: 1300, bw: 3000, amp: 0.35}, clo: 0.055},
  T: {c: 's', v: 0, place: 'a', burst: {fc: 4600, bw: 2600, amp: 0.7}, clo: 0.055}, D: {c: 's', v: 1, place: 'a', burst: {fc: 4400, bw: 2600, amp: 0.5}, clo: 0.045},
  K: {c: 's', v: 0, place: 'v', burst: {fc: 2300, bw: 1500, amp: 0.7}, clo: 0.065}, G: {c: 's', v: 1, place: 'v', burst: {fc: 2200, bw: 1500, amp: 0.5}, clo: 0.05},
  CH: {c: 'a', v: 0, place: 'a', burst: {fc: 3200, bw: 2000, amp: 0.7}, clo: 0.05, fc: 3200, bw: 1700, amp: 0.95, fd: 0.085},
  JH: {c: 'a', v: 1, place: 'a', burst: {fc: 3200, bw: 2000, amp: 0.5}, clo: 0.04, fc: 3200, bw: 1700, amp: 0.75, fd: 0.07},
};
const LOCUS_F2 = {l: 800, a: 1800, v: 1700};
for (const k of ['S', 'Z', 'SH', 'ZH', 'TH', 'DH']) PH[k].place = 'a';
for (const k of ['F', 'V']) PH[k].place = 'l';
export const PHONE_SYMBOLS = Object.freeze(Object.keys(PH));
export const PHONE_TABLE = PH;  // mutable on purpose: scripts/voice-lab experiments tune it
const SCHWA = [500, 1500, 2500];
const FUNCTION_WORDS = new Set('a an the and or but of to in on at for with from by as is are was be been it its i you your my me we our us he she they them his her their this that these those do does did not no so if than then'.split(' '));

// ---------------------------------------------------------------------------------------------------------------
// Voices. All numbers are plain data, so a voice can ship inside a project or an AI request.
export const VOICE_PRESETS = Object.freeze({
  narrator: {f0: 112, scale: 1.0, oq: 0.62, tilt: 0.7, emphasis: 0.85, breath: 0.015, jitter: 0.004, shimmer: 0.03, range: 0.9, vibrato: 0.3},
  bright: {f0: 205, scale: 1.17, oq: 0.66, tilt: 0.2, breath: 0.02, jitter: 0.004, shimmer: 0.03, range: 1.1, vibrato: 0.4},
  deep: {f0: 88, scale: 0.92, oq: 0.58, tilt: 0.3, breath: 0.012, jitter: 0.004, shimmer: 0.03, range: 0.9, vibrato: 0.3},
  robot: {f0: 120, scale: 1.0, oq: 0.5, tilt: 0.1, breath: 0, jitter: 0, shimmer: 0, range: 0, vibrato: 0},
});
export function resolveVoice(v) {
  const base = typeof v === 'string' ? VOICE_PRESETS[v] : {...VOICE_PRESETS.narrator, ...(v && VOICE_PRESETS[v.preset]), ...v};
  if (!base) throw new Error(`Unknown voice "${v}". Presets: ${Object.keys(VOICE_PRESETS).join(', ')}.`);
  return {...VOICE_PRESETS.narrator, ...base, f0: clamp(Number(base.f0) || 112, 60, 400), scale: clamp(Number(base.scale) || 1, 0.8, 1.4), singer: clamp(Number(base.singer ?? 0), 0, 1)};
}

// ---------------------------------------------------------------------------------------------------------------
// Parsing and shared helpers for both planners.
function buildUnits(text, {dictionary = null, overrides = null} = {}) {
  const s = String(text ?? '');
  if (!s.trim()) throw new Error('Voice text is empty.');
  if (s.length > VOICE_LIMITS.maxChars) throw new Error(`Voice text is too long (max ${VOICE_LIMITS.maxChars} characters).`);
  const tokens = s.match(/\*?[A-Za-z][A-Za-z']*\*?|[,.!?;:]/g) || [];
  const units = [];
  for (const tok of tokens) {
    if (/^[,.!?;:]$/.test(tok)) { if (units.length && units[units.length - 1].type === 'word') units.push({type: 'pause', mark: tok}); continue; }
    const emph = tok.startsWith('*') || tok.endsWith('*');
    const w = tok.replace(/\*/g, '');
    const [info] = phonemize(w, {dictionary, overrides});
    if (!info) continue;
    const sylls = syllabify(info.phones).map((sy) => ({...sy, stress: sy.nucleus ? Number(sy.nucleus.slice(-1)) || 0 : 0}));
    const content = !FUNCTION_WORDS.has(info.word);
    if (!content && !emph && sylls.length === 1) sylls[0].stress = 0;
    units.push({type: 'word', w, phones: info.phones, source: info.source, emph, content, sylls});
  }
  if (!units.some((u) => u.type === 'word')) throw new Error('Voice text has no pronounceable words.');
  return units;
}

const base = (p) => p.replace(/\d$/, '');
function reduceVowel(F, stress, ph) {
  if (stress > 0 || ph === 'IY') return F;
  const k = ph === 'AH' ? 0 : 0.45;
  return F.map((f, i) => f + (SCHWA[i] - f) * k);
}

/** Natural duration (seconds) of one phone in context. */
function phoneDuration(raw, {role, stress, phraseFinal, emph, rate, afterS, stressedOnset}) {
  const ph = base(raw), P = PH[ph];
  if (!P) throw new Error(`Unknown phone "${raw}".`);
  const r = 1 / rate, rc = Math.pow(r, 0.8);
  if (P.c === 'v' || P.c === 'd') {
    let d = P.d * (stress === 0 ? 0.68 : stress === 1 ? 1.12 : 1.0);
    if (emph) d *= 1.3;
    if (phraseFinal) d *= 1.4;
    return d * r;
  }
  if (P.c === 's') return (P.clo + 0.012 + (P.v ? 0.008 : afterS ? 0.015 : role === 'onset' && stressedOnset ? 0.04 : 0.02)) * rc;
  if (P.c === 'a') return (P.clo + 0.012 + P.fd) * rc;
  return P.d * (P.c === 'n' ? 1.15 : 1) * (stress === 0 ? 0.88 : 1) * rc * (phraseFinal && role === 'coda' ? 1.15 : 1);
}

// ---------------------------------------------------------------------------------------------------------------
// Free speech plan.
const PAUSE = {',': 0.17, ';': 0.22, ':': 0.22, '.': 0.38, '!': 0.38, '?': 0.4};

/** Plan for a spoken line. Returns {segments, words, syllables, f0Points, end, mode}. Times are seconds from 0. */
export function planSpeech(text, {rate = 1.2, voice = 'narrator', dictionary = null, overrides = null, pauseScale = 1, lead = 0.05} = {}) {
  const v = resolveVoice(voice), units = buildUnits(text, {dictionary, overrides});
  const lastBeforePause = new Set();
  units.forEach((u, i) => { if (u.type === 'pause' || i === units.length - 1) { const w = units.slice(0, i + 1).filter((x) => x.type === 'word').length - 1; lastBeforePause.add(w); } });
  let t = lead;
  const segments = [], words = [], syllables = [];
  let wi = -1, gs = 0, clauseSylls = [], clauses = [];
  for (const u of units) {
    if (u.type === 'pause') { const d = (PAUSE[u.mark] ?? 0.2) * pauseScale; segments.push({ph: 'pau', raw: 'pau', t0: t, t1: t + d, word: wi, syl: -1}); t += d; clauses.push({list: clauseSylls, mark: u.mark}); clauseSylls = []; continue; }
    wi++;
    const word = {w: u.w, s: t, e: t, i: wi, source: u.source, phones: u.phones.slice(), content: u.content};
    u.sylls.forEach((sy, si) => {
      const isLastSyll = si === u.sylls.length - 1;
      const phraseFinal = isLastSyll && lastBeforePause.has(wi);
      const accent = sy.stress === 1 && (u.content || u.emph);
      const syl = {i: gs++, word: wi, stress: sy.stress, accent, emph: u.emph, t0: t, vs: null, ve: null, t1: t, phraseFinal};
      const pieces = [...sy.onset.map((p) => ['onset', p]), sy.nucleus ? ['nucleus', sy.nucleus] : null, ...sy.coda.map((p) => ['coda', p])].filter(Boolean);
      pieces.forEach(([role, raw], k) => {
        const prev = pieces[k - 1] && base(pieces[k - 1][1]);
        const d = phoneDuration(raw, {role, stress: sy.stress, phraseFinal, emph: u.emph, rate, afterS: prev === 'S', stressedOnset: sy.stress === 1});
        segments.push({ph: base(raw), raw, t0: t, t1: t + d, word: wi, syl: syl.i, role, stress: sy.stress, emph: u.emph});
        if (role === 'nucleus') { syl.vs = t; syl.ve = t + d; }
        t += d;
      });
      syl.t1 = t; syllables.push(syl); clauseSylls.push(syl);
    });
    word.e = t; words.push(word);
  }
  clauses.push({list: clauseSylls, mark: '.'});
  const f0Points = speechPitch(clauses.filter((c) => c.list.length), v);
  const end = t + 0.12;
  return {mode: 'speak', segments, words: words.map(finishWord), syllables, f0Points, end, vibratoFrom: null, voice: v};
}
const finishWord = (w) => ({w: w.w, s: round(w.s), e: round(w.e), i: w.i, source: w.source, phones: w.phones});

function speechPitch(clauses, v) {
  const pts = [];
  const f0 = v.f0, range = v.range;
  for (const {list, mark} of clauses) {
    list.forEach((sy, k) => {
      if (sy.vs === null) return;
      const prog = list.length > 1 ? k / (list.length - 1) : 0;
      const decl = 1.1 - 0.22 * prog + (k === 0 ? 0.04 * range : 0) + 0.012 * Math.sin(sy.i * 2.399);  // opening lift and a small deterministic wobble so no two syllables sit on the same note
      const accentUp = 1 + 0.2 * range * (sy.emph ? 1.4 : 1);
      let level = sy.accent ? accentUp : sy.stress > 0 ? 1.03 : 0.97 - 0.02 * range;
      let post = level;
      if (sy.phraseFinal) {
        if (mark === '?') { level = Math.max(level, 1.0); post = 1.0 + 0.4 * range; } else if (mark === ',' || mark === ';') post = level * 1.05;
        else post = level * (1 - 0.2 * range);
      }
      const mid = (sy.vs + sy.ve) / 2, a = f0 * decl;
      if (sy.accent) { const pk = sy.vs + 0.6 * (sy.ve - sy.vs); pts.push([sy.vs, a * level * 0.9], [pk, a * level], [sy.ve, a * post * 0.97]); } else { pts.push([sy.vs, a * level], [sy.ve, a * post]); }
    });
  }
  return pts;
}

// ---------------------------------------------------------------------------------------------------------------
// Musical plans: syllables on a beat grid.
const NOTE = {c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11};
export function noteHz(name) {
  const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(String(name));
  if (!m) throw new Error(`Bad note "${name}". Use names like E3, A#4, Bb2.`);
  const midi = 12 * (Number(m[3]) + 1) + NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  return 440 * 2 ** ((midi - 69) / 12);
}
const SCALES = {minor_pent: [0, 3, 5, 7, 10], major_pent: [0, 2, 4, 7, 9], minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11]};

function autoMelody(sylls, {root, scale, seed}) {
  const rng = mulberry32(seed), sc = SCALES[scale] || SCALES.minor_pent, n = sc.length;
  const midiAt = (deg) => root + 12 * Math.floor(deg / n) + sc[((deg % n) + n) % n];
  let deg = 2, out = [];
  sylls.forEach((sy, i) => {
    if (i > 0) {
      const r = rng();
      const steps = sy.stress > 0 ? [-2, -1, 1, 2, 3] : [-1, 0, 1];
      deg += steps[Math.floor(r * steps.length)];
    }
    deg = clamp(deg, 0, n + 2);
    if (i === sylls.length - 1) deg = n;  // end on the octave above the root
    out.push(440 * 2 ** ((midiAt(deg) - 69) / 12));
  });
  return out;
}

/**
 * Plan for a line performed on a beat grid. opts: mode 'rap' (spoken on the beat) or 'sing'; bpm; startSec (where beat 0
 * falls in the output); startBeat; grid (beats per unstressed syllable, default 0.5); notes (note names per syllable,
 * or omit for an automatic tune in `key`/`scale`); rhythm ([{beat,len}] per syllable to override placement).
 */
export function planMeter(text, {mode = 'rap', bpm = 100, startSec = 0, startBeat = 0, grid = 0.5, notes = null, rhythm = null, key = 'A', scale = 'minor_pent', seed = 7, voice = 'narrator', dictionary = null, overrides = null, hold = 2, gate = 0.92} = {}) {
  if (!['rap', 'sing'].includes(mode)) throw new Error('mode must be "rap" or "sing".');
  if (!(bpm >= 40 && bpm <= 220)) throw new Error('bpm must be 40-220.');
  const v = resolveVoice(voice), units = buildUnits(text, {dictionary, overrides});
  const spb = 60 / bpm, flat = [];
  units.forEach((u, ui) => {
    if (u.type === 'pause') { flat.push({pause: u.mark}); return; }
    u.sylls.forEach((sy, si) => flat.push({unit: ui, u, sy, si, last: si === u.sylls.length - 1}));
  });
  // 1. beat position of each syllable
  let pos = startBeat;
  const place = [];
  flat.forEach((x, i) => {
    if (x.pause) { pos = Math.ceil(pos - 1e-9) + (x.pause === ',' || x.pause === ';' || x.pause === ':' ? 0 : 1); return; }
    const k = place.length;
    const stressed = x.sy.stress === 1 && (x.u.content || x.u.emph);
    if (stressed && Math.abs(pos - Math.round(pos)) > 1e-6) pos = Math.ceil(pos);
    const wantBeat = rhythm && rhythm[k] ? rhythm[k].beat : pos;
    place.push({x, beat: wantBeat, stressed});
    const next = flat.slice(i + 1).find((y) => !y.pause);
    const nextStressed = next && next.sy.stress === 1 && (next.u.content || next.u.emph);
    pos = wantBeat + (stressed ? (nextStressed ? 1 : grid) : grid);
  });
  if (rhythm && rhythm.length < place.length) throw new Error(`rhythm needs ${place.length} entries (one per syllable), got ${rhythm.length}.`);
  // note length: until the next placed syllable (the last one holds)
  place.forEach((p, k) => {
    const nextBeat = place[k + 1] ? place[k + 1].beat : p.beat + hold;
    p.len = rhythm && rhythm[k] && rhythm[k].len ? rhythm[k].len : Math.max(0.25, nextBeat - p.beat);
  });
  // 2. pitches
  const rootMidi = (() => { const m = /^([A-Ga-g])([#b]?)$/.exec(String(key)); if (!m) throw new Error(`Bad key "${key}".`); const pc = NOTE[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); let midi = 12 * 3 + pc; const target = 69 + 12 * Math.log2(v.f0 / 440); while (midi < target - 3) midi += 12; while (midi > target + 9) midi -= 12; return midi; })();
  let pitches = null;
  if (mode === 'sing') {
    if (notes) { if (notes.length < place.length) throw new Error(`notes needs ${place.length} entries (one per syllable), got ${notes.length}.`); pitches = notes.slice(0, place.length).map((n) => (typeof n === 'number' ? n : noteHz(n))); } else pitches = autoMelody(place.map((p) => p.x.sy), {root: rootMidi, scale, seed});
  }
  // 3. durations and times
  const segments = [], syllables = [], f0Points = [], vibStarts = [];
  const wordMap = new Map();
  let prevEnd = -Infinity;
  place.forEach((p, k) => {
    const {x} = p, {sy, u} = x, noteT = startSec + p.beat * spb, avail = p.len * spb;
    const phraseFinal = k === place.length - 1;
    const mk = (raw, role, extra = {}) => {
      const dur = phoneDuration(raw, {role, stress: sy.stress, phraseFinal: false, emph: u.emph, rate: 1, afterS: false, stressedOnset: sy.stress === 1});
      return {raw, ph: base(raw), role, dur, ...extra};
    };
    const onset = sy.onset.map((r) => mk(r, 'onset')), coda = sy.coda.map((r) => mk(r, 'coda'));
    let onsetD = onset.reduce((s, q) => s + q.dur, 0), codaD = coda.reduce((s, q) => s + q.dur, 0);
    const room = 0.62 * avail, cons = onsetD + codaD;
    const shrink = cons > room ? Math.max(0.45, room / cons) : 1;
    [...onset, ...coda].forEach((q) => { q.dur *= shrink; });
    onsetD *= shrink; codaD *= shrink;
    const nat = sy.nucleus ? phoneDuration(sy.nucleus, {role: 'nucleus', stress: Math.max(1, sy.stress), phraseFinal: false, emph: u.emph, rate: 1}) : 0;
    let vowelD = Math.max(0.05, avail * gate - codaD);
    if (mode === 'rap') vowelD = Math.min(vowelD, nat * 1.45);
    // start the onset consonants early so the vowel lands on the beat; never overlap the previous syllable
    let start = noteT - onsetD;
    if (start < prevEnd) { const squeeze = Math.max(0.4, 1 - (prevEnd - start) / Math.max(onsetD, 1e-6)); onset.forEach((q) => { q.dur *= squeeze; }); const newOnset = onset.reduce((s, q) => s + q.dur, 0); start = Math.max(prevEnd, noteT - newOnset); onsetD = newOnset; }
    let t = start;
    const syl = {i: k, word: x.unit, stress: sy.stress, accent: p.stressed, emph: u.emph, t0: start, vs: noteT, ve: noteT + vowelD, t1: 0, beat: p.beat, len: p.len, phraseFinal};
    const push = (q) => { segments.push({ph: q.ph, raw: q.raw, t0: t, t1: t + q.dur, word: x.unit, syl: k, role: q.role, stress: sy.stress, emph: u.emph}); t += q.dur; };
    onset.forEach(push);
    if (sy.nucleus) { t = Math.max(t, noteT); segments.push({ph: base(sy.nucleus), raw: sy.nucleus, t0: t, t1: t + vowelD, word: x.unit, syl: k, role: 'nucleus', stress: Math.max(sy.stress, p.stressed ? 1 : 0), emph: u.emph, sustain: mode === 'sing'}); t += vowelD; }
    coda.forEach(push);
    syl.t1 = t; prevEnd = t; syllables.push(syl);
    if (!wordMap.has(x.unit)) wordMap.set(x.unit, {w: u.w, s: start, e: t, i: wordMap.size, source: u.source, phones: u.phones.slice()});
    else wordMap.get(x.unit).e = t;
    if (mode === 'sing') {
      const hz = pitches[k];
      f0Points.push([Math.max(0, noteT - 0.012), null], [noteT + 0.045, hz], [syl.ve, hz]);
      vibStarts.push(noteT);
    }
  });
  if (mode === 'rap') {
    // speech-like contour in a narrow band, accents on the beat syllables
    const clauses = [{list: syllables, mark: '.'}];
    f0Points.push(...speechPitch(clauses, {...v, range: v.range * 0.6}).map(([t, f]) => [t, f]));
  }
  const end = Math.max(...segments.map((s) => s.t1)) + 0.15;
  const wordsOut = [...wordMap.values()].map(finishWord);
  return {mode, bpm, segments, words: wordsOut, syllables, f0Points, end, vibratoFrom: mode === 'sing' ? vibStarts : null, voice: v, beatSec: spb, startSec};
}

// ---------------------------------------------------------------------------------------------------------------
// Synthesis.
class Track {
  constructor(v0 = 0) { this.t = [0]; this.v = [v0]; this.i = 0; }
  last() { return this.v[this.v.length - 1]; }
  lastT() { return this.t[this.t.length - 1]; }
  to(t, v) { this.t.push(Math.max(t, this.lastT())); this.v.push(v); }
  step(t, v, eps = 0.002) { this.to(t, this.last()); this.to(t + eps, v); }
  at(t) {
    const T = this.t, V = this.v;
    while (this.i + 1 < T.length && T[this.i + 1] <= t) this.i++;
    if (this.i + 1 >= T.length) return V[this.i];
    const a = T[this.i], b = T[this.i + 1];
    return V[this.i] + (V[this.i + 1] - V[this.i]) * ((t - a) / (b - a));
  }
}

class Resonator {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.y1 = 0; this.y2 = 0; }
  set(f, bw, sr) {
    f = clamp(f, 50, sr * 0.45); bw = clamp(bw, 20, sr * 0.4);
    const c = -Math.exp(-TAU * bw / sr), b = 2 * Math.exp(-Math.PI * bw / sr) * Math.cos(TAU * f / sr);
    this.c = c; this.b = b; this.a = 1 - b - c;
  }
  run(x) { const y = this.a * x + this.b * this.y1 + this.c * this.y2; this.y2 = this.y1; this.y1 = y; return y; }
}
class AntiResonator {
  constructor() { this.a = 1; this.b = 0; this.c = 0; this.x1 = 0; this.x2 = 0; }
  set(f, bw, sr) {
    f = clamp(f, 50, sr * 0.45);
    const c = -Math.exp(-TAU * bw / sr), b = 2 * Math.exp(-Math.PI * bw / sr) * Math.cos(TAU * f / sr), a = 1 - b - c;
    this.a = 1 / a; this.b = -b / a; this.c = -c / a;
  }
  run(x) { const y = this.a * x + this.b * this.x1 + this.c * this.x2; this.x2 = this.x1; this.x1 = x; return y; }
}

// Gains that set consonant level relative to vowels. Tuned by measurement (see scripts/voice-lab.mjs).
export const LEVELS = {voice: 1, aspiration: 0.55, frication: 0.3, burst: 0.35, aspTarget: 0.25, voiceBar: 0.12, nasal: 0.7, glide: 0.9, sibHp: 0.8};

function neighborFormants(segs, k, dir) {
  for (let j = k + dir, n = 0; j >= 0 && j < segs.length && n < 3; j += dir, n++) {
    const P = PH[segs[j].ph];
    if (P && (P.c === 'v' || P.c === 'd' || P.c === 'l' || P.c === 'n')) return dir > 0 ? {f: reduceVowel(P.f, segs[j].stress, segs[j].ph), z: P.z} : {f: reduceVowel(P.c === 'd' ? P.f2 : P.f, segs[j].stress, segs[j].ph), z: P.z};
    if (segs[j].ph === 'pau') break;
  }
  return null;
}

function buildTracks(plan, v) {
  const F = [new Track(500), new Track(1500), new Track(2500)], B = [new Track(70), new Track(100), new Track(150)];
  const AV = new Track(0), AH = new Track(0), AF = new Track(0), NZ = new Track(0), NF = new Track(1000), FC = new Track(5000), FBW = new Track(2000);
  const segs = plan.segments;
  const setF = (t, f, bw) => { for (let i = 0; i < 3; i++) { F[i].to(t, f[i]); B[i].to(t, bw ? bw[i] : [70, 100, 150][i]); } };
  const hold = (tr, t0, t1, val, ramp = 0.012) => { tr.to(t0 + ramp, val); tr.to(Math.max(t0 + ramp, t1 - ramp), val); };
  segs.forEach((s, k) => {
    const P = PH[s.ph], dur = s.t1 - s.t0, stressAmp = s.stress === 0 ? 0.78 : s.stress === 2 ? 0.92 : 1, amp = stressAmp * (s.emph ? 1.15 : 1);
    if (s.ph === 'pau') { AV.to(s.t0 + 0.02, 0); AH.to(s.t0 + 0.02, 0); AF.to(s.t0 + 0.02, 0); NZ.to(s.t0 + 0.02, 0); return; }
    const nextN = neighborFormants(segs, k, +1), prevN = neighborFormants(segs, k, -1);
    if (P.c === 'v' || P.c === 'd') {
      const pc = k > 0 ? PH[segs[k - 1].ph] : null, fast = Boolean(pc) && (pc.c === 's' || pc.c === 'a' || pc.c === 'f' || pc.c === 'n' || segs[k - 1].ph === 'L');
      const f1 = reduceVowel(P.f, s.stress, s.ph), tr = Math.min(fast ? 0.028 : 0.05, 0.35 * dur);
      if (P.c === 'v') { setF(s.t0 + tr, f1); setF(s.t1 - tr, f1); } else {
        const f2 = P.f2, hz1 = Math.min(0.06, 0.25 * dur);
        setF(s.t0 + hz1, f1); setF(s.t1 - Math.min(0.05, 0.2 * dur), f2);
      }
      hold(AV, s.t0, s.t1, amp, 0.014); hold(AH, s.t0, s.t1, v.breath, 0.015); hold(AF, s.t0, s.t1, 0, 0.008);
      const nasalNear = (nextN && nextN.z && segs[k + 1] && PH[segs[k + 1].ph].c === 'n') ? 0.4 : 0;
      NZ.to(s.t0 + 0.01, 0); NZ.to(s.t1 - dur * 0.45, 0); NZ.to(s.t1 - 0.005, nasalNear);
    } else if (P.c === 'l') {
      setF(s.t0 + 0.012, P.f, [70, 110, 170]); setF(s.t1 - 0.012, P.f, [70, 110, 170]);
      hold(AV, s.t0, s.t1, amp * LEVELS.glide * 0.9); hold(AH, s.t0, s.t1, v.breath); hold(AF, s.t0, s.t1, 0); NZ.to(s.t0 + 0.01, 0);
    } else if (P.c === 'n') {
      setF(s.t0 + 0.012, P.f, [60, 120, 200]); setF(s.t1 - 0.012, P.f, [60, 120, 200]);
      hold(AV, s.t0, s.t1, amp * LEVELS.nasal, 0.012); hold(AH, s.t0, s.t1, v.breath * 0.5); hold(AF, s.t0, s.t1, 0);
      NF.to(s.t0 + 0.005, P.z); NF.to(s.t1, P.z); NZ.to(s.t0 + 0.012, 1); NZ.to(s.t1 - 0.012, 1);
    } else if (P.c === 'h') {
      const nb = nextN ? nextN.f : SCHWA;
      setF(s.t0 + 0.015, nb); setF(s.t1, nb);
      AV.to(s.t0 + 0.01, 0); AV.to(s.t1 - 0.005, 0); hold(AH, s.t0, s.t1, 1.0 * amp, 0.015); hold(AF, s.t0, s.t1, 0); NZ.to(s.t0 + 0.01, 0);
    } else {
      // obstruents: formants glide toward the neighbouring vowel with a place "locus"
      const nb = (nextN || prevN || {f: SCHWA}).f, loc = LOCUS_F2[P.place] ?? 1700;
      const w = P.c === 'f' ? 0.5 : 0.7, velar = P.place === 'v';
      // velars pinch F2 up toward F3; labials start with a low F2; alveolars aim near 1.8 kHz
      const target = [300 + 0.25 * (nb[0] - 300), velar ? nb[1] + 0.4 * (nb[2] - nb[1]) : loc * w + nb[1] * (1 - w), P.place === 'a' ? 2700 * 0.3 + nb[2] * 0.7 : velar ? nb[2] - 0.08 * (nb[2] - nb[1]) : nb[2]];
      NZ.to(s.t0 + 0.01, 0);
      if (P.c === 'f') {
        FC.step(s.t0, P.fc); FBW.step(s.t0, P.bw);
        setF(s.t0 + 0.02, target); setF(s.t1, target);
        const voiced = P.v;
        hold(AF, s.t0, s.t1, P.amp * amp * (voiced ? 0.85 : 1) * LEVELS.frication, 0.015);
        hold(AV, s.t0, s.t1, voiced ? 0.28 * amp : 0, 0.012); hold(AH, s.t0, s.t1, 0);
      } else {
        const prevVoiced = k > 0 && (() => { const q = PH[segs[k - 1].ph]; return Boolean(q) && (q.c === 'v' || q.c === 'd' || q.c === 'l' || q.c === 'n' || (q.c === 'f' && q.v === 1)); })();
        const lead = P.v === 1 && !prevVoiced;  // voiced stop after silence/voiceless sound: no pre-voicing, voicing starts just after the burst
        const closure = Math.min(lead ? P.clo * 0.5 : P.clo, dur * 0.55), tb = s.t0 + closure;
        setF(s.t0 + 0.012, [250, target[1], target[2]]); setF(tb, [250 + 0.1 * (nb[0] - 250), target[1], target[2]]);
        if (P.c === 's') setF(s.t1, [250 + 0.55 * (nb[0] - 250), target[1] + 0.55 * (nb[1] - target[1]), target[2] + 0.55 * (nb[2] - target[2])]);  // most of the transition happens during the release
        AF.to(s.t0 + 0.006, 0); AH.to(s.t0 + 0.006, 0);
        if (P.v && !lead) { AV.to(s.t0 + 0.008, LEVELS.voiceBar); AV.to(tb, LEVELS.voiceBar); } else { AV.to(s.t0 + 0.006, 0); AV.to(tb, 0); }
        const b = P.burst;
        FC.step(tb - 0.002, velar ? clamp(nb[1] + 0.15 * (nb[2] - nb[1]), 900, 3200) : b.fc); FBW.step(tb - 0.002, b.bw);
        AF.step(tb, b.amp * LEVELS.burst * amp, 0.001); AF.to(tb + 0.003, b.amp * LEVELS.burst * amp * 0.5); AF.to(tb + 0.009, 0);
        if (P.c === 'a') {
          FC.step(tb + 0.012, P.fc); FBW.step(tb + 0.012, P.bw);
          const fe = s.t1;
          setF(tb + 0.02, target); setF(fe, target);
          AF.to(tb + 0.02, P.amp * amp * LEVELS.frication); AF.to(fe - 0.012, P.amp * amp * LEVELS.frication); AF.to(fe, 0);
          if (P.v) AV.to(tb + 0.02, 0.3 * amp);
        } else if (!P.v) {
          const vot = s.t1 - tb - 0.012;
          if (vot > 0.004) { AH.to(tb + 0.009, 0.75 * amp); AH.to(s.t1, 0.4 * amp); }
        } else if (lead) { AV.to(tb + 0.008, 0.25 * amp); AV.to(Math.min(s.t1, tb + 0.03), 0.8 * amp); } else AV.to(s.t1, 0.5 * amp);
      }
    }
  });
  const end = plan.end + 0.2;
  for (const tr of [...F, ...B, AV, AH, AF, NZ]) tr.to(end, tr.last());
  AV.to(end, 0); AH.to(end, 0); AF.to(end, 0);
  // pitch
  const f0t = new Track(v.f0 * 1.05);
  let last = v.f0 * 1.05;
  for (const [t, f] of [...plan.f0Points].sort((a, b) => a[0] - b[0])) { const val = f === null ? last : f; f0t.to(t, val); last = val; }
  f0t.to(end, last);
  return {F, B, AV, AH, AF, NZ, NF, FC, FBW, f0: f0t};
}

/** Per-block gains that make the short-time RMS of `sig` follow `target` (the loudness the plan asked for). */
function agcGains(sig, target, block, winBlocks) {
  const nb = target.length, pre = new Float64Array(nb + 1);
  for (let b = 0; b < nb; b++) { let s = 0; const a = b * block, z = Math.min(sig.length, a + block); for (let i = a; i < z; i++) s += sig[i] * sig[i]; pre[b + 1] = pre[b] + s / block; }
  const g = new Float32Array(nb), h = Math.max(1, winBlocks >> 1);
  let prev = 0;
  for (let b = 0; b < nb; b++) {
    const lo = Math.max(0, b - h), hi = Math.min(nb, b + h + 1), rms = Math.sqrt((pre[hi] - pre[lo]) / (hi - lo));
    const want = target[b] > 1e-4 ? Math.min(target[b] / (rms + 1e-5), 4000) : 0;
    prev += (want - prev) * (want > prev ? 0.5 : 0.35);
    g[b] = prev;
  }
  return g;
}
function applyGains(out, sig, g, block, add) {
  const nb = g.length;
  for (let i = 0; i < sig.length; i++) {
    const p = i / block - 0.5, b0 = Math.max(0, Math.min(nb - 1, Math.floor(p))), b1 = Math.min(nb - 1, b0 + 1), f = Math.max(0, Math.min(1, p - b0));
    out[i] = (add ? out[i] : 0) + sig[i] * (g[b0] * (1 - f) + g[b1] * f);
  }
}

/**
 * Render a plan to audio. Returns {sampleRate, samples (Float32Array, mono), seconds}. Deterministic for a given seed.
 */
export function synthesize(plan, {voice = plan.voice, sampleRate = 44100, seed = 1, level = 0.8} = {}) {
  const v = resolveVoice(voice);
  if (!VOICE_LIMITS.sampleRates.includes(sampleRate)) throw new Error(`sampleRate must be one of ${VOICE_LIMITS.sampleRates.join(', ')}.`);
  if (plan.end > VOICE_LIMITS.maxSeconds + 1) throw new Error(`Voice would be ${round(plan.end, 1)}s; the limit is ${VOICE_LIMITS.maxSeconds}s.`);
  const sr = sampleRate, tr = buildTracks(plan, v), rng = mulberry32(seed);
  const n = Math.ceil((plan.end + 0.2) * sr), out = new Float32Array(n), vo = new Float32Array(n), frn = new Float32Array(n);
  const R = [new Resonator(), new Resonator(), new Resonator(), new Resonator(), new Resonator()], nasalPole = new Resonator(), nasalZero = new AntiResonator();
  const fric1 = new Resonator(), fric2 = new Resonator(), singer = new Resonator();
  let nP1 = 0, nP2 = 0;
  const BLOCK = 32, nBlocks = Math.ceil(n / BLOCK), tgtV = new Float32Array(nBlocks), tgtF = new Float32Array(nBlocks);
  const noise = () => rng() * 2 - 1;
  let phase = 0, shim = 1;
  const oq = v.oq;
  let lp = 0, xPrev = 0;
  const emph = clamp(Number(v.emphasis ?? 0.85), 0, 0.98), bws = clamp(Number(v.bwScale ?? 1), 0.5, 3);
  const tiltK = clamp(v.tilt, 0, 0.95);
  const vib = plan.vibratoFrom, vibDepth = v.vibrato, vibRate = 5.6;
  let vi = 0;
  const glottal = (ph, o) => {
    const sq = 2.2, tp = o * sq / (1 + sq), tn = o - tp;
    if (ph < tp) return (0.5 * Math.PI / tp) * Math.sin(Math.PI * ph / tp) / (Math.PI / (2 * tn));
    if (ph < o) return -Math.sin(Math.PI * (ph - tp) / (2 * tn));
    return 0;
  };
  singer.set(2900, 350, sr);
  for (let b0 = 0; b0 < n; b0 += BLOCK) {
    const t = b0 / sr;
    let f0 = tr.f0.at(t);
    if (vib) {
      while (vi + 1 < vib.length && vib[vi + 1] <= t) vi++;
      const since = t - vib[vi];
      const env = clamp((since - 0.22) / 0.25, 0, 1);
      f0 *= 2 ** ((vibDepth * env * Math.sin(TAU * vibRate * t)) / 12);
    }
    const av = tr.AV.at(t), ah = tr.AH.at(t), af = tr.AF.at(t), nz = tr.NZ.at(t);
    tgtV[b0 / BLOCK] = av + ah * LEVELS.aspTarget; tgtF[b0 / BLOCK] = af;
    const sc = v.scale, f1 = tr.F[0].at(t) * sc, f2 = tr.F[1].at(t) * sc, f3 = tr.F[2].at(t) * sc;
    R[0].set(f1, (tr.B[0].at(t) + (nz > 0.5 ? 60 * nz : 0)) * bws, sr); R[1].set(f2, tr.B[1].at(t) * bws, sr); R[2].set(f3, tr.B[2].at(t) * bws, sr);
    R[3].set(3300 * sc, 250, sr); R[4].set(3750 * sc, 200, sr);
    nasalPole.set(270, 100, sr); nasalZero.set(tr.NF.at(t) * sc, 120, sr);
    const fc = tr.FC.at(t), fb = tr.FBW.at(t);
    fric1.set(fc, fb, sr); fric2.set(Math.min(fc * 1.4, sr * 0.44), fb * 1.2, sr);
    const hpm = LEVELS.sibHp * clamp((fc - 3500) / 2500, 0, 1);  // S and Z: steepen the low edge of the noise so it is a narrow high hiss, not broadband static
    for (let i = b0; i < Math.min(n, b0 + BLOCK); i++) {
      phase += f0 / sr;
      if (phase >= 1) { phase -= 1; shim = 1 + v.shimmer * (rng() * 2 - 1); }
      const voiced = av > 0.002 ? glottal(phase, oq) * av * shim * LEVELS.voice : 0;
      lp = lp + (1 - tiltK) * (voiced - lp);
      const asp = noise() * (ah * LEVELS.aspiration * 0.22 + (av > 0.002 ? av * v.breath * 0.15 : 0));
      let x = lp + asp;
      if (nz > 0.001) { const y = nasalZero.run(nasalPole.run(x)); x = x * (1 - nz) + y * nz * 0.9; } else { nasalZero.run(nasalPole.run(x)); }
      for (let k = 0; k < 5; k++) x = R[k].run(x);
      if (v.singer > 0) x += singer.run(x) * v.singer * 0.9;
      { const xe = x - emph * xPrev; xPrev = x; x = xe; }  // pre-emphasis: lifts F2/F3, which carry most of the intelligibility
      let fr = 0;
      if (af > 0.002) { const n0 = noise(), n1 = n0 - hpm * 0.97 * nP1, nn = n1 - hpm * 0.97 * nP2; nP1 = n0; nP2 = n1; fr = (fric1.run(nn) + 0.6 * fric2.run(nn)) * af * (av > 0.1 ? 0.55 + 0.45 * Math.max(0, glottal(phase, oq)) : 1); } else { fric1.run(0); fric2.run(0); }
      vo[i] = x; frn[i] = fr;
    }
  }
  applyGains(out, vo, agcGains(vo, tgtV, BLOCK, Math.round(0.02 * sr / BLOCK)), BLOCK, false);
  applyGains(out, frn, agcGains(frn, tgtF, BLOCK, Math.max(2, Math.round(0.006 * sr / BLOCK))), BLOCK, true);
  let peak = 0;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(out[i]));
  const g = peak > 0 ? level / peak : 1;
  for (let i = 0; i < n; i++) out[i] = Math.tanh(out[i] * g * 1.15) / Math.tanh(1.15);
  return {sampleRate: sr, samples: out, seconds: n / sr};
}

/** Phoneme-level timings for captions, lip-sync or analysis: [{p, s, e, w, word}]. */
export function phoneTimings(plan) {
  return plan.segments.filter((s) => s.ph !== 'pau').map((s) => ({p: s.raw, s: round(s.t0), e: round(s.t1), w: plan.words[s.word]?.w ?? null, word: s.word}));
}

/** Words in the {w, s, e} form the track library and caption layers use. */
export const wordTimings = (plan) => plan.words.map(({w, s, e}) => ({w, s, e}));

/** Mono voice as {left,right,sampleRate} so lib/adSong.js encodeWav can write it. */
export function toStereo(mono, {pan = 0} = {}) {
  const l = Math.cos((pan + 1) * Math.PI / 4), r = Math.sin((pan + 1) * Math.PI / 4);
  const left = new Float32Array(mono.samples.length), right = new Float32Array(mono.samples.length);
  for (let i = 0; i < left.length; i++) { left[i] = mono.samples[i] * l * 1.414; right[i] = mono.samples[i] * r * 1.414; }
  return {sampleRate: mono.sampleRate, left, right, seconds: mono.seconds};
}

/** Mix voice over music. `delay` seconds shifts the voice; `duck` lowers the music under it. */
export function mixVoice(music, voice, {delay = 0, voiceGain = 1, musicGain = 0.8, duck = 0.45} = {}) {
  if (music.sampleRate !== voice.sampleRate) throw new Error('Voice and music need the same sample rate.');
  const sr = music.sampleRate, n = Math.max(music.left.length, Math.round((delay + voice.seconds) * sr));
  const L = new Float32Array(n), R = new Float32Array(n), off = Math.round(delay * sr);
  let env = 0;
  const att = Math.exp(-1 / (0.01 * sr)), rel = Math.exp(-1 / (0.18 * sr));
  for (let i = 0; i < n; i++) {
    const vs = i - off >= 0 && i - off < voice.samples.length ? voice.samples[i - off] : 0;
    const a = Math.abs(vs);
    env = a > env ? a + (env - a) * att : a + (env - a) * rel;
    const dg = 1 - duck * Math.min(1, env * 3);
    const m = i < music.left.length ? 1 : 0;
    L[i] = (m ? music.left[i] * musicGain * dg : 0) + vs * voiceGain;
    R[i] = (m ? music.right[i] * musicGain * dg : 0) + vs * voiceGain;
  }
  return {sampleRate: sr, left: L, right: R};
}

/** One-call helper: text -> {audio, words, phones, plan}. */
export function speak(text, opts = {}) {
  const {mode = 'speak', sampleRate = 44100, seed = 1, level, ...rest} = opts;
  const plan = mode === 'speak' ? planSpeech(text, rest) : planMeter(text, {mode, ...rest});
  const audio = synthesize(plan, {sampleRate, seed, level});
  return {audio, plan, words: wordTimings(plan), phones: phoneTimings(plan)};
}
