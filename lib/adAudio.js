// Turns audio samples into the small loudness envelopes that graphic scenes react to (audioLow / audioMid /
// audioHigh, 0-100 per sample, `rate` samples per second). Pure functions, no I/O: scripts/ad-audio-envelope.mjs
// decodes a file with ffmpeg and calls envelopesFromPcm. Same samples in, same numbers out, so renders stay
// deterministic. The envelopes are stored in the ad itself, so the player never touches an audio file.

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
  const maxSeconds = Math.min(30, Number(opts.maxSeconds ?? 30));
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
