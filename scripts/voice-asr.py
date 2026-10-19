#!/usr/bin/env python3
"""Transcribe voice-lab output with faster-whisper and print word error rate per file and per variant.
Usage: python3 scripts/voice-asr.py OUT_DIR [model]   (pip install faster-whisper)"""
import json, re, sys
from collections import defaultdict
from faster_whisper import WhisperModel

out = sys.argv[1]
model = WhisperModel(sys.argv[2] if len(sys.argv) > 2 else 'tiny.en', device='cpu', compute_type='int8')
norm = lambda s: re.findall(r"[a-z']+", s.lower())

def wer(ref, hyp):
    d = [[i] + [0] * len(hyp) for i in range(len(ref) + 1)]
    d[0] = list(range(len(hyp) + 1))
    for i in range(1, len(ref) + 1):
        for j in range(1, len(hyp) + 1):
            d[i][j] = min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] != hyp[j - 1]))
    return d[-1][-1], len(ref)

rows = json.load(open(f'{out}/manifest.json'))
agg = defaultdict(lambda: [0, 0])
for r in rows:
    segs, _ = model.transcribe(f"{out}/{r['file']}", beam_size=5, language='en', temperature=0.0)
    hyp = ' '.join(s.text.strip() for s in segs)
    e, n = wer(norm(r['text']), norm(hyp))
    agg[r['variant']][0] += e
    agg[r['variant']][1] += n
    print(f"{r['file']:12s} err {e}/{n} | {r['text']} -> {hyp}", flush=True)
for v, (e, n) in agg.items():
    print(f'WER {v}: {e}/{n} = {e / n:.0%}')
