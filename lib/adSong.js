// Songs as data. A song is a small JSON document (tempo, bars and tracks of notes or drum patterns) that a
// deterministic synth turns into audio, so Claude or ChatGPT can write a jingle the same way they write an ad.
// No audio files, no network, no external service: same song in, same samples out. The beat clock and band
// envelopes for the visuals come from the same data (see scripts/render-song.mjs), so picture and sound line up.
//
//   {
//     "name": "Slice Time", "bpm": 128, "bars": 8,
//     "tracks": [
//       { "voice": "kick",  "pattern": "x...x...x...x...", "startBar": 1 },        // 16 steps per bar
//       { "voice": "bass",  "notes": [[0, "C2", 0.75], [1.5, "C3", 0.5]], "loopBars": 1 },
//       { "voice": "pad",   "notes": [[0, ["C4", "E4", "G4"], 4]], "vol": 0.5 }
//     ]
//   }
//
// Drum patterns: '.' or '-' rest, 'o' soft, 'x' normal, 'X' accent; the length is a multiple of 16 (16 steps = 1 bar).
// Melodic notes: [beat, pitch or [pitches], lengthInBeats, velocity 0-1 (optional)]. Beats are counted from the start of
// the track's loop (4 beats per bar). A track repeats every `loopBars` bars between `startBar` and `endBar`.

export const SONG_LIMITS = Object.freeze({
  bpmMin: 60, bpmMax: 200, barsMax: 32, tracksMax: 12, notesPerTrackMax: 400, eventsMax: 4000, secondsMax: 30,
  patternMax: 128, chordMax: 6, nameMax: 60,
});
export const SONG_DRUM_VOICES = Object.freeze(['kick', 'snare', 'hat', 'ohat', 'clap']);
export const SONG_MELODIC_VOICES = Object.freeze(['bass', 'lead', 'pluck', 'pad', 'bell']);
export const SONG_VOICES = Object.freeze([...SONG_DRUM_VOICES, ...SONG_MELODIC_VOICES]);
const STEP_VELOCITY = { o: 0.45, x: 0.8, X: 1 };
const PITCH_CLASS = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// "C4" -> 60, "F#3", "Bb2"; integers 24-108 are taken as MIDI numbers. NaN if invalid.
export function noteToMidi(n) {
  if (typeof n === 'number') return Number.isInteger(n) && n >= 24 && n <= 108 ? n : NaN;
  const m = /^([A-G])([#b]?)(-?\d)$/.exec(String(n));
  if (!m) return NaN;
  const v = PITCH_CLASS[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (Number(m[3]) + 1) * 12;
  return v >= 24 && v <= 108 ? v : NaN;
}
export const midiToHz = (m) => 440 * 2 ** ((m - 69) / 12);

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const inRange = (v, a, b) => typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b;

/** Check a song and return { ok, errors, value } where value is the normalised song (only when ok). */
export function validateSong(raw) {
  const errors = [];
  const L = SONG_LIMITS;
  if (!isObj(raw)) return { ok: false, errors: ['song: must be an object'] };
  for (const k of Object.keys(raw)) if (!['name', 'bpm', 'bars', 'tracks'].includes(k)) errors.push(`song.${k}: unknown field`);
  const name = raw.name === undefined ? 'Untitled song' : raw.name;
  if (typeof name !== 'string' || !name.trim() || [...name].length > L.nameMax) errors.push(`song.name: text up to ${L.nameMax} characters`);
  if (!inRange(raw.bpm, L.bpmMin, L.bpmMax)) errors.push(`song.bpm: number between ${L.bpmMin} and ${L.bpmMax}`);
  if (!(Number.isInteger(raw.bars) && raw.bars >= 1 && raw.bars <= L.barsMax)) errors.push(`song.bars: whole number between 1 and ${L.barsMax}`);
  if (!Array.isArray(raw.tracks) || raw.tracks.length < 1 || raw.tracks.length > L.tracksMax) errors.push(`song.tracks: 1 to ${L.tracksMax} tracks`);
  if (errors.length) return { ok: false, errors };
  const seconds = (raw.bars * 4 * 60) / raw.bpm;
  if (seconds > L.secondsMax) errors.push(`song: ${seconds.toFixed(1)}s is longer than ${L.secondsMax}s (use fewer bars or a faster tempo)`);
  const bars = raw.bars;
  let events = 0;
  const tracks = raw.tracks.map((t, i) => {
    const p = `song.tracks[${i}]`;
    if (!isObj(t)) { errors.push(`${p}: must be an object`); return null; }
    for (const k of Object.keys(t)) if (!['voice', 'vol', 'pan', 'pattern', 'notes', 'startBar', 'endBar', 'loopBars'].includes(k)) errors.push(`${p}.${k}: unknown field`);
    if (!SONG_VOICES.includes(t.voice)) { errors.push(`${p}.voice: one of ${SONG_VOICES.join(', ')}`); return null; }
    const drum = SONG_DRUM_VOICES.includes(t.voice);
    const vol = t.vol === undefined ? 0.8 : t.vol, pan = t.pan === undefined ? 0 : t.pan;
    if (!inRange(vol, 0, 1)) errors.push(`${p}.vol: number between 0 and 1`);
    if (!inRange(pan, -1, 1)) errors.push(`${p}.pan: number between -1 and 1`);
    const startBar = t.startBar === undefined ? 0 : t.startBar, endBar = t.endBar === undefined ? bars : t.endBar;
    if (!(Number.isInteger(startBar) && startBar >= 0 && startBar < bars)) errors.push(`${p}.startBar: whole number from 0 to ${bars - 1}`);
    if (!(Number.isInteger(endBar) && endBar >= 1 && endBar <= bars && endBar > startBar)) errors.push(`${p}.endBar: whole number after startBar, up to ${bars}`);
    const track = { voice: t.voice, vol, pan, startBar, endBar, loopBars: bars, steps: null, notes: null };
    if (drum) {
      if (t.notes !== undefined) errors.push(`${p}.notes: drums use a pattern string`);
      if (typeof t.pattern !== 'string' || !/^[.\-oxX]+$/.test(t.pattern) || t.pattern.length % 16 !== 0 || t.pattern.length > L.patternMax) {
        errors.push(`${p}.pattern: ". - o x X" characters, a multiple of 16 long (max ${L.patternMax})`);
      } else {
        track.loopBars = t.pattern.length / 16;
        track.steps = [...t.pattern].map((c) => (c === '.' || c === '-' ? 0 : STEP_VELOCITY[c]));
        events += track.steps.filter(Boolean).length * Math.ceil((endBar - startBar) / track.loopBars);
      }
      if (t.loopBars !== undefined) errors.push(`${p}.loopBars: set by the pattern length for drums`);
    } else {
      if (t.pattern !== undefined) errors.push(`${p}.pattern: ${t.voice} uses notes`);
      if (t.loopBars !== undefined) {
        if (!(Number.isInteger(t.loopBars) && t.loopBars >= 1 && t.loopBars <= bars)) errors.push(`${p}.loopBars: whole number from 1 to ${bars}`);
        else track.loopBars = t.loopBars;
      }
      if (!Array.isArray(t.notes) || t.notes.length < 1 || t.notes.length > L.notesPerTrackMax) {
        errors.push(`${p}.notes: 1 to ${L.notesPerTrackMax} notes`);
      } else {
        const loopBeats = track.loopBars * 4;
        track.notes = [];
        t.notes.forEach((n, j) => {
          const q = `${p}.notes[${j}]`;
          if (!Array.isArray(n) || n.length < 3 || n.length > 4) return errors.push(`${q}: [beat, pitch or [pitches], length, velocity?]`);
          const [beat, pitch, len, vel = 0.8] = n;
          if (!inRange(beat, 0, loopBeats - 0.0001)) errors.push(`${q}: beat must be from 0 to ${loopBeats} (loop length)`);
          const list = Array.isArray(pitch) ? pitch : [pitch];
          if (list.length < 1 || list.length > L.chordMax) errors.push(`${q}: 1 to ${L.chordMax} pitches`);
          const midi = list.map(noteToMidi);
          if (midi.some(Number.isNaN)) errors.push(`${q}: pitches look like C4, F#3, Bb2 (C1 to C8) or MIDI 24-108`);
          if (!inRange(len, 0.05, 16)) errors.push(`${q}: length must be 0.05 to 16 beats`);
          if (!inRange(vel, 0, 1)) errors.push(`${q}: velocity must be 0 to 1`);
          track.notes.push({ t: beat, midi, d: len, v: vel });
        });
        events += track.notes.reduce((n, x) => n + x.midi.length, 0) * Math.ceil((endBar - startBar) / track.loopBars);
      }
    }
    return track;
  });
  if (events > L.eventsMax) errors.push(`song: ${events} notes after repeats, max ${L.eventsMax}`);
  if (errors.length) return { ok: false, errors };
  return { ok: true, errors: [], value: { name: name.trim(), bpm: raw.bpm, bars, seconds, tracks } };
}

// ---------------------------------------------------------------------------------------------------------
// Synth. Every voice adds into a mono track buffer; tracks are panned into stereo and soft-limited.

const mulberry32 = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const blep = (t, dt) => {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
};
const saw = (ph, dt) => 2 * ph - 1 - blep(ph, dt);
const square = (ph, dt) => (ph < 0.5 ? 1 : -1) + blep(ph, dt) - blep((ph + 0.5) % 1, dt);
// Attack / decay / sustain / release envelope for a note of `dur` seconds, t seconds into it.
const adsr = (t, dur, a, d, s, r) => {
  const level = (x) => (x < a ? x / a : x < a + d ? 1 - (1 - s) * ((x - a) / d) : s);
  return t < dur ? level(t) : level(dur) * Math.max(0, 1 - (t - dur) / r);
};
const lpCoef = (hz, sr) => 1 - Math.exp((-2 * Math.PI * hz) / sr);

const VOICES = {
  kick(buf, i0, sr, { vel }) {
    const n = Math.min(buf.length - i0, Math.floor(sr * 0.45));
    let ph = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      ph += (2 * Math.PI * (45 + 110 * Math.exp(-t * 28))) / sr;
      buf[i0 + i] += (Math.sin(ph) * Math.exp(-t * 7.5) + (t < 0.004 ? (1 - t / 0.004) * 0.4 : 0)) * vel * 0.95;
    }
  },
  snare(buf, i0, sr, { vel, rnd }) {
    const n = Math.min(buf.length - i0, Math.floor(sr * 0.3));
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, x = rnd() * 2 - 1;
      lp += 0.35 * (x - lp);
      buf[i0 + i] += ((x - lp) * 0.8 * Math.exp(-t * 20) + Math.sin(2 * Math.PI * 185 * t) * Math.exp(-t * 30) * 0.5) * vel * 0.7;
    }
  },
  hat(buf, i0, sr, { vel, rnd }, open = false) {
    const n = Math.min(buf.length - i0, Math.floor(sr * (open ? 0.4 : 0.09)));
    let prev = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, x = rnd() * 2 - 1;
      buf[i0 + i] += (x - prev) * Math.exp(-t * (open ? 14 : 90)) * vel * 0.35;
      prev = x;
    }
  },
  ohat(buf, i0, sr, p) { VOICES.hat(buf, i0, sr, p, true); },
  clap(buf, i0, sr, { vel, rnd }) {
    const n = Math.min(buf.length - i0, Math.floor(sr * 0.3));
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, x = rnd() * 2 - 1;
      lp += 0.3 * (x - lp);
      const env = t < 0.036 ? Math.exp(-((t % 0.012) * 90)) : Math.exp(-(t - 0.036) * 18);
      buf[i0 + i] += (x - lp) * env * vel * 0.55;
    }
  },
  bass(buf, i0, sr, { vel, f, dur }) {
    const rel = 0.06, n = Math.min(buf.length - i0, Math.floor(sr * (dur + rel))), dt = f / sr;
    let ph = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      const x = 0.6 * saw(ph, dt) + 0.5 * Math.sin(2 * Math.PI * ph);
      lp += lpCoef(500 + 1800 * Math.exp(-t * 14), sr) * (x - lp);
      buf[i0 + i] += lp * adsr(t, dur, 0.005, 0.12, 0.6, rel) * vel * 0.55;
      ph = (ph + dt) % 1;
    }
  },
  lead(buf, i0, sr, { vel, f, dur }) {
    const rel = 0.12, n = Math.min(buf.length - i0, Math.floor(sr * (dur + rel)));
    let ph = 0, ph2 = 0, lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr, fv = f * (1 + 0.006 * Math.sin(2 * Math.PI * 5.5 * t) * Math.min(1, Math.max(0, t - 0.12) / 0.3));
      const dt = fv / sr, dt2 = (fv * 1.004) / sr;
      lp += lpCoef(3500, sr) * (0.5 * square(ph, dt) + 0.25 * saw(ph2, dt2) - lp);
      buf[i0 + i] += lp * adsr(t, dur, 0.01, 0.1, 0.7, rel) * vel * 0.3;
      ph = (ph + dt) % 1; ph2 = (ph2 + dt2) % 1;
    }
  },
  pluck(buf, i0, sr, { vel, f, dur, rnd }) {
    const N = Math.max(2, Math.round(sr / f)), line = new Float32Array(N);
    let lp = 0;
    for (let i = 0; i < N; i++) { lp += 0.5 * ((rnd() * 2 - 1) - lp); line[i] = lp; }
    const n = Math.min(buf.length - i0, Math.floor(sr * Math.min(1.2, dur + 0.35)));
    let k = 0;
    for (let i = 0; i < n; i++) {
      const a = line[k], b = line[(k + 1) % N], y = 0.5 * (a + b) * 0.997;
      line[k] = y; k = (k + 1) % N;
      buf[i0 + i] += y * vel * 0.9;
    }
  },
  pad(buf, i0, sr, { vel, f, dur }) {
    const rel = 0.45, n = Math.min(buf.length - i0, Math.floor(sr * (dur + rel)));
    const detune = [2 ** (-8 / 1200), 1, 2 ** (8 / 1200)], ph = [0, 0.33, 0.66];
    let lp = 0;
    for (let i = 0; i < n; i++) {
      const t = i / sr;
      let x = 0;
      for (let v = 0; v < 3; v++) { const dt = (f * detune[v]) / sr; x += saw(ph[v], dt) * 0.12; ph[v] = (ph[v] + dt) % 1; }
      lp += lpCoef(1600, sr) * (x - lp);
      buf[i0 + i] += lp * adsr(t, dur, 0.18, 0.1, 0.85, rel) * vel * 0.6;
    }
  },
  bell(buf, i0, sr, { vel, f }) {
    const n = Math.min(buf.length - i0, Math.floor(sr * 1.4));
    for (let i = 0; i < n; i++) {
      const t = i / sr, idx = 2 * Math.exp(-t * 3);
      const x = Math.sin(2 * Math.PI * f * t + idx * Math.sin(2 * Math.PI * f * 3.5 * t));
      buf[i0 + i] += x * Math.exp(-t * 2.6) * Math.min(1, t / 0.003) * vel * 0.35;
    }
  },
};

/**
 * Render a song to stereo audio. Throws if the song is invalid.
 * @returns {{ sampleRate: number, left: Float32Array, right: Float32Array, seconds: number, bpm: number }}
 */
export function renderSong(rawSong, { sampleRate = 44100 } = {}) {
  const checked = validateSong(rawSong);
  if (!checked.ok) throw new Error(`Invalid song: ${checked.errors.slice(0, 4).join(' | ')}`);
  if (!(sampleRate >= 8000 && sampleRate <= 96000)) throw new Error('sampleRate must be 8000 to 96000');
  const song = checked.value, spb = 60 / song.bpm;
  const total = Math.ceil((song.seconds + 1) * sampleRate); // one second of tail for releases
  const left = new Float32Array(total), right = new Float32Array(total);
  song.tracks.forEach((track, ti) => {
    const buf = new Float32Array(total), rnd = mulberry32(1234 + ti * 977);
    const events = [];
    for (let bar = track.startBar; bar < track.endBar; bar += track.loopBars) {
      if (track.steps) {
        track.steps.forEach((v, s) => { if (v) events.push({ beat: bar * 4 + s / 4, vel: v, midi: [60], d: 0.25 }); });
      } else {
        for (const n of track.notes) events.push({ beat: bar * 4 + n.t, vel: n.v, midi: n.midi, d: n.d });
      }
    }
    events.sort((a, b) => a.beat - b.beat);
    for (const e of events) {
      if (e.beat >= track.endBar * 4) continue;
      const i0 = Math.round(e.beat * spb * sampleRate);
      if (i0 >= total) continue;
      for (const m of e.midi) VOICES[track.voice](buf, i0, sampleRate, { vel: e.vel, f: midiToHz(m), dur: e.d * spb, rnd });
    }
    const ang = ((track.pan + 1) * Math.PI) / 4, gl = Math.cos(ang) * track.vol, gr = Math.sin(ang) * track.vol;
    for (let i = 0; i < total; i++) { left[i] += buf[i] * gl; right[i] += buf[i] * gr; }
  });
  // Soft limiter, peak normalise, tiny fades so the file starts and ends without clicks.
  let peak = 0;
  for (let i = 0; i < total; i++) { left[i] = Math.tanh(1.2 * left[i]); right[i] = Math.tanh(1.2 * right[i]); peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i])); }
  const g = peak > 0 ? 0.92 / peak : 1, fade = Math.floor(sampleRate * 0.02);
  for (let i = 0; i < total; i++) {
    const f = Math.min(1, i / 96, (total - 1 - i) / fade);
    left[i] *= g * f; right[i] *= g * f;
  }
  return { sampleRate, left, right, seconds: Math.round(total / sampleRate * 1000) / 1000, bpm: song.bpm };
}

/** Mono mix of a rendered song, for analysis. */
export function songToMono(audio) {
  const out = new Float32Array(audio.left.length);
  for (let i = 0; i < out.length; i++) out[i] = 0.5 * (audio.left[i] + audio.right[i]);
  return out;
}

/** 16-bit stereo PCM WAV file bytes. */
export function encodeWav(audio) {
  const { left, right, sampleRate } = audio, n = left.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 4, 4); buf.write('WAVE', 8); buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(n * 4, 40);
  const q = (x) => Math.max(-32768, Math.min(32767, Math.round(x * 32767)));
  for (let i = 0; i < n; i++) { buf.writeInt16LE(q(left[i]), 44 + i * 4); buf.writeInt16LE(q(right[i]), 46 + i * 4); }
  return buf;
}
