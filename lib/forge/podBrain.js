// lib/forge/podBrain.js
//
// Justin's self-hosted Nex (vLLM on his RunPod pod) as a Forge brain.
//
// Who gets it: NEX_POD_USERS — "*" for every signed-in account, or a
// comma-separated list of usernames. Unset means nobody (pod route off).
//
// When it's used: only when the pod named "nex-pod" — or the pod carrying
// Justin's dedicated model volume — is RUNNING and answers a health check with
// NEX_POD_KEY. RunPod can assign a random name when a pod is created manually,
// but the persistent model volume is the stable identity.
//
// Pod ids change every deploy, so the pod is discovered by name through the
// RunPod API instead of being pinned in an env var.

const RUNPOD_REST = 'https://rest.runpod.io/v1';
const POD_NAME = 'nex-pod';
export const NEX_POD_VOLUME_ID = '1o0z6btbch';
export const POD_MODEL = 'nex-base';
const CACHE_MS = 30_000;
const HEALTH_TIMEOUT_MS = 3_000;

let cache = { at: 0, url: null };

export function _resetPodCacheForTests() { cache = { at: 0, url: null }; }

export function podUsers(env = process.env) {
  return String(env.NEX_POD_USERS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

export function isPodUser(username, env = process.env) {
  if (!username) return false;
  const users = podUsers(env);
  // "*" = every signed-in account builds on the pod while it's live. The pod
  // is a flat hourly cost, and every build is still metered per customer.
  if (users.includes('*')) return true;
  return users.includes(String(username).trim().toLowerCase());
}

export function isNexPod(pod) {
  return Boolean(pod && (
    pod.name === POD_NAME
    || pod.networkVolumeId === NEX_POD_VOLUME_ID
    || pod.networkVolume?.id === NEX_POD_VOLUME_ID
  ));
}

/**
 * Returns the pod's OpenAI-compatible base URL (…/v1) if the pod is running and
 * healthy, otherwise null. Never throws — any problem means "no pod right now".
 */
export async function livePodBaseUrl({ fetchImpl = fetch, env = process.env, now = Date.now() } = {}) {
  if (now - cache.at < CACHE_MS) return cache.url;
  let url = null;
  try {
    const runpodKey = env.RUNPOD_API_KEY;
    const podKey = env.NEX_POD_KEY;
    if (runpodKey && podKey) {
      const res = await fetchImpl(`${RUNPOD_REST}/pods`, {
        headers: { Authorization: `Bearer ${runpodKey}` },
      });
      const pods = res.ok ? await res.json() : [];
      const pod = Array.isArray(pods)
        ? pods.find((p) => isNexPod(p) && p?.desiredStatus === 'RUNNING')
        : null;
      if (pod?.id) {
        const base = `https://${pod.id}-8000.proxy.runpod.net/v1`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), HEALTH_TIMEOUT_MS);
        try {
          const health = await fetchImpl(`${base}/models`, {
            headers: { Authorization: `Bearer ${podKey}` },
            signal: controller.signal,
          });
          if (health.ok) url = base;
        } finally {
          clearTimeout(timer);
        }
      }
    }
  } catch {
    url = null;
  }
  cache = { at: now, url };
  return url;
}

/** Request body for the pod. Builds think at medium depth: good plans, sane latency. */
export function podRequestBody({ messages, maxTokens, stream = true }) {
  return {
    model: POD_MODEL,
    stream,
    max_tokens: maxTokens,
    messages,
    chat_template_kwargs: { reasoning_effort: 'medium' },
  };
}
