# Freestyle: type it or record it, get a beat

Two ways in, one generator (`lib/adBeat.js`).

## 1. Typed freestyle

Give lyrics (new lines or `/` separate lines). You get a beat, every word placed on it, a saved track, and a graphic ad
whose captions land on the words and whose shapes pulse with the beat.

- Tool: `make_nexus_freestyle { lyrics, style?, bpm?, key?, seed?, title?, mood?, palette?, format?, campaign_id? }`.
- Offline: `node scripts/make-freestyle.mjs --lyrics-file words.txt --out-dir out --style trap` writes `beat.wav`,
  `song.json`, `words.json` and `ad.json`. Then `node scripts/export-ad-mp4.mjs --project out/ad.json --audio out/beat.wav --out out/freestyle.mp4`.

How words are placed: a line takes one bar (up to 12 syllables) or two, starts on the downbeat, and its words are
spread by syllable with a short breath at the end. Times are saved as `{ w, s, e }` on the track. **They are an
estimate of where a rapper would land the words, not a measurement of a voice.** The video has a beat and captions, not
a sung or spoken vocal. A voice needs a recording (below) or a voice model.

Limits: about 30 seconds in total, two scenes of up to 15 seconds. Lines that do not fit come back in `not_placed`.

## 2. Recorded freestyle

1. Add the recording on the board's Tracks tab. The board estimates its tempo and where the first beat falls.
2. `make_nexus_beat { track_id, style? }` writes a beat at that tempo and says how long to delay it (`delay_beat_seconds`).
3. `node scripts/mix-beat.mjs --recording voice.m4a --beat beat.wav --delay 0.25 --out mixed.wav` puts the beat under
   the voice (needs ffmpeg). The beat loops to cover the recording and the result is as long as the recording.

Tempo detection is an estimate. Trust it when `bpm_confidence` is above about 0.35; for a loose or fast freestyle pass
`bpm` yourself. The beat is aligned to the first detected beat, which may be beat 2 or 3 of a bar rather than the
downbeat, so listen once and nudge `--delay` by a beat if it feels off.

## The beat generator

`generateBeat({ style, bpm, bars, key, seed, name })` returns a song in the format of `docs/ad-song.md`. Styles:
`boom_bap` (84-96 BPM), `trap` (130-150, half-time snare, hat rolls), `lofi` (70-84, soft drums, 7th chords),
`hype` (118-128, four on the floor). Same inputs and seed give the same beat; change `seed` for another take. `key` is a
note name (A, C#, Bb ...). `make_nexus_beat` can also take `lyrics` (words placed on the beat) and `save: true` (store the
beat as a track with its song JSON, word times and loudness).

It is a synth: drums, bass, pads and a short hook. I can write it but cannot hear it, so listen before shipping.
