// Connector-side actions for the beat generator: make a beat (optionally for a saved recording, optionally with typed
// lyrics placed on it) and make a whole freestyle ad. Stores are injected, so this runs without a database in tests.
import {randomBytes} from 'node:crypto';
import {generateBeat, freestyleAd, timeLyrics, barsThatFit} from './adBeat.js';
import {renderSong, songToMono} from './adSong.js';
import {analyseTrack} from '../public/ad-audio.mjs';

const fail = (message, status = 400, code = 'BEAT_INVALID') => Object.assign(new Error(message), {status, code});

// Envelope arrays for a generated song, shaped for the track library (same analysis the board runs on uploads).
function analyseSong(song) {
  const audio = renderSong(song);
  const a = analyseTrack(songToMono(audio), audio.sampleRate);
  return {seconds: a.seconds, envelope: a.envelope};
}
const trackInput = ({name, song, words, transcript, description}) => {
  const {seconds, envelope} = analyseSong(song);
  return {name, description, source: 'generated_song', seconds, bpm: song.bpm, bpm_confidence: 1, beat_offset: 0, envelope, transcript: transcript || '', words: words || [], song};
};

/** make_beat: a beat for a style/tempo, or one matched to a saved recording's tempo. */
export async function makeBeat(user, input, {tracks}) {
  let bpm = input.bpm, recording = null;
  if (input.track_id) {
    recording = await tracks.read(user, input.track_id);
    if (bpm === undefined) {
      if (!recording.bpm) throw fail('That track has no tempo estimate. Pass bpm yourself.');
      bpm = Math.max(60, Math.min(200, Math.round(recording.bpm)));
    }
  }
  const opts = {style: input.style, bpm, bars: input.bars, key: input.key, seed: input.seed, name: input.name};
  if (opts.bars === undefined && recording) {
    const fit = barsThatFit(bpm ?? 90);
    opts.bars = Math.max(2, Math.min(fit, Math.ceil((recording.seconds * (bpm ?? 90)) / 240)));
  }
  let timed = null;
  if (input.lyrics) {
    const tempo = bpm ?? generateBeat({style: input.style}).bpm;
    const bars = opts.bars ?? (barsThatFit(tempo) >= 8 ? Math.floor(barsThatFit(tempo) / 4) * 4 : barsThatFit(tempo));
    timed = timeLyrics(input.lyrics, {bpm: tempo, startBar: 1, maxBars: bars - 1});
    opts.bpm = tempo; opts.bars = bars;
  }
  const song = generateBeat(opts);
  const out = {song, seconds: Math.round(((song.bars * 240) / song.bpm) * 100) / 100, bpm: song.bpm, bars: song.bars};
  if (recording) {
    out.for_track = {track_id: recording.track_id, delay_beat_seconds: recording.beat_offset || 0, loop_beat_to_seconds: recording.seconds,
      note: 'Start the beat after delay_beat_seconds so its first beat lands on the recording\'s first detected beat; loop it if the recording is longer than the beat. scripts/mix-beat.mjs does this with ffmpeg.'};
  }
  if (timed) Object.assign(out, {lines: timed.lines.map(({text, bar, start, end}) => ({text, bar, start, end})), words: timed.words, not_placed: timed.truncated});
  if (input.save) {
    const saved = await tracks.save(user, trackInput({name: song.name, song, words: timed ? timed.words : [], transcript: input.lyrics, description: recording ? `Beat for ${recording.name}` : `${song.bpm} BPM beat`}));
    out.saved_track = {track_id: saved.track_id};
  }
  return out;
}

/** make_freestyle: typed words to a beat, timed words, a saved track and a saved ad that reacts to the beat. */
export async function makeFreestyle(user, input, {tracks, ads}) {
  const result = freestyleAd({lyrics: input.lyrics, style: input.style, bpm: input.bpm, key: input.key, seed: input.seed, title: input.title, mood: input.mood, palette: input.palette, format: input.format});
  const track = await tracks.save(user, trackInput({name: (input.title || 'Freestyle').slice(0, 60), song: result.song, words: result.words, transcript: input.lyrics, description: 'Typed freestyle with a generated beat'}));
  const campaign_id = input.campaign_id || 'fs-' + randomBytes(4).toString('hex');
  const saved = await ads.save(user, {campaign_id, project: result.project});
  return {
    saved: true, track_id: track.track_id, campaign_id, name: saved.name, baseline: saved.baseline, studio_url: saved.studio_url,
    bpm: result.song.bpm, bars: result.song.bars, lines: result.lines.map(({text, bar, start, end}) => ({text, bar, start, end})), not_placed: result.truncated, notes: result.notes,
    export: 'To get the video with sound: render the beat from the track\'s song JSON (node scripts/render-song.mjs --song song.json --out beat.wav), then node scripts/export-ad-mp4.mjs --project ad.json --audio beat.wav --out freestyle.mp4.',
  };
}
