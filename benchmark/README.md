# Visual benchmark

Keeps what works. Every run renders the same cases in portrait, square and landscape, saves the frames, and records what specifically changed.

```
node scripts/ad-benchmark.mjs run --label after-fonts --change "Inter 4.0 for headlines" --baseline before-fonts
node scripts/ad-benchmark.mjs compare --before before-fonts --after after-fonts
```

Frames, `run.json` and `report.html` (baseline above, new below) go to `benchmark/runs/<label>/`; each run is appended to `benchmark/history.json`. Keep `benchmark/runs/` out of git (images); keep `history.json`.

Three judgments are reported separately and never combined:

- **technical**: validates, renders without page errors, and a second render gives identical pixels
- **visual**: measured from pixels (empty frames, no contrast, change against the baseline)
- **ad structure**: rules of thumb about the project (hook length, end-card CTA, text size). Not measured ad performance.

Not covered yet (the report lists them): photographs, footage and narration. They need a library photo, a library clip and a voice track.
