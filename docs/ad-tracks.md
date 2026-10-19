# Track library

A place in Nexus where tracks live, like the image library, so an assistant can read a song or a voice recording as
data. **The audio file is not stored.** The board's Tracks tab decodes the file in the browser, works out what it needs,
and saves only that. The file stays with the user.

## What a track holds

| Field | What it is |
|---|---|
| `name`, `description`, `source` | `uploaded`, `recorded` or `generated_song` |
| `seconds` | length (the board analyses up to 10 minutes) |
| `bpm`, `bpm_confidence`, `beat_offset` | tempo estimate, how clearly a steady pulse stood out (0-1), and seconds to the first beat |
| `envelope` | `{ rate, low, mid, high }` loudness per band, 0-100, `rate` samples per second (at most 1800 each) |
| `transcript`, `words` | the lyrics as text, and optionally `{ w, s, e }` word timings in seconds |
| `song` | the song JSON (see `docs/ad-song.md`) when the track was generated |

## Tools (all through the Nexus connector)

- `list_nexus_tracks`: summaries (no big arrays).
- `read_nexus_track { track_id, scene_start?, scene_duration? }`: full record. With the scene window it also returns
  `scene_params` (`bpm`, `beatOffset`, `audioRate`, `audioLow/Mid/High` cut to that window) to merge into a graphic
  scene's `params` with `edit_nexus_ad`, so the visuals react to the track.
- `save_nexus_track`, `update_nexus_track`, `delete_nexus_track`: the board uses save; assistants use update to add
  lyrics or word timings once they exist, and save to keep a generated song.

Limits: 30 tracks per account, 4000 characters of transcript, 600 words with timings, song JSON up to 40,000 characters.

## What is and is not possible

- **Tempo is an estimate.** It is steady-pulse detection. Trust `bpm` when `bpm_confidence` is above about 0.35; free
  speech or loose rapping often scores lower. Very fast tracks can come back as half their tempo (174 reads as 87), which
  still lines up with the beats.
- **An assistant cannot hear the audio.** It reads the numbers and the transcript. Words come from the user pasting
  them, or from a speech-to-text tool that returns text with timings (saved with `update_nexus_track`).
- **Speech-to-text is not in the board yet.** The board runs offline inside the chat app (no network, so it cannot
  download a model). A transcription step needs either a service the Nexus server calls or a script run elsewhere.
- **Sound in the exported video** still comes from the audio file given to `scripts/export-ad-mp4.mjs --audio`.

## Where the code is

- `public/ad-audio.mjs`: envelope and tempo analysis. Pure functions with no imports, shared by Node
  (`lib/adAudio.js`) and the board.
- `lib/adTracks.js`: validation, scene-window maths and the store (key `nexus:ad-tracks:v1:<account>`).
- `public/nexus-workspace-board.html`: the Tracks section. `lib/boardAudio.js` pastes `public/ad-audio.mjs` into the
  page between the `AUDIO-BEGIN`/`AUDIO-END` markers when it serves it, so there is one copy of the code.
