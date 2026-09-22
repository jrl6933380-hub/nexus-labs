// lib/forge/freeModelPool.js
//
// openrouter/free is OpenRouter's own black-box router: it picks a random
// free model per request and only filters for the features a request needs,
// not for whether that model actually behaves for a build. This module
// replaces that black box with a list we curate and control, plus a short
// Redis-backed cooldown for any model that stalls, returns nothing, or
// turns out not to be available.
//
// HARD-WON LESSON, DO NOT REPEAT: the first version of this file was written
// with model slugs from memory rather than from OpenRouter's live catalog.
// Every single one 404'd ("This model is unavailable for free", "No endpoints
// found for ..."), which took the free tier from unreliable to completely
// broken. The slugs below were read from GET https://openrouter.ai/api/v1/models
// and filtered to zero prompt AND completion pricing. OpenRouter rotates its
// free lineup, so:
//   - treat any 404 as "this slug is gone", not as a hard failure (callers
//     cool the model down and try the next one), and
//   - FREE_ROUTER_FALLBACK below is the last resort, so a fully stale list
//     degrades to the old black-box behavior instead of failing outright.
//
// Same raw-Redis-REST pattern as lib/roomAuth.js / lib/board.js. Best-effort
// throughout: a Redis hiccup must never block a build.

import crypto from 'node:crypto';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const COOLDOWN_KEY = 'nexus:forge:free-model-cooldown';
const COOLDOWN_MS = 30 * 60 * 1000; // 30 min: skips a bad patch, self-heals without a deploy.
// A slug that 404s is gone from the catalog, not having a bad minute. Park it
// for much longer so we stop paying a wasted round-trip on every request.
const MISSING_MODEL_COOLDOWN_MS = 24 * 60 * 60 * 1000;

// Verified present in OpenRouter's live catalog with $0 prompt and completion
// pricing. Chosen as general-purpose instruction-following models with enough
// context for a full page plus a continuation round. Deliberately excluded:
// reasoning-first variants (they spend their whole budget on hidden tokens
// before emitting anything visible — the original stall bug), and domain or
// modality specialists (vision, finance, health, content-safety, audio).
export const FREE_MODEL_ALLOWLIST = Object.freeze([
  'google/gemma-4-31b-it:free',
  'google/gemma-4-26b-a4b-it:free',
  'qwen/qwen3.8-27b:free',
  'nvidia/nemotron-3-super-120b-a12b:free',
  'z-ai/glm-5.2:free',
]);

// OpenRouter's own free router. Not preferred — it's the black box this
// module exists to replace — but it is a real, always-present slug, which
// makes it the right last resort if every curated model is cooled down or
// has been retired from the catalog.
export const FREE_ROUTER_FALLBACK = 'openrouter/free';

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
    if (Number(all[i + 1]) > now) cooled.add(all[i]);
  }
  return cooled;
}

/**
 * Picks a free model to try, excluding any in `excluding` (so a retry
 * actually tries something different) and, best-effort, anything currently
 * cooled down. Falls back to the allowlist minus exclusions if cooldowns
 * would rule everything out, and finally to OpenRouter's own free router,
 * which always exists.
 */
export async function pickFreeModel({ excluding = [] } = {}) {
  const excludeSet = new Set(excluding.filter(Boolean));
  const cooled = await getCooledDownModels();

  let candidates = FREE_MODEL_ALLOWLIST.filter((id) => !excludeSet.has(id) && !cooled.has(id));
  if (candidates.length === 0) {
    // Everything curated is either excluded or cooled down. Prefer a cooled-down
    // model we haven't already tried this request over giving up.
    candidates = FREE_MODEL_ALLOWLIST.filter((id) => !excludeSet.has(id));
  }
  if (candidates.length === 0) {
    return excludeSet.has(FREE_ROUTER_FALLBACK) ? FREE_MODEL_ALLOWLIST[0] : FREE_ROUTER_FALLBACK;
  }

  return candidates[crypto.randomInt(candidates.length)];
}

/** Records that a model stalled or returned nothing. Best-effort. */
export async function recordFreeModelStall(modelId) {
  if (!modelId) return;
  await redisCommand(['HSET', COOLDOWN_KEY, modelId, String(Date.now() + COOLDOWN_MS)]);
}

/**
 * Records that a model is gone from the catalog (OpenRouter answered 404).
 * Parked far longer than a stall: this isn't a bad minute, the slug has been
 * retired or moved behind paid access, and it will keep 404ing until the
 * allowlist is refreshed from the live catalog.
 */
export async function recordFreeModelMissing(modelId) {
  if (!modelId) return;
  console.warn(`forge: free model ${modelId} is no longer available — parking it and refreshing the allowlist is overdue`);
  await redisCommand(['HSET', COOLDOWN_KEY, modelId, String(Date.now() + MISSING_MODEL_COOLDOWN_MS)]);
}
