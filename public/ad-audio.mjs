// Turns audio samples into the small loudness envelopes that graphic scenes react to (audioLow / audioMid /
// audioHigh, 0-100 per sample, `rate` samples per second), and estimates tempo. Pure functions, no I/O and no
// imports, so the same source runs in Node (lib/adAudio.js re-exports it; scripts decode files with ffmpeg) and
// inline in the board page (Web Audio decodes the file, this analyses it). Same samples in, same numbers out, so
// renders stay deterministic. The envelopes are stored in the ad itself, so the player never touches an audio file.

export const AUDIO_BANDS = { low: [0, 200], mid: [200, 2500], high: [2500, Infinity] };
export const AUDIO_MAX_SAMPLES = 1800;
const MAX_RATE = 60;

// Robert Bristow-Johnson biquad coefficients, direct form I.
function biquad(type, fc, fs, q = Math.SQRT1_2) {
  const w = (2 * Math.PI * fc) / fs, cos = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  let b0, b1, b2;
  if (type === 'low') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2; }
  else { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2; }
  const a0 = 1 + alpha, a1 = -2 * cos, a2 = 1 - alpha;
  const c = [b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0];
  return (input) => {
    const out = new Float64Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (let i = 0; i < input.length; i++) {
      const x = input[i];
      const y = c[0] * x + c[1] * x1 + c[2] * x2 - c[3] * y1 - c[4] * y2;
      out[i] = y; x2 = x1; x1 = x; y2 = y1; y1 = y;
    }
    return out;
  };
}

function bandSignal(samples, fs, band) {
  const [lo, hi] = AUDIO_BANDS[band];
  const nyq = fs / 2 - 1;
  let sig = Float64Array.from(samples);
  // Each filter runs twice (4th order) so a band does not pick up much of its neighbours.
  if (lo > 0) { const f = biquad('high', Math.min(lo, nyq), fs); sig = f(f(sig)); }
  if (Number.isFinite(hi)) { const f = biquad('low', Math.min(hi, nyq), fs); sig = f(f(sig)); }
  return sig;
}

function windowRms(sig, hop) {
  const n = Math.floor(sig.length / hop), out = new Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += sig[j] * sig[j];
    out[i] = Math.sqrt(sum / hop);
  }
  return out;
}

// Quick attack, slower release, so bars jump on a hit and fall back smoothly.
function smooth(values, attack = 0.85, release = 0.35) {
  const out = new Array(values.length);
  let prev = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    prev = v > prev ? prev + (v - prev) * attack : prev + (v - prev) * release;
    out[i] = prev;
  }
  return out;
}

// Scale so the loud parts (95th percentile) reach 100. A silent band stays at 0.
function normalise(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] || 0;
  if (!(p95 > 1e-6)) return values.map(() => 0);
  return values.map((v) => Math.max(0, Math.min(100, Math.round((v / p95) * 100))));
}

/**
 * @param {ArrayLike<number>} samples mono samples, roughly -1..1
 * @param {number} sampleRate samples per second of `samples`
 * @param {{rate?: number, maxSeconds?: number}} [opts] rate = envelope samples per second (2-60, default 20)
 * @returns {{rate: number, seconds: number, audioLow: number[], audioMid: number[], audioHigh: number[]}}
 */
export function envelopesFromPcm(samples, sampleRate, opts = {}) {
  const rate = Math.round(Number(opts.rate ?? 20));
  if (!Number.isFinite(rate) || rate < 2 || rate > MAX_RATE) throw new Error(`rate must be between 2 and ${MAX_RATE}`);
  if (!Number.isFinite(sampleRate) || sampleRate < 4000) throw new Error('sampleRate must be at least 4000');
  const cap = Math.min(600, Number(opts.capSeconds ?? 30)); // scenes are 30 s at most; the track library asks for more
  const maxSeconds = Math.min(cap, Number(opts.maxSeconds ?? cap));
  const limit = Math.floor(Math.min(samples.length, maxSeconds * sampleRate, (AUDIO_MAX_SAMPLES / rate) * sampleRate));
  const clip = Array.prototype.slice.call(samples, 0, limit);
  const hop = Math.max(1, Math.round(sampleRate / rate));
  const result = { rate, seconds: Math.round((clip.length / sampleRate) * 100) / 100 };
  for (const [band, key] of [['low', 'audioLow'], ['mid', 'audioMid'], ['high', 'audioHigh']]) {
    result[key] = normalise(smooth(windowRms(bandSignal(clip, sampleRate, band), hop))).slice(0, AUDIO_MAX_SAMPLES);
  }
  return result;
}

// Fields of a graphic scene's params that the envelopes fill in.
export function envelopeToSceneParams(env) {
  return { audioRate: env.rate, audioLow: env.audioLow, audioMid: env.audioMid, audioHigh: env.audioHigh };
}

/**
 * Estimate tempo and where the beats fall from mono samples. This is an estimate: `confidence` (0-1) says how
 * clearly a steady pulse stood out. Free speech or rubato playing gives a low number; trust bpm only when it is
 * above about 0.35. Music with a clear kick or snare usually scores 0.5+.
 * @returns {{bpm: number|null, confidence: number, beatOffset: number, seconds: number}}
 */
export function estimateTempo(samples, sampleRate, opts = {}) {
  const minBpm = opts.minBpm ?? 60, maxBpm = opts.maxBpm ?? 200, rate = 200;
  const seconds = Math.round((samples.length / sampleRate) * 100) / 100;
  const none = { bpm: null, confidence: 0, beatOffset: 0, seconds };
  if (!Number.isFinite(sampleRate) || sampleRate < 4000 || seconds < 4) return none;
  const hop = Math.max(1, Math.round(sampleRate / rate)), n = Math.floor(samples.length / hop);
  // Short-time energy, then its positive change: a hit is a jump in energy.
  const energy = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let j = i * hop; j < (i + 1) * hop; j++) sum += samples[j] * samples[j];
    energy[i] = Math.sqrt(sum / hop);
  }
  const flux = new Float64Array(n);
  for (let i = 1; i < n; i++) flux[i] = Math.max(0, energy[i] - energy[i - 1]);
  // Remove the slow average so a steady loud passage does not look like a pulse.
  const win = Math.round(rate * 0.5), onset = new Float64Array(n);
  let run = 0, peak = 0;
  for (let i = 0; i < n; i++) {
    run += flux[i]; if (i >= win) run -= flux[i - win];
    onset[i] = Math.max(0, flux[i] - run / Math.min(i + 1, win));
    if (onset[i] > peak) peak = onset[i];
  }
  if (!(peak > 1e-6)) return none;
  const minLag = Math.floor((rate * 60) / maxBpm), maxLag = Math.ceil((rate * 60) / minBpm);
  const top = Math.min(n - 2, maxLag * 2 + 2);
  if (top <= minLag * 2) return none;
  const ac = new Float64Array(top + 1);
  for (let lag = 1; lag <= top; lag++) {
    let sum = 0;
    for (let i = lag; i < n; i++) sum += onset[i] * onset[i - lag];
    ac[lag] = sum / (n - lag);
  }
  // A pulse at lag L also shows up at 2L; add that in, and lean gently towards everyday tempos.
  const score = new Float64Array(maxLag + 2);
  let best = minLag, total = 0, count = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    const b = (rate * 60) / lag, prior = Math.exp(-0.5 * (Math.log2(b / 120) / 1.1) ** 2);
    score[lag] = (ac[lag] + 0.5 * (ac[lag * 2] || 0)) * (0.6 + 0.4 * prior);
    total += score[lag]; count++;
    if (score[lag] > score[best]) best = lag;
  }
  const mean = total / count;
  if (!(score[best] > 0) || !(mean > 0)) return none;
  // Parabolic interpolation around the winning lag for sub-sample precision.
  let lagF = best;
  if (best > minLag && best < maxLag) {
    const a = score[best - 1], b = score[best], c = score[best + 1], d = a - 2 * b + c;
    if (d < 0) lagF = best + (0.5 * (a - c)) / d;
  }
  const bpm = Math.round(((rate * 60) / lagF) * 10) / 10;
  const confidence = Math.max(0, Math.min(1, (score[best] / mean - 1) / 4));
  // Phase: the offset whose comb of beats lands on the most onset energy.
  let bestPhase = 0, bestSum = -1;
  for (let phase = 0; phase < lagF; phase++) {
    let sum = 0;
    for (let t = phase; t < n; t += lagF) sum += onset[Math.round(t)] || 0;
    if (sum > bestSum) { bestSum = sum; bestPhase = phase; }
  }
  return { bpm, confidence: Math.round(confidence * 100) / 100, beatOffset: Math.round((bestPhase / rate) * 1000) / 1000, seconds };
}

/** Envelopes plus tempo in one pass, shaped for the track library. Picks an envelope rate that fits 1800 samples. */
export function analyseTrack(samples, sampleRate, opts = {}) {
  const seconds = samples.length / sampleRate;
  if (!(seconds > 0)) throw new Error('No audio samples to analyse.');
  const rate = Math.max(2, Math.min(20, Math.floor(AUDIO_MAX_SAMPLES / Math.max(1, Math.min(600, seconds)))));
  const env = envelopesFromPcm(samples, sampleRate, { rate, capSeconds: 600, maxSeconds: 600 });
  const tempo = estimateTempo(samples, sampleRate, opts);
  return { seconds: Math.round(Math.min(600, seconds) * 100) / 100, bpm: tempo.bpm, bpmConfidence: tempo.confidence, beatOffset: tempo.beatOffset, envelope: { rate: env.rate, low: env.audioLow, mid: env.audioMid, high: env.audioHigh } };
}
