# Ad voice (code-only vocal engine)

A rule-based Klatt-style formant synthesizer for the Ad Maker. No neural model, hosted API, GPU, or browser/OS speech API. Pure JS, deterministic: same text + options + seed gives the same samples on every machine.

## Pipeline
1. `lib/adPhonemes.js` text to ARPAbet. Overrides, then optional dictionary (CMUdict-style map), then a small built-in lexicon, then letter-to-sound rules. `syllabify`, stress, function-word reduction.
2. `lib/adVoice.js` `planSpeech` (prosody: declination, accents, final fall/question rise, pauses) or `planMeter` (rap: stressed syllables on beats; sing: vowels held to note length, auto melody, portamento, vibrato).
3. `synthesize(plan)` glottal source + cascade F1-F5, nasal pole/zero, parallel frication, aspiration, loudness tracking. Returns `{sampleRate, samples, seconds}`.
4. `wordTimings` / `phoneTimings` give real `{w,s,e}` data (same shape as `lib/adTracks.js` words) for captions; `mixVoice` ducks a beat under the voice.

`speak(text, opts)` runs all of it and returns `{audio, plan, words, phones}`.

## Measured
- Compute: about 12 ms per second of audio, about 5 MB heap; 27 phrases (73 s) rendered in under 1 s. Code is about 40 KB, no assets.
- Intelligibility proxy (faster-whisper base.en word error rate; a noisy judge, not a listener): ad lines 43%, per-consonant sentences 75%. eSpeak NG scores about 11% on the same phrases. Earlier first version: about 89%.
- Strong: D, G, N, R, Y, vowels, rhythm/timing, caption sync (timings come from the plan, not from analysis).
- Weak: initial K, L vs W, F/V/Z/SH, S clusters, CH/JH, T release.

## Licensing
- eSpeak NG is GPL-3.0+; bundling it in shipped code is a GPL decision. Used only as a local benchmark here, not as a dependency.
- klatt-syn and klattsch are MIT: references only, no code copied.
- CMUdict is BSD-style; not bundled. Pass a dictionary at runtime to use it (verify the license text before shipping it).

## Limits
- Robotic by design. Understandable-and-distinctive is the target; natural narration needs a different class of model.
- Author could not listen. Objective checks were spectrograms, formant tracks, per-phone levels and the ASR proxy. A human listen is the real test.

## Try it
    node scripts/voice-lab.mjs --out /tmp/o --set all --variants spoken,rap
    python3 scripts/voice-asr.py /tmp/o base.en     # needs faster-whisper
