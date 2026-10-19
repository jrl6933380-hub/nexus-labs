#!/usr/bin/env python3
"""A way for an assistant that cannot hear to "listen" to a clip: measurable facts plus a picture.

  python3 scripts/voice-listen.py clip.wav [--ref ref.wav] [--ref-start S --ref-end E] [--start S --end E] [--png out.png] [--asr base.en]

Prints JSON: duration, loudness, pitch contour (50 ms steps), voiced fraction, pauses, a rough syllable rate, and when
faster-whisper is installed the transcript with per-word start/end/confidence. With --ref it also aligns the clip to a
reference recording (dynamic time warping on mel features) and reports how far apart they sound and the pace ratio.
With --png it writes a spectrogram (pitch line overlaid) that an image-reading assistant can look at.
Only numpy and scipy are required; matplotlib and faster-whisper are optional. Needs ffmpeg on PATH for non-wav input."""
import argparse, json, subprocess, numpy as np, scipy.io.wavfile as wavio

SR = 16000

def load(path, start=None, end=None):
    cmd = ['ffmpeg', '-v', 'error', '-nostdin', '-i', path, '-ac', '1', '-ar', str(SR)]
    if start is not None: cmd += ['-ss', str(start)]
    if end is not None: cmd += ['-to', str(end)]
    raw = subprocess.run(cmd + ['-f', 's16le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.int16).astype(np.float64) / 32768

def frames_rms_db(x, hop=160, win=480):
    r = np.array([np.sqrt(np.mean(x[i:i + win] ** 2)) for i in range(0, max(1, len(x) - win), hop)])
    return 20 * np.log10(r + 1e-9)

def pitch(x, db, hop=160, floor=-40):
    out = []
    for k, i in enumerate(range(0, max(1, len(x) - 640), hop)):
        if k >= len(db) or db[k] < floor: out.append(0.0); continue
        s = x[i:i + 640] * np.hanning(640)
        if len(s) < 640: out.append(0.0); continue
        a = np.correlate(s, s, 'full')[639:]
        lo, hi = int(SR / 350), int(SR / 70)
        p = a[lo:hi].argmax() + lo
        out.append(SR / p if a[0] > 0 and a[p] > 0.45 * a[0] else 0.0)
    return np.array(out)

def mel_features(x, n_mel=32, n_fft=512, hop=160):
    win = np.hanning(n_fft); fr = [x[i:i + n_fft] * win for i in range(0, len(x) - n_fft, hop)]
    sp = np.abs(np.fft.rfft(np.array(fr), axis=1)) ** 2
    mel = lambda f: 2595 * np.log10(1 + f / 700); inv = lambda m: 700 * (10 ** (m / 2595) - 1)
    pts = inv(np.linspace(mel(60), mel(7600), n_mel + 2)); bins = np.floor((n_fft + 1) * pts / SR).astype(int)
    fb = np.zeros((n_mel, n_fft // 2 + 1))
    for m in range(n_mel):
        a, b, c = bins[m], bins[m + 1], bins[m + 2]
        if b > a: fb[m, a:b] = np.linspace(0, 1, b - a, endpoint=False)
        if c > b: fb[m, b:c] = np.linspace(1, 0, c - b, endpoint=False)
    f = np.log(sp @ fb.T + 1e-8)
    return f - f.mean(axis=1, keepdims=True)  # remove overall loudness so the shape of the spectrum is what is compared

def dtw(a, b):
    n, m = len(a), len(b)
    d = np.sqrt(((a[:, None, :] - b[None, :, :]) ** 2).mean(axis=2))
    c = np.full((n + 1, m + 1), np.inf); c[0, 0] = 0
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            c[i, j] = d[i - 1, j - 1] + min(c[i - 1, j], c[i, j - 1], c[i - 1, j - 1])
    i, j, path = n, m, []
    while i > 0 and j > 0:
        path.append((i - 1, j - 1)); k = np.argmin([c[i - 1, j - 1], c[i - 1, j], c[i, j - 1]])
        i, j = (i - 1, j - 1) if k == 0 else (i - 1, j) if k == 1 else (i, j - 1)
    return path[::-1], d

def analyse(x):
    db = frames_rms_db(x); f0 = pitch(x, db); v = f0[f0 > 0]
    act = db > max(-45, np.percentile(db, 10) + 12)
    segs, st = [], None
    for k, a in enumerate(act):
        if a and st is None: st = k
        if (not a or k == len(act) - 1) and st is not None:
            segs.append([st / 100, k / 100]); st = None
    merged = []
    for s, e in segs:
        if merged and s - merged[-1][1] < 0.15: merged[-1][1] = e
        else: merged.append([s, e])
    pauses = [[round(merged[i][1], 2), round(merged[i + 1][0] - merged[i][1], 2)] for i in range(len(merged) - 1) if merged[i + 1][0] - merged[i][1] >= 0.2]
    env = np.convolve(10 ** (db / 20), np.ones(5) / 5, 'same')
    from scipy.signal import find_peaks
    pk = find_peaks(env, prominence=0.15 * env.max(), distance=8)[0]
    out = {'seconds': round(len(x) / SR, 2), 'peak_db': round(float(20 * np.log10(np.abs(x).max() + 1e-9)), 1), 'speech_db': round(float(np.percentile(db, 90)), 1),
           'voiced_fraction': round(len(v) / max(1, len(f0)), 2), 'speech_spans': [[round(s, 2), round(e, 2)] for s, e in merged], 'pauses_after_s': pauses,
           'syllable_peaks': int(len(pk)), 'syllables_per_second': round(len(pk) / max(0.1, sum(e - s for s, e in merged)), 2)}
    if len(v) > 5:
        out['pitch_hz'] = {'median': round(float(np.median(v))), 'p10': round(float(np.percentile(v, 10))), 'p90': round(float(np.percentile(v, 90))),
                           'range_semitones_p10_p90': round(float(12 * np.log2(np.percentile(v, 90) / np.percentile(v, 10))), 1)}
    out['pitch_contour_50ms'] = [int(np.median(f0[i:i + 5])) for i in range(0, len(f0) - 4, 5)]
    return out, db, f0

def asr(path, model, start, end):
    try:
        from faster_whisper import WhisperModel
    except ImportError:
        return {'asr': 'faster-whisper is not installed'}
    import tempfile, os
    x = load(path, start, end); tmp = tempfile.mktemp(suffix='.wav'); wavio.write(tmp, SR, (x * 32767).astype(np.int16))
    segs, _ = WhisperModel(model, device='cpu', compute_type='int8').transcribe(tmp, language='en', word_timestamps=True, beam_size=5, temperature=0)
    words = [{'w': w.word.strip(), 's': round(w.start, 2), 'e': round(w.end, 2), 'p': round(w.probability, 2)} for s in segs for w in (s.words or [])]
    os.remove(tmp)
    return {'transcript': ' '.join(w['w'] for w in words), 'words': words, 'mean_word_confidence': round(float(np.mean([w['p'] for w in words])), 2) if words else None}

def png(x, f0, out):
    import matplotlib; matplotlib.use('Agg'); import matplotlib.pyplot as plt
    fig, ax = plt.subplots(figsize=(11, 4)); ax.specgram(x, NFFT=512, Fs=SR, noverlap=384, cmap='magma', vmin=-110, vmax=-30); ax.set_ylim(0, 6000)
    t = np.arange(len(f0)) * 0.01; ax2 = ax.twinx(); ax2.plot(t, np.where(f0 > 0, f0, np.nan), 'c.', ms=3); ax2.set_ylim(60, 300); ax2.set_ylabel('pitch Hz')
    ax.set_xlabel('s'); ax.set_ylabel('Hz'); fig.tight_layout(); fig.savefig(out, dpi=80); plt.close(fig)

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('clip'); ap.add_argument('--start', type=float); ap.add_argument('--end', type=float)
    ap.add_argument('--ref'); ap.add_argument('--ref-start', type=float); ap.add_argument('--ref-end', type=float)
    ap.add_argument('--png'); ap.add_argument('--asr'); a = ap.parse_args()
    x = load(a.clip, a.start, a.end); res, db, f0 = analyse(x)
    if a.asr: res.update(asr(a.clip, a.asr, a.start, a.end))
    if a.png: png(x, f0, a.png); res['png'] = a.png
    if a.ref:
        r = load(a.ref, a.ref_start, a.ref_end); rr, _, _ = analyse(r)
        def trim(sig):  # drop leading/trailing silence so the two are compared word-to-word
            d = frames_rms_db(sig); idx = np.where(d > max(-45, np.percentile(d, 10) + 12))[0]
            return sig[max(0, (idx[0] - 3) * 160): (idx[-1] + 3) * 160 + 480] if len(idx) else sig
        A, B = mel_features(trim(x)), mel_features(trim(r)); path, d = dtw(A, B)
        cost = np.array([d[i, j] for i, j in path])
        res['vs_reference'] = {'spectral_distance': round(float(cost.mean()), 2), 'note': 'lower is closer; the same person saying the same line twice measured 1.05 on one test, my synthesizer about 2.2',
            'pace_ratio_clip_over_ref': round(len(A) / len(B), 2), 'ref_pitch_median': rr.get('pitch_hz', {}).get('median'), 'ref_pitch_range_semitones': rr.get('pitch_hz', {}).get('range_semitones_p10_p90')}
    print(json.dumps(res))

if __name__ == '__main__': main()
