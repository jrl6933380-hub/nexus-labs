// lib/imageGen.js
//
// Client for the image service that runs on Justin's RunPod pod (pod/diffusion/server.py,
// port 8001). It finds the same pod the Nex brain uses, checks the image service is up,
// asks it for a picture and hands back a small data URI the Ad Maker image library accepts.
//
// Never throws a secret: errors carry a plain message and a code. Nothing here starts a
// pod; if the pod is off the caller gets IMAGE_POD_OFFLINE.

import { isNexPod } from './forge/podBrain.js';

const RUNPOD_REST = 'https://rest.runpod.io/v1';
export const IMAGE_PORT = 8001;
export const IMAGE_REQUEST_LIMITS = Object.freeze({
  promptMin: 3,
  promptMax: 1000,
  sideMin: 256,
  sideMax: 1024,
  sideStep: 16,
  stepsMax: 50,
  seedMax: 2147483647,
});
// Same ceiling the image library enforces on a data URI (lib/adImages.js).
export const IMAGE_DATA_URI_MAX = 140000;
const HEALTH_TIMEOUT_MS = 3000;
const GENERATE_TIMEOUT_MS = 120000;
const DATA_URI = /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/;

const fail = (message, status = 502, code = 'IMAGE_POD_ERROR') => Object.assign(new Error(message), { status, code });

function wholeNumber(value, label, min, max, step = 1) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max || (n - min) % step !== 0) {
    throw fail(`${label} must be a whole number from ${min} to ${max}${step > 1 ? ` in steps of ${step}` : ''}.`, 400, 'INVALID_INPUT');
  }
  return n;
}

export function validateImageRequest(input = {}) {
  const L = IMAGE_REQUEST_LIMITS;
  const prompt = String(input.prompt ?? '').replace(/\s+/g, ' ').trim();
  if (prompt.length < L.promptMin) throw fail(`Describe the picture (at least ${L.promptMin} characters).`, 400, 'INVALID_INPUT');
  if (prompt.length > L.promptMax) throw fail(`Keep the picture description under ${L.promptMax} characters.`, 400, 'INVALID_INPUT');
  const out = {
    prompt,
    width: input.width === undefined ? 1024 : wholeNumber(input.width, 'width', L.sideMin, L.sideMax, L.sideStep),
    height: input.height === undefined ? 1024 : wholeNumber(input.height, 'height', L.sideMin, L.sideMax, L.sideStep),
  };
  if (input.steps !== undefined) out.steps = wholeNumber(input.steps, 'steps', 1, L.stepsMax);
  if (input.seed !== undefined) out.seed = wholeNumber(input.seed, 'seed', 0, L.seedMax);
  return out;
}

/** Id of the running Nex pod, or null. Never throws. */
export async function findRunningPodId({ fetchImpl = fetch, env = process.env } = {}) {
  try {
    if (!env.RUNPOD_API_KEY) return null;
    const res = await fetchImpl(`${RUNPOD_REST}/pods`, { headers: { Authorization: `Bearer ${env.RUNPOD_API_KEY}` } });
    if (!res.ok) return null;
    const pods = await res.json();
    const pod = Array.isArray(pods) ? pods.find((p) => isNexPod(p) && p?.desiredStatus === 'RUNNING') : null;
    return pod?.id || null;
  } catch {
    return null;
  }
}

async function withTimeout(ms, run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await run(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Make one picture on the pod. Resolves to { data_uri, width, height, seed, ms }.
 * Rejects with { status, code } errors: INVALID_INPUT, IMAGE_POD_OFFLINE, IMAGE_POD_ERROR.
 */
export async function generateImage(input, { fetchImpl = fetch, env = process.env, timeoutMs = GENERATE_TIMEOUT_MS, now = Date.now } = {}) {
  const request = validateImageRequest(input);
  const podKey = env.NEX_POD_KEY;
  if (!env.RUNPOD_API_KEY || !podKey) throw fail('Image generation is not set up yet.', 503, 'IMAGE_POD_OFFLINE');

  const podId = await findRunningPodId({ fetchImpl, env });
  if (!podId) throw fail('The Nex pod is off, so pictures cannot be made right now. Ask the owner to start it.', 503, 'IMAGE_POD_OFFLINE');

  const base = `https://${podId}-${IMAGE_PORT}.proxy.runpod.net`;
  let healthy = false;
  try {
    const health = await withTimeout(HEALTH_TIMEOUT_MS, (signal) => fetchImpl(`${base}/health`, { signal }));
    healthy = Boolean(health.ok);
  } catch {
    healthy = false;
  }
  if (!healthy) throw fail('The image service is not running on the pod.', 503, 'IMAGE_POD_OFFLINE');

  const started = now();
  let res;
  try {
    res = await withTimeout(timeoutMs, (signal) => fetchImpl(`${base}/v1/images/generate`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${podKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    }));
  } catch {
    throw fail('The image service did not answer in time.', 504, 'IMAGE_POD_ERROR');
  }
  if (!res.ok) throw fail(`The image service returned an error (${res.status}).`, 502, 'IMAGE_POD_ERROR');

  let body;
  try { body = await res.json(); } catch { throw fail('The image service sent a reply that could not be read.', 502, 'IMAGE_POD_ERROR'); }
  const uri = body?.data_uri;
  if (typeof uri !== 'string' || !DATA_URI.test(uri)) throw fail('The image service did not return a picture.', 502, 'IMAGE_POD_ERROR');
  if (uri.length > IMAGE_DATA_URI_MAX) throw fail('The picture came back too large for the image library.', 502, 'IMAGE_POD_ERROR');
  return {
    data_uri: uri,
    width: Number(body.width) || request.width,
    height: Number(body.height) || request.height,
    seed: Number.isInteger(body.seed) ? body.seed : null,
    ms: now() - started,
  };
}
