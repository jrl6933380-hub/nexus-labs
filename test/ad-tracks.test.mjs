import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAdTrackStore, validateTrackInput, sceneParamsFor, TRACK_LIMITS } from '../lib/adTracks.js';
import { estimateTempo, analyseTrack } from '../public/ad-audio.mjs';

const SR = 16000;
function clicks(bpm, secs, off = 0.3) {
  const x = new Float32Array(SR * secs), spb = 60 / bpm;
  for (let b = 0; off + b * spb < secs - 0.1; b++) {
    const i = Math.floor((off + b * spb) * SR), acc = b % 4 === 0 ? 1 : 0.6;
    for (let k = 0; k < 1200; k++) x[i + k] += acc * Math.exp(-k / 250) * Math.sin((2 * Math.PI * 90 * k) / SR) * 0.8;
  }
  return x;
}
function memoryStore() {
  const hashes = new Map();
  let n = 0;
  const command = async ([op, ...args]) => {
    const hash = hashes.get(args[0]) || new Map();
    hashes.set(args[0], hash);
    if (op === 'HGET') return hash.get(args[1]) || null;
    if (op === 'HVALS') return [...hash.values()];
    if (op === 'HLEN') return hash.size;
    if (op === 'HSET') { hash.set(args[1], args[2]); return 1; }
    if (op === 'HDEL') return hash.delete(args[1]) ? 1 : 0;
    throw Error(op);
  };
  return createAdTrackStore({ command, now: () => 1000, newId: () => 'trk-' + String(++n).padStart(4, '0') });
}
const envelope = { rate: 10, low: Array.from({ length: 100 }, (_, i) => i), mid: Array(100).fill(50), high: Array(100).fill(10) };
const base = { name: 'Freestyle', seconds: 10, bpm: 120, bpm_confidence: 0.8, beat_offset: 0.3, envelope };

test('tempo is found within a BPM or so, with the beat phase, and noise or silence is not trusted', () => {
  for (const bpm of [70, 100, 120, 128]) {
    const r = estimateTempo(clicks(bpm, 20), SR);
    assert.ok(Math.abs(r.bpm - bpm) < 1, `${bpm} -> ${r.bpm}`);
    assert.ok(r.confidence > 0.5);
    assert.ok(Math.abs(r.beatOffset - 0.3) < 0.03, `offset ${r.beatOffset}`);
  }
  assert.equal(estimateTempo(new Float32Array(SR * 10), SR).bpm, null);
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const noise = Float32Array.from({ length: SR * 20 }, () => (rnd() - 0.5) * 0.3);
  assert.ok(estimateTempo(noise, SR).confidence < 0.35, 'noise is flagged as unsure');
  assert.equal(estimateTempo(clicks(120, 2), SR).bpm, null, 'too short to judge');
});

test('analyseTrack returns equal-length envelopes sized for the library and is deterministic', () => {
  const x = clicks(110, 60);
  const a = analyseTrack(x, SR), b = analyseTrack(x, SR);
  assert.deepEqual(a, b);
  assert.equal(a.envelope.low.length, a.envelope.mid.length);
  assert.ok(a.envelope.low.length <= 1800);
  assert.equal(a.envelope.rate, 20);
  assert.ok(Math.abs(a.bpm - 110) < 1);
  assert.doesNotThrow(() => validateTrackInput({ name: 'x', seconds: a.seconds, bpm: a.bpm, bpm_confidence: a.bpmConfidence, beat_offset: a.beatOffset, envelope: a.envelope }));
  assert.equal(analyseTrack(clicks(110, 300), SR).envelope.rate, 6, 'long tracks use a lower rate so they still fit');
});

test('validation rejects bad numbers, mismatched arrays and out-of-order words', () => {
  const bad = (patch, re) => assert.throws(() => validateTrackInput({ ...base, ...patch }), re);
  bad({ name: '' }, /name is required/);
  bad({ seconds: 0 }, /seconds/);
  bad({ seconds: 601 }, /seconds/);
  bad({ bpm: 300 }, /bpm/);
  bad({ source: 'streamed' }, /source must be/);
  bad({ envelope: { ...envelope, mid: [1, 2] } }, /same length/);
  bad({ envelope: { ...envelope, low: envelope.low.map(() => 101) } }, /0 to 100/);
  bad({ words: [{ w: 'b', s: 5, e: 6 }, { w: 'a', s: 1, e: 2 }] }, /time order/);
  bad({ words: [{ w: 'a', s: 3, e: 2 }] }, /ends before/);
  bad({ transcript: 'x'.repeat(TRACK_LIMITS.transcript + 1) }, /too long/);
  bad({ song: { huge: 'x'.repeat(TRACK_LIMITS.songChars) } }, /too large/);
  const ok = validateTrackInput({ ...base, bpm: null, envelope: undefined, words: [{ w: 'hey', s: 1, e: 1.4 }], transcript: 'hey\nthere' });
  assert.equal(ok.bpm, null);
  assert.equal(ok.beat_offset, 0);
  assert.equal(ok.envelope, null);
  assert.equal(ok.words.length, 1);
});

test('store: save, list (no big arrays), read with scene params, update, delete, per account, capped', async () => {
  const store = memoryStore();
  const saved = await store.save('u1', { ...base, transcript: 'one two three', words: [{ w: 'one', s: 0.5, e: 0.9 }] });
  assert.equal(saved.saved, true);
  assert.equal(saved.has_envelope, true);
  const listed = await store.list('u1');
  assert.equal(listed.tracks.length, 1);
  assert.ok(!JSON.stringify(listed).includes('"low"'), 'list never returns envelope arrays');
  assert.equal(listed.tracks[0].transcript_preview, 'one two three');
  assert.equal((await store.list('u2')).tracks.length, 0);

  const read = await store.read('u1', saved.track_id, { scene_start: 2, scene_duration: 3 });
  assert.equal(read.words[0].w, 'one');
  assert.ok(!('envelope' in read));
  assert.equal(read.scene_params.audioRate, 10);
  assert.equal(read.scene_params.audioLow.length, 30);
  assert.equal(read.scene_params.audioLow[0], 20, 'window starts 2s in');
  assert.equal(read.scene_params.bpm, 120);

  const updated = await store.update('u1', saved.track_id, { transcript: 'new words', words: [{ w: 'new', s: 1, e: 1.2 }, { w: 'words', s: 1.3, e: 1.7 }] });
  assert.equal(updated.updated, true);
  assert.equal(updated.word_count, 2);
  assert.equal((await store.read('u1', saved.track_id)).has_envelope, true, 'update keeps the envelope');
  await assert.rejects(() => store.update('u1', saved.track_id, { bpm: 999 }), /bpm/);
  await assert.rejects(() => store.read('u2', saved.track_id), /not found/);

  assert.deepEqual(await store.remove('u1', saved.track_id), { deleted: true, track_id: saved.track_id });
  await assert.rejects(() => store.remove('u1', saved.track_id), /not found/);
  await assert.rejects(() => store.read('u1', 'nope'), /valid track_id/);

  for (let i = 0; i < TRACK_LIMITS.maxTracks; i++) await store.save('u3', { ...base, name: 't' + i });
  await assert.rejects(() => store.save('u3', base), /library is full/);
});

test('beatOffset in scene params keeps the beat grid when a scene starts mid-track', () => {
  const rec = { seconds: 10, bpm: 120, beat_offset: 0.3, envelope };
  assert.equal(sceneParamsFor(rec, { start: 0, duration: 2 }).beatOffset, 0.3);
  assert.equal(sceneParamsFor(rec, { start: 0.3, duration: 2 }).beatOffset, 0);
  assert.equal(sceneParamsFor(rec, { start: 1, duration: 2 }).beatOffset, 0.3, 'beats at 0.3, 0.8, 1.3: next after 1.0 is 0.3 later');
  assert.throws(() => sceneParamsFor({ ...rec, envelope: null }, {}), /no loudness envelope/);
  assert.throws(() => sceneParamsFor(rec, { start: 11 }), /past the end/);
  assert.equal('bpm' in sceneParamsFor({ ...rec, bpm: null }, {}), false);
});

test('the served board page carries the analysis code and the Tracks section', async () => {
  const { inlineBoardAudio } = await import('../lib/boardAudio.js');
  const raw = await readFile(new URL('../public/nexus-workspace-board.html', import.meta.url), 'utf8');
  const source = await readFile(new URL('../public/ad-audio.mjs', import.meta.url), 'utf8');
  const served = inlineBoardAudio(raw, source);
  assert.match(served, /function estimateTempo\(/);
  assert.match(served, /function analyseTrack\(/);
  assert.doesNotMatch(served, /^export /m);
  assert.match(served, /id="track-library"/);
  const script = served.match(/<script>([\s\S]*?)<\/script>/g).pop().replace(/<\/?script>/g, '');
  assert.doesNotThrow(() => new Function(script), 'the served board script parses');
});
