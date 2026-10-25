# Nexus ad workflow (all agents)

One way to make an ad, whoever builds it. Goal: **cinematic** (real footage doing the work, like `media-broker-demo-01/02`) **and ad-ready** (portrait, structured, credited, like `gpt-ignition-20261025`).

## House standard

- **Format:** portrait 1080x1920, 30 fps, 15 s. Landscape or 6 s only when asked.
- **Audio:** none. Justin adds the TikTok sound.
- **Arc (4 scenes):**
  1. **Hook, 3 to 4 s.** Footage full-bleed behind a short headline.
  2. **Reveal, 4 to 5 s.** A second line or beat, footage still visible.
  3. **Proof or steps, 3 to 4 s.** Typographic scene (the IMAGINE / CREATE / RENDER style) or a stat.
  4. **End card, 2 to 3 s.** Brand and one call to action.
- **Footage is the hero.** The clip fills the frame (`fit: cover`, box 100 x 100) in the hook and the reveal. Do not shrink it into a thin band on black unless the clip is a cutout on a dark background on purpose.
- **Blend, don't hard-cut.** The demo ads that felt cinematic used full-bleed footage plus `transitionOut: crossfade` (about 400 ms) into the next scene. Use crossfade out of footage scenes. Use a cut only for a deliberate hit, such as into a typographic scene.
- **Legibility:** put a black shade rectangle between the footage and the text (opacity 0.25 to 0.35 worked well). Text goes over the shade, never straight on bright footage.
- **Type:** bold, high contrast, two lines at most per headline. Keep long words clear of the sides: a word that fills the width in a fallback font will clip in a wider one.
- **TikTok safe zone:** keep text away from the top, bottom and right edges where the app draws its own interface. Put the credit line inside the same safe zone.
- **Credit:** every stock clip gets a visible credit line while it is on screen (`Video: <creator> on Pixabay`). The broker saves it in the media description.

## Steps

### Enforced creation defaults

The campaign save path now materializes these settings for **new spec v2 campaigns**:

- Graphic video layers default to `footageLayout: full_bleed`. Validation stores a centered `x:50, y:50, w:100, h:100, fit:cover` box with square corners. This overrides an accidentally authored thin strip. Use `focusX/focusY` to frame the subject.
- Footage scenes with text also get the cinematic look: a slow push-in (scale 1 to 1.06 over the scene) on the clip and a full-frame black `shade` rect at 0.3 opacity between clip and text. Your own `keys`/`scale`/`motion` on the clip or your own full-frame rect are kept, and `footageLayout: custom` skips both. Raise the shade to 0.35 over bright skies. Text placement, edge clearance and the TikTok bottom zone are still checked by eye.
- Footage scenes with no explicit transition get `transitionOut: crossfade` and `transitionMs:400`. An explicit `cut` is preserved for a deliberate hit; the last scene has no next scene to fade into.
- Use `footageLayout: custom` for intentional inset video, keyed subjects, split screens or masked composites. Full-bleed layout rejects transforms that would move or crop the box away from the frame; it does not silently discard those effects.
- Reads, exports and edits of existing campaigns do not acquire new creation defaults. Saved full-bleed layers remain full-bleed on validation; switch them to `custom` before changing their box geometry. Export and preview use the saved normalized project rather than an export-only patch.

These defaults cover the video box and outgoing transition. They do not remove black bars baked into source footage, choose the subject crop, guarantee text contrast, or prevent a scene camera from moving the frame. Those still need visual review. Custom creative/legacy ads are unaffected.

1. **Brief.** Write goal, platform, one message, and tone before building.
2. **Footage.** `find_nexus_media`, pick one, then `use_nexus_media` (owner only). Prefer clips of 10 s or more, 1080p, with the subject large in frame.
3. **Build.** `describe_nexus_ad_vocabulary`, then `save_nexus_ad_v2` with a fresh campaign id: `<builder>-<topic>-<yyyymmdd>`. Fix layout with `edit_nexus_layers`, not by rebuilding.
4. **Render.** Only `scripts/export-ad-mp4.mjs` (needs Node 20+, Chromium, ffmpeg). Fetch the clip with `get_nexus_media_chunk` and check its sha256 before rendering. Do not hand-build frames. Report exact commands and tool versions.
5. **Check.** Look at frames from every scene, not only the first. Confirm the text clears the edges, the credit shows, the file is the right size, plays to the end, and has no audio track. Confirm the video matches the saved ad.
6. **Hand off.** Post the campaign id, the MP4, and anything not verified to the Agent Board.

## Known limits

- Sandboxes without web-font access render fallback fonts. Check edge clearance with that in mind and say which font was used.
- Clips have no preview thumbnail in the board yet (Pixabay thumbnails exceed the 100 KB limit).
- No production render worker is running. Renders are done by hand with the exporter until one is set up.

