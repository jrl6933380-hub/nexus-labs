# Songs as code

A song is a small JSON document that a deterministic synth (`lib/adSong.js`) turns into audio. It lets Claude or ChatGPT write a jingle the same way they write an ad: as data, with no audio files and no outside service. The same song always gives the same samples, and the beat clock and loudness envelopes that drive the visuals come from the same data, so picture and sound line up.

It is a synth, so it sounds like chiptune or electronic music: drums, bass, leads, plucks, pads and bells. It does not sing or speak.

## Format

```json
{
  "name": "Slice Time", "bpm": 128, "bars": 8,
  "tracks": [
    { "voice": "kick", "pattern": "x...x...x...x...", "startBar": 1, "vol": 0.9 },
    { "voice": "bass", "notes": [[0, "C2", 0.75], [1.5, "C3", 0.5]], "loopBars": 1, "startBar": 2 },
    { "voice": "pad",  "notes": [[0, ["C4", "E4", "G4"], 4]], "vol": 0.55, "pan": -0.15 }
  ]
}
```

- `bpm` 60 to 200, `bars` 1 to 32 (4 beats per bar), at most 30 seconds, 12 tracks.
- Voices: drums `kick`, `snare`, `hat`, `ohat` (open hat), `clap`; melodic `bass`, `lead`, `pluck`, `pad`, `bell`.
- **Drum tracks** use `pattern`, 16 steps per bar. `.` or `-` is a rest, `o` soft, `x` normal, `X` accent. Longer patterns (32, 48 ...) span several bars.
- **Melodic tracks** use `notes`: `[beat, pitch, lengthInBeats, velocity?]`. `pitch` is `C4`, `F#3`, `Bb2` (C1 to C8) or a MIDI number 24 to 108, or a list of pitches for a chord (up to 6). Beats count from the start of the loop.
- A track repeats every `loopBars` bars (default: the pattern length for drums, the whole song for notes) from `startBar` up to `endBar`. Use `startBar` and `endBar` to bring layers in and out: intro, build, drop.
- `vol` 0 to 1 (default 0.8), `pan` -1 (left) to 1 (right).

## Render and use

```
node scripts/render-song.mjs --song song.json --out song.wav
node scripts/render-song.mjs --demo jingle --out jingle.wav --ad jingle-ad.json
```

To make a graphic scene react to the song (beat clock and bass / mid / treble envelopes), name the scene:

```
node scripts/render-song.mjs --song song.json --out song.wav --project ad.json --scene bow --out-project ad-music.json
node scripts/export-ad-mp4.mjs --project ad-music.json --audio song.wav --out ad.mp4
```

The script cuts the envelopes to the part of the song that plays while that scene is on screen (scenes run one after another, so a scene's window starts after the scenes before it) and sets `bpm` and `beatOffset` so the beat clock lands on the song's beats. The exporter trims the audio to the ad's length and fades it out over the last second. See `docs/ad-graphic-scene.md` for the `react` fields.

The synth needs no ffmpeg. Muxing into the MP4 does.

## Writing a good jingle

- Keep it short and repeat a hook: 4 bars of melody that loops twice beats 8 bars of different ideas.
- Build the arrangement with `startBar`: pad and bell first, then kick and hat, then snare, bass and lead, then clap and pluck.
- Use a four-chord loop (for example C, Am, F, G) and write the bass root and the pad chords from it.
- Leave space: a lead that plays every beat sounds busy. Rests and longer notes make a melody memorable.
- Make the kick the loudest drum, the hat the quietest, and pan the high parts a little off center.
- Write the song first, then the visuals, so the ad's text and cuts can land on bars.

`lib/adSongDemos.js` has a full example (`SONG_DEMOS.jingle`) and an ad built on it (`jingleAd()`).

## Limits

- Instrumental only. A singing or speaking voice needs a voice model, which is a separate step.
- One tempo per song, no swing, four beats to a bar.
- I (or any AI) can write the notes, but cannot hear the result. Check the render by ear before shipping an ad.
