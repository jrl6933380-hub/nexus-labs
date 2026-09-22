// lib/forge/freeModelPool.js
//
// openrouter/free is OpenRouter's own black-box router: it picks a random
// free model per request and only filters for the features a request needs
// (see brainProviders.js), not for whether that model actually behaves for
// a build — streams promptly, doesn't spend its whole budget on invisible
// reasoning tokens, has enough context for a full page plus a continuation
// round. This module replaces that black box with a list we curate and
// control, plus a short Redis-backed cooldown for any model the stall
// watchdog in brainStream.js catches going silent. A model having a bad
// stretch gets skipped for a while and comes back on its own once the
// cooldown expires, rather than needing a manual denylist edit every time
// OpenRouter's free capacity shifts.
//
// Same raw-Redis-REST pattern as lib/roomAuth.js / lib/board.js — no new
// dependency for something this small. Best-effort throughout: a Redis
// hiccup should never block a build over which free model to try.

import crypto from 'node:crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const COOLDOWN_KEY = 'nexus:forge:free-model-cooldown';
const COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes: long enough to skip a bad patch, short enough to self-heal.

// Curated for: supports OpenRouter's streaming SSE cleanly, has a context
// window comfortably large enough for a full HTML page plus one
// continuation round, and is not one of the "thinking"-first free variants
// that spend their whole budget on hidden reasoning tokens before emitting
// anything visible. Revisit occasionally — OpenRouter's free lineup changes
// as providers rotate free capacity in and out.
export const FREE_MODEL_ALLOWLIST = Object.freeze([
  'meta-llama/llama-3.3-70b-instruct:free',
  'qwen/qwen-2.5-72b-instruct:free',
  'mistralai/mistral-small-3.1-24b-instruct:free',
  'google/gemma-3-27b-it:free',
  'nvidia/llama-3.1-nemotron-70b-instruct:free',
]);

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) return null; // cooldown is best-effort, never blocks a build
  try {
    const res = await fetch(KV_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(command),
    });
    const data = await res.json();
    if (!res.ok || data.error) return null;
    return data.result;
  } catch {
    return null;
  }
}

/** Models currently in cooldown. Best-effort — empty on any Redis issue. */
async function getCooledDownModels() {
  const all = await redisCommand(['HGETALL', COOLDOWN_KEY]);
  if (!Array.isArray(all)) return new Set();
  const now = Date.now();
  const cooled = new Set();
  for (let i = 0; i < all.length; i += 2) {
    const modelId = all[i];
    const expiry = Number(all[i + 1]);
    if (expiry > now) cooled.add(modelId);
  }
  return cooled;
}

/**
 * Picks a free model to try, excluding any passed in `excluding` (so a
 * stall retry actually tries something different) and, best-effort, any
 * model currently in cooldown from a recent stall elsewhere. Falls back to
 * the full allowlist minus only the exclusions if cooldowns would rule out
 * everything — a slow model beats no model.
 */
export async function pickFreeModel({ excluding = [] } = {}) {
  const excludeSet = new Set(excluding.filter(Boolean));
  const cooled = await getCooledDownModels();

  let candidates = FREE_MODEL_ALLOWLIST.filter((id) => !excludeSet.has(id) && !cooled.has(id));
  if (candidates.length === 0) candidates = FREE_MODEL_ALLOWLIST.filter((id) => !excludeSet.has(id));
  if (candidates.length === 0) candidates = FREE_MODEL_ALLOWLIST.slice();

  return candidates[crypto.randomInt(candidates.length)];
}

/** Records that a model went silent, so it's skipped for a while. Best-effort. */
export async function recordFreeModelStall(modelId) {
  if (!modelId) return;
  await redisCommand(['HSET', COOLDOWN_KEY, modelId, String(Date.now() + COOLDOWN_MS)]);
}
