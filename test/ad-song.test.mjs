import test from 'node:test';
import assert from 'node:assert/strict';
import {
  validateSong, renderSong, encodeWav, songToMono, noteToMidi, midiToHz, SONG_LIMITS, SONG_VOICES, SONG_DRUM_VOICES,
} from '../lib/adSong.js';
import { SONG_DEMOS, jingleAd } from '../lib/adSongDemos.js';
import { envelopesFromPcm } from '../lib/adAudio.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';

const SR = 22050; // low rate keeps the tests fast
const song = (tracks, extra = {}) => ({ name: 'Test', bpm: 120, bars: 2, tracks, ...extra });
const kick = { voice: 'kick', pattern: 'x...x...x...x...' };

test('note names and MIDI numbers', () => {
  assert.equal(noteToMidi('C4'), 60);
  assert.equal(noteToMidi('A4'), 69);
  assert.equal(noteToMidi('F#3'), 54);
  assert.equal(noteToMidi('Bb2'), 46);
  assert.equal(noteToMidi(60), 60);
  for (const bad of ['H4', 'C', 'C#', 'c4', 'C10', 12, 200, 60.5, null, undefined, '']) assert.ok(Number.isNaN(noteToMidi(bad)), String(bad));
  assert.ok(Math.abs(midiToHz(69) - 440) < 1e-9);
  assert.ok(Math.abs(midiToHz(60) - 261.6256) < 0.001);
});

test('a valid song normalises and reports its length', () => {
  const r = validateSong(song([kick, { voice: 'bass', notes: [[0, 'C2', 1], [2, ['C2', 'G2'], 1, 0.5]], loopBars: 1 }]));
  assert.deepEqual(r.errors, []);
  assert.equal(r.ok, true);
  assert.equal(r.value.seconds, 4);
  assert.equal(r.value.tracks[0].loopBars, 1);
  assert.equal(r.value.tracks[0].steps.filter(Boolean).length, 4);
  assert.deepEqual(r.value.tracks[1].notes[1].midi, [36, 43]);
});

test('every voice is accepted', () => {
  for (const voice of SONG_VOICES) {
    const t = SONG_DRUM_VOICES.includes(voice) ? { voice, pattern: 'X...o...x.......' } : { voice, notes: [[0, 'C4', 1]] };
    assert.deepEqual(validateSong(song([t])).errors, [], voice);
  }
});

test('song-level limits and unknown fields', () => {
  assert.equal(validateSong(song([kick], { bpm: 59 })).ok, false);
  assert.equal(validateSong(song([kick], { bpm: 201 })).ok, false);
  assert.equal(validateSong(song([kick], { bars: 0 })).ok, false);
  assert.equal(validateSong(song([kick], { bars: 33 })).ok, false);
  assert.equal(validateSong(song([kick], { bars: 1.5 })).ok, false);
  assert.equal(validateSong(song([])).ok, false);
  assert.equal(validateSong(song(Array.from({ length: SONG_LIMITS.tracksMax + 1 }, () => kick))).ok, false);
  assert.equal(validateSong({ ...song([kick]), extra: 1 }).ok, false);
  assert.equal(validateSong(null).ok, false);
  assert.equal(validateSong([]).ok, false);
  const long = validateSong(song([kick], { bpm: 60, bars: 16 })); // 16 bars at 60 bpm = 64s
  assert.equal(long.ok, false);
  assert.ok(long.errors.some((e) => e.includes('longer than 30s')));
});

test('drum patterns: characters and length', () => {
  const ok = (pattern) => validateSong(song([{ voice: 'snare', pattern }])).ok;
  assert.equal(ok('....x.......x...'), true);
  assert.equal(ok('....x.......x.......x.......x...'), true);
  assert.equal(ok('x'), false);
  assert.equal(ok('....x.......x..'), false, '15 steps');
  assert.equal(ok('....q.......x...'), false);
  assert.equal(ok(''), false);
  assert.equal(ok('x...............'.repeat(9)), false, 'longer than the pattern cap');
  assert.equal(validateSong(song([{ voice: 'kick', notes: [[0, 'C2', 1]] }])).ok, false, 'drums need a pattern');
  assert.equal(validateSong(song([{ voice: 'bass', pattern: 'x...............' }])).ok, false, 'melodic voices need notes');
});

test('melodic notes: shape, pitch, range and loop length', () => {
  const ok = (notes, extra = {}) => validateSong(song([{ voice: 'lead', notes, ...extra }])).ok;
  assert.equal(ok([[0, 'C4', 1]]), true);
  assert.equal(ok([[0, ['C4', 'E4', 'G4'], 2, 1]]), true);
  assert.equal(ok([]), false);
  assert.equal(ok([[0, 'C4']]), false, 'length is required');
  assert.equal(ok([[0, 'Z4', 1]]), false);
  assert.equal(ok([[-1, 'C4', 1]]), false);
  assert.equal(ok([[8, 'C4', 1]]), false, 'beat past a 2 bar loop (8 beats)');
  assert.equal(ok([[4, 'C4', 1]], { loopBars: 1 }), false, 'beat past a 1 bar loop');
  assert.equal(ok([[0, 'C4', 0.01]]), false);
  assert.equal(ok([[0, 'C4', 20]]), false);
  assert.equal(ok([[0, 'C4', 1, 2]]), false);
  assert.equal(ok([[0, [], 1]]), false);
  assert.equal(ok([[0, ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4'], 1]]), false, 'chord too big');
  assert.equal(ok([[0, 'C4', 1]], { loopBars: 3 }), false, 'loop longer than the song');
  assert.equal(ok([[0, 'C4', 1]], { startBar: 2 }), false);
  assert.equal(ok([[0, 'C4', 1]], { startBar: 1, endBar: 1 }), false);
  assert.equal(ok([[0, 'C4', 1]], { vol: 2 }), false);
  assert.equal(ok([[0, 'C4', 1]], { pan: -2 }), false);
  assert.equal(ok([[0, 'C4', 1]], { tone: 'warm' }), false, 'unknown field');
});

test('rendering is deterministic and well formed', () => {
  const s = song([kick, { voice: 'snare', pattern: '....x.......x...' }, { voice: 'hat', pattern: 'o.o.o.o.o.o.o.o.' }, { voice: 'clap', pattern: '....x...........' },
    { voice: 'bass', notes: [[0, 'C2', 1], [2, 'G2', 1]] }, { voice: 'lead', notes: [[0, 'E5', 1]] }, { voice: 'pluck', notes: [[1, 'C5', 1]] },
    { voice: 'pad', notes: [[0, ['C4', 'E4', 'G4'], 4]] }, { voice: 'bell', notes: [[1, 'E6', 1]] }, { voice: 'ohat', pattern: '..............x.' }]);
  const a = renderSong(s, { sampleRate: SR }), b = renderSong(s, { sampleRate: SR });
  assert.equal(a.sampleRate, SR);
  assert.equal(a.bpm, 120);
  assert.equal(a.left.length, Math.ceil(5 * SR)); // 4s of song plus 1s tail
  assert.deepEqual(Buffer.from(a.left.buffer), Buffer.from(b.left.buffer));
  assert.deepEqual(Buffer.from(a.right.buffer), Buffer.from(b.right.buffer));
  let peak = 0;
  for (let i = 0; i < a.left.length; i++) {
    assert.ok(Number.isFinite(a.left[i]) && Number.isFinite(a.right[i]));
    peak = Math.max(peak, Math.abs(a.left[i]), Math.abs(a.right[i]));
  }
  assert.ok(peak > 0.85 && peak <= 0.93, `peak ${peak}`);
  assert.ok(Math.abs(a.left[0]) < 0.05 && Math.abs(a.left[a.left.length - 1]) < 0.001, 'fades in and out');
});

test('an invalid song or sample rate does not render', () => {
  assert.throws(() => renderSong({ bpm: 5 }), /Invalid song/);
  assert.throws(() => renderSong(song([kick]), { sampleRate: 100 }), /sampleRate/);
});

test('arrangement: startBar, endBar and panning shape the audio', () => {
  const rms = (a, from, to) => { let s = 0; for (let i = Math.floor(from * a.sampleRate); i < Math.floor(to * a.sampleRate); i++) s += a.left[i] ** 2 + a.right[i] ** 2; return Math.sqrt(s / ((to - from) * a.sampleRate)); };
  const a = renderSong(song([{ ...kick, startBar: 1 }]), { sampleRate: SR });
  assert.ok(rms(a, 0, 1.9) < 0.0001, 'silent before startBar (bar 1 starts at 2s)');
  assert.ok(rms(a, 2.0, 3.5) > 0.05, 'kick plays after startBar');
  const l = renderSong(song([{ voice: 'lead', notes: [[0, 'C5', 4]], pan: -1 }]), { sampleRate: SR });
  const r = renderSong(song([{ voice: 'lead', notes: [[0, 'C5', 4]], pan: 1 }]), { sampleRate: SR });
  assert.ok(rms({ ...l, left: l.left, sampleRate: SR }, 0, 2) > 0.1);
  let lr = 0, ll = 0;
  for (let i = 0; i < l.left.length; i++) { ll += Math.abs(l.left[i]); lr += Math.abs(l.right[i]); }
  assert.ok(ll > lr * 20, 'pan -1 sits left');
  let rr = 0, rl = 0;
  for (let i = 0; i < r.left.length; i++) { rr += Math.abs(r.right[i]); rl += Math.abs(r.left[i]); }
  assert.ok(rr > rl * 20, 'pan 1 sits right');
});

test('the kick lands on the beat so envelopes line up with the beat clock', () => {
  const a = renderSong(song([kick]), { sampleRate: SR });
  const env = envelopesFromPcm(songToMono(a), a.sampleRate, { rate: 20 });
  // 120 bpm = a beat every 0.5s = every 10th envelope sample; the first beat is sample 0.
  const on = [0, 10, 20, 30].map((i) => env.audioLow[i]), off = [6, 16, 26, 36].map((i) => env.audioLow[i]);
  assert.ok(on.every((v) => v >= 85), `on ${on}`);
  assert.ok(off.every((v) => v <= 40), `off ${off}`);
});

test('WAV encoding is a valid stereo 16-bit file', () => {
  const a = renderSong(song([kick], { bars: 1 }), { sampleRate: 8000 });
  const wav = encodeWav(a);
  assert.equal(wav.toString('latin1', 0, 4), 'RIFF');
  assert.equal(wav.toString('latin1', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 2);
  assert.equal(wav.readUInt32LE(24), 8000);
  assert.equal(wav.readUInt16LE(34), 16);
  assert.equal(wav.readUInt32LE(40), a.left.length * 4);
  assert.equal(wav.length, 44 + a.left.length * 4);
  assert.equal(wav.readUInt32LE(4), wav.length - 8);
});

test('the demo jingle validates, is 15 seconds and uses several voices', () => {
  const r = validateSong(SONG_DEMOS.jingle);
  assert.deepEqual(r.errors, []);
  assert.equal(r.value.seconds, 15);
  assert.ok(new Set(r.value.tracks.map((t) => t.voice)).size >= 8);
});

test('the jingle ad validates and its envelopes come from the rendered song', () => {
  const { project, audio, song: s } = jingleAd();
  assert.equal(s.name, 'Slice Time jingle');
  assert.ok(audio.seconds >= 15);
  const r = validateProjectV2(project);
  assert.deepEqual(r.errors, []);
  const params = project.scenes[0].params;
  assert.equal(params.bpm, 128);
  assert.equal(params.audioLow.length, Math.ceil(14.5 * 20));
  // Bar 1 (1.875s) is where the kick enters; the first bar has no kick so the low band is quiet before it.
  const before = Math.max(...params.audioLow.slice(0, 30)), after = Math.max(...params.audioLow.slice(38, 60));
  assert.ok(after > before, `kick enters: before ${before}, after ${after}`);
  assert.ok(JSON.stringify(project).length < 20000);
});
