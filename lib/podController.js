// Owner-only control plane for the existing RunPod named `nex-pod`.
// This module deliberately cannot create, resize, delete, or retarget pods.

import { POD_MODEL } from './forge/podBrain.js';

const RUNPOD_REST = 'https://rest.runpod.io/v1';
const POD_NAME = 'nex-pod';
const HEALTH_TIMEOUT_MS = 5_000;

function configured(env) {
  return Boolean(env.RUNPOD_API_KEY && env.NEX_POD_KEY);
}

async function runpod(path, { method = 'GET', env = process.env, fetchImpl = fetch } = {}) {
  if (!env.RUNPOD_API_KEY) throw new Error('RUNPOD_API_KEY is not configured.');
  const response = await fetchImpl(`${RUNPOD_REST}${path}`, {
    method,
    headers: { Authorization: `Bearer ${env.RUNPOD_API_KEY}` },
  });
  const text = await response.text().catch(() => '');
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!response.ok) {
    const detail = [
      typeof data?.error === 'string' ? data.error : data?.error?.message,
      data?.message,
      data?.errorMessage,
      data?.detail,
      !data && text,
    ].find((value) => typeof value === 'string' && value.trim());
    const suffix = detail ? `: ${detail.trim().slice(0, 300)}` : '.';
    const error = new Error(`RunPod control request failed with HTTP ${response.status}${suffix}`);
    error.status = response.status;
    throw error;
  }
  return data;
}

export async function findNexPod(options = {}) {
  const pods = await runpod('/pods', options);
  if (!Array.isArray(pods)) return null;
  return pods.find((pod) => pod?.name === POD_NAME && pod?.desiredStatus === 'RUNNING')
    || pods.find((pod) => pod?.name === POD_NAME)
    || null;
}

async function podHealth(pod, { env = process.env, fetchImpl = fetch } = {}) {
  if (!pod?.id || pod.desiredStatus !== 'RUNNING' || !env.NEX_POD_KEY) {
    return { ready: false, latencyMs: null, model: POD_MODEL };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(`https://${pod.id}-8000.proxy.runpod.net/v1/models`, {
      headers: { Authorization: `Bearer ${env.NEX_POD_KEY}` },
      signal: controller.signal,
    });
    return { ready: response.ok, latencyMs: Date.now() - started, model: POD_MODEL };
  } catch {
    return { ready: false, latencyMs: null, model: POD_MODEL };
  } finally {
    clearTimeout(timer);
  }
}

function publicPod(pod) {
  if (!pod) return null;
  const gpu = pod.machine?.gpuTypeId
    || pod.machine?.gpuType?.displayName
    || pod.gpuTypeId
    || pod.gpu?.displayName
    || pod.gpu?.name
    || pod.gpu?.id
    || (typeof pod.gpu === 'string' ? pod.gpu : null);
  return {
    id: pod.id,
    name: pod.name,
    state: pod.desiredStatus || 'UNKNOWN',
    gpu: gpu || null,
    costPerHr: Number.isFinite(pod.costPerHr) ? pod.costPerHr : null,
    lastStartedAt: pod.lastStartedAt || null,
    locked: Boolean(pod.locked),
  };
}

export async function podStatus(options = {}) {
  const env = options.env || process.env;
  if (!configured(env)) return { configured: false, pod: null, health: { ready: false, latencyMs: null, model: POD_MODEL } };
  const pod = await findNexPod(options);
  const health = await podHealth(pod, options);
  return { configured: true, pod: publicPod(pod), health };
}

export async function controlPod(action, options = {}) {
  if (!['start', 'stop', 'restart'].includes(action)) throw new Error('Unsupported pod action.');
  const pod = await findNexPod(options);
  if (!pod?.id) throw new Error('No existing nex-pod was found. Deploy a fresh pod with the persistent volume attached first.');
  if (pod.locked && action === 'stop') throw new Error('The pod is locked in RunPod and cannot be stopped.');
  await runpod(`/pods/${encodeURIComponent(pod.id)}/${action}`, { ...options, method: 'POST' });
  return { ok: true, action, podId: pod.id };
}

export async function testPod(message, { env = process.env, fetchImpl = fetch, ...options } = {}) {
  const pod = await findNexPod({ env, fetchImpl, ...options });
  if (!pod?.id || pod.desiredStatus !== 'RUNNING') throw new Error('The Nex pod is not running.');
  const response = await fetchImpl(`https://${pod.id}-8000.proxy.runpod.net/v1/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.NEX_POD_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: POD_MODEL,
      messages: [{ role: 'user', content: String(message || 'Say hello as Nex in one sentence.').slice(0, 2_000) }],
      max_tokens: 500,
      chat_template_kwargs: { reasoning_effort: 'medium' },
    }),
  });
  if (!response.ok) throw new Error(`Pod test failed with HTTP ${response.status}.`);
  const data = await response.json();
  return { reply: data?.choices?.[0]?.message?.content || '', model: data?.model || POD_MODEL };
}
