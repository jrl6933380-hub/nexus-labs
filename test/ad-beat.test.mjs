import test from 'node:test';
import assert from 'node:assert/strict';
import { generateBeat, timeLyrics, countSyllables, freestyleAd, BEAT_STYLES, barsThatFit } from '../lib/adBeat.js';
import { makeBeat, makeFreestyle } from '../lib/adBeatTools.js';
import { validateSong, renderSong, songToMono } from '../lib/adSong.js';
import { createAdTrackStore } from '../lib/adTracks.js';
import { validateProjectV2 } from '../public/ad-vocabulary.mjs';
import { estimateTempo } from '../public/ad-audio.mjs';
import { mixArgs } from '../scripts/mix-beat.mjs';

const LYRICS = `Started from the bottom now I'm slicing up the town
Every pie I make is a masterpiece
Hot and fresh the cheese is on the crown / Pizza night, we never cease
Crust so golden, sauce so right
Bring the whole crew out tonight`;

function memoryTracks() {
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
  return createAdTrackStore({ command, now: () => 1, newId: () => 'trk-' + String(++n).padStart(4, '0') });
}

test('every style writes a valid song inside the 30 second limit, deterministically', () => {
  for (const style of BEAT_STYLES) {
    const a = generateBeat({ style, seed: 5 }), b = generateBeat({ style, seed: 5 });
    assert.deepEqual(a, b);
    const v = validateSong(a);
    assert.ok(v.ok, `${style}: ${v.errors}`);
    assert.ok(v.value.seconds <= 30);
  }
  assert.notDeepEqual(generateBeat({ style: 'boom_bap', seed: 1 }), generateBeat({ style: 'boom_bap', seed: 2 }));
  assert.notDeepEqual(generateBeat({ key: 'A' }).tracks[0], generateBeat({ key: 'C' }).tracks[0], 'the key changes the chords');
  for (const bpm of [60, 77, 100, 200]) assert.ok(validateSong(generateBeat({ bpm })).ok, `bpm ${bpm}`);
});

test('bad inputs are rejected with a clear message', () => {
  assert.throws(() => generateBeat({ style: 'polka' }), /style must be one of/);
  assert.throws(() => generateBeat({ bpm: 30 }), /bpm must be between/);
  assert.throws(() => generateBeat({ key: 'H' }), /key must be one of/);
  assert.throws(() => generateBeat({ bpm: 100, bars: 20 }), /longer than 30s/);
  assert.throws(() => generateBeat({ bars: 1 }), /bars must be/);
  assert.equal(barsThatFit(120), 15);
});

test('a rendered beat has a steady pulse at its own tempo', () => {
  // Four on the floor has one clear pulse. Syncopated styles can read as a related tempo, which is expected.
  const song = generateBeat({ style: 'hype', bpm: 124, seed: 2 });
  const audio = renderSong(song, { sampleRate: 16000 });
  const t = estimateTempo(songToMono(audio), 16000);
  assert.ok(Math.abs(t.bpm - 124) < 2 || Math.abs(t.bpm - 62) < 1, `detected ${t.bpm}`);
});

test('syllables are counted roughly but never zero', () => {
  assert.equal(countSyllables('pie'), 1);
  assert.equal(countSyllables('masterpiece'), 3);
  assert.equal(countSyllables('golden'), 2);
  assert.equal(countSyllables('the'), 1);
  assert.equal(countSyllables('2'), 1);
});

test('lyrics land on the bars in order, one line per bar, starting on the downbeat', () => {
  const t = timeLyrics(LYRICS, { bpm: 90, startBar: 1 });
  assert.equal(t.lines.length, 6);
  const barSec = 240 / 90;
  t.lines.forEach((line, i) => {
    assert.equal(line.bar, 1 + i);
    assert.ok(Math.abs(line.words[0].s - line.bar * barSec) < 0.002, 'first word on the downbeat');
    assert.ok(line.end <= (line.bar + line.bars) * barSec, 'line ends inside its bars');
  });
  let last = -1;
  for (const w of t.words) { assert.ok(w.s > last, 'word starts strictly increase'); assert.ok(w.e >= w.s); last = w.s; }
  assert.ok(t.words.length <= 600);
  const long = timeLyrics('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen', { bpm: 90 });
  assert.equal(long.lines[0].bars, 2, 'long lines take two bars');
});

test('lines that do not fit are reported, and a barrier is never crossed', () => {
  const t = timeLyrics(LYRICS, { bpm: 90, startBar: 1, maxBars: 4 });
  assert.equal(t.lines.length, 3);
  assert.equal(t.truncated.length, 3);
  assert.throws(() => timeLyrics(LYRICS, { bpm: 90, startBar: 1, maxBars: 1 }), /None of the lines fit/);
  const b = timeLyrics('a b c d e f g h i j k l m n o p q r s t u v w x y z', { bpm: 100, startBar: 1, barrier: 2 });
  assert.equal(b.lines[0].bar, 2, 'a two-bar line that would cross bar 2 starts at it');
  assert.throws(() => timeLyrics('   ', { bpm: 90 }), /required/);
});

test('a typed freestyle becomes a valid ad with captions timed to the words and a beat under it', () => {
  const r = freestyleAd({ lyrics: LYRICS, style: 'boom_bap', seed: 3, title: 'Slice Time Freestyle' });
  assert.ok(validateProjectV2(r.project).ok);
  assert.equal(r.project.scenes.length, 2);
  for (const sc of r.project.scenes) assert.ok(sc.duration >= 1.5 && sc.duration <= 15, `scene ${sc.duration}`);
  assert.ok(r.project.scenes.reduce((n, s) => n + s.duration, 0) <= 30);
  const captions = r.project.scenes.flatMap((s) => s.params.layers.filter((l) => l.shape === 'text' && l.keys));
  assert.equal(captions.length, r.lines.length, 'one caption per line');
  const first = r.project.scenes[0].params.layers.find((l) => l.keys);
  const visibleAt = first.keys.find((k) => k.opacity === 1).t;
  assert.ok(Math.abs(visibleAt - (r.lines[0].start - 0.06 + 0.14)) < 0.02, 'first caption fades in on the first line');
  assert.ok(r.project.scenes[0].params.audioLow.length > 100, 'visuals carry the beat envelope');
  assert.equal(r.project.scenes[0].params.bpm, r.song.bpm);
  assert.deepEqual(freestyleAd({ lyrics: LYRICS, style: 'boom_bap', seed: 3, title: 'Slice Time Freestyle' }).project, r.project, 'deterministic');
});

test('short and long freestyles still make valid ads; too much text is trimmed and reported', () => {
  for (const style of BEAT_STYLES) {
    const r = freestyleAd({ lyrics: 'Yeah we in the lab / making sounds all night long', style });
    assert.ok(validateProjectV2(r.project).ok, style);
    assert.equal(r.project.scenes.at(-1).type, 'end_card', 'a short beat gets an end card');
  }
  const many = Array.from({ length: 40 }, (_, i) => `line number ${i} goes here`).join('\n');
  const r = freestyleAd({ lyrics: many, style: 'hype' });
  assert.ok(r.truncated.length > 0);
  assert.ok(validateProjectV2(r.project).ok);
  assert.throws(() => freestyleAd({ lyrics: 'x', bpm: 30 }), /bpm must be/);
  assert.throws(() => freestyleAd({ lyrics: '' }), /required/);
});

test('make_beat: matches a recording tempo, places lyrics, and can save the beat as a track', async () => {
  const tracks = memoryTracks();
  const rec = await tracks.save('u', { name: 'My freestyle', source: 'recorded', seconds: 20, bpm: 93.4, bpm_confidence: 0.8, beat_offset: 0.25 });
  const out = await makeBeat('u', { track_id: rec.track_id, style: 'trap' }, { tracks });
  assert.equal(out.bpm, 93);
  assert.equal(out.for_track.delay_beat_seconds, 0.25);
  assert.ok(out.seconds >= 18, 'covers the recording up to the 30 second limit');
  const bare = await tracks.save('u', { name: 'no tempo', seconds: 8 });
  await assert.rejects(() => makeBeat('u', { track_id: bare.track_id }, { tracks }), /no tempo estimate/);

  const withWords = await makeBeat('u', { style: 'lofi', lyrics: 'First line here\nSecond line there', save: true }, { tracks });
  assert.equal(withWords.lines.length, 2);
  const saved = await tracks.read('u', withWords.saved_track.track_id);
  assert.equal(saved.source, 'generated_song');
  assert.equal(saved.words.length, withWords.words.length);
  assert.equal(saved.song.bpm, withWords.song.bpm);
  assert.equal(saved.has_envelope, true);
});

test('make_freestyle saves a track and an ad and reports what did not fit', async () => {
  const tracks = memoryTracks(), saves = [];
  const ads = { async save(user, input) { saves.push(input); return { campaign_id: input.campaign_id, name: input.project.name, baseline: 'b1', studio_url: 'https://example.test/studio' }; } };
  const out = await makeFreestyle('u', { lyrics: LYRICS, style: 'boom_bap', title: 'Slice Time' , campaign_id: 'fs-test' }, { tracks, ads });
  assert.equal(out.saved, true);
  assert.equal(out.campaign_id, 'fs-test');
  assert.equal(saves.length, 1);
  assert.ok(validateProjectV2(saves[0].project).ok);
  const track = await tracks.read('u', out.track_id);
  assert.equal(track.transcript, LYRICS);
  assert.ok(track.words.length > 20);
  assert.ok(out.lines.length === 6 && out.not_placed.length === 0);
  const auto = await makeFreestyle('u', { lyrics: 'one line' }, { tracks, ads });
  assert.match(auto.campaign_id, /^fs-[0-9a-f]{8}$/);
});

test('mix-beat builds an ffmpeg command that delays and loops the beat and keeps the recording length', () => {
  const a = mixArgs({ recording: 'v.m4a', beat: 'b.wav', out: 'o.wav', delay: 0.25, volume: 0.6 });
  assert.ok(a.includes('-stream_loop') && a[a.indexOf('-stream_loop') + 1] === '-1');
  const filter = a[a.indexOf('-filter_complex') + 1];
  assert.match(filter, /adelay=250\|250/);
  assert.match(filter, /duration=first/);
  assert.match(filter, /volume=0.6/);
});
