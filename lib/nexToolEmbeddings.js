// lib/nexToolEmbeddings.js
// Semantic fallback for tool_search's category matching. The keyword
// matcher in nexBrain.js (matchCategoriesKeyword) stays the first,
// free, instant pass — this only runs when that finds nothing, so a
// query like "handle a refund for this guy" still lands on `billing`
// even though the word "billing" never appears in it.
//
// Uses Voyage AI (Anthropic's recommended embeddings partner — there
// is no first-party Anthropic embeddings endpoint). Two Redis-backed
// caches keep this cheap and fast on repeat:
//  - category embeddings: computed once ever (10 short texts), reused
//    forever after — categories don't change at runtime.
//  - query -> matched-categories: caches the OUTCOME of a semantic
//    match by exact query text, so reconstructing which categories a
//    conversation already unlocked (nexBrain's discoverUnlockedCategories,
//    called on every turn) never re-embeds the same past query twice.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
const VOYAGE_MODEL = process.env.VOYAGE_EMBED_MODEL || 'voyage-3.5-lite';
const CATEGORY_EMBEDDINGS_KEY = 'nexus:tool-embeddings:v1';
const MATCH_CACHE_KEY = 'nexus:tool-search-match-cache:v1';
const SIMILARITY_THRESHOLD = 0.55;

let categoryEmbeddingsMemo = null; // per-warm-instance memo, avoids a Redis round trip on every call

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('nexToolEmbeddings redisCommand failed', command[0], res.status);
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

async function embed(texts, inputType) {
  const apiKey = process.env.VOYAGE_API_KEY;
  if (!apiKey) throw new Error('VOYAGE_API_KEY is not configured.');
  const res = await fetch(VOYAGE_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ input: texts, model: VOYAGE_MODEL, input_type: inputType }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Voyage embeddings request failed (${res.status}).`);
  return data.data.map((item) => item.embedding);
}

function cosineSimilarity(a, b) {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

// categories: { key: { label, tools: [name,...] } }, byName: Map of tool name -> tool schema (for descriptions)
async function getCategoryEmbeddings(categories, byName) {
  if (categoryEmbeddingsMemo) return categoryEmbeddingsMemo;

  const raw = await redisCommand(['HGETALL', CATEGORY_EMBEDDINGS_KEY]).catch(() => null);
  if (raw && Array.isArray(raw) && raw.length) {
    const stored = {};
    for (let i = 0; i < raw.length; i += 2) {
      try { stored[raw[i]] = JSON.parse(raw[i + 1]); } catch { /* skip malformed entry */ }
    }
    if (Object.keys(stored).length === Object.keys(categories).length) {
      categoryEmbeddingsMemo = stored;
      return stored;
    }
  }

  // First run ever (or a category was added/renamed since): compute
  // and persist. One Voyage call for all categories together.
  const keys = Object.keys(categories);
  const texts = keys.map((key) => {
    const cat = categories[key];
    const toolText = cat.tools.map((name) => `${name}: ${byName.get(name)?.description || ''}`).join(' ');
    return `${cat.label}. ${toolText}`.slice(0, 4000);
  });
  const vectors = await embed(texts, 'document');
  const result = {};
  const writes = ['HSET', CATEGORY_EMBEDDINGS_KEY];
  keys.forEach((key, i) => {
    result[key] = vectors[i];
    writes.push(key, JSON.stringify(vectors[i]));
  });
  await redisCommand(writes).catch((err) => console.error('nexToolEmbeddings: failed to persist category embeddings:', err.message));
  categoryEmbeddingsMemo = result;
  return result;
}

async function getCachedMatch(query) {
  return redisCommand(['HGET', MATCH_CACHE_KEY, query]).then((raw) => {
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }).catch(() => null);
}

async function setCachedMatch(query, matched) {
  await redisCommand(['HSET', MATCH_CACHE_KEY, query, JSON.stringify(matched)]).catch((err) =>
    console.error('nexToolEmbeddings: failed to cache match result:', err.message)
  );
}

// Returns an array of 0-2 category keys, semantically matched. Never
// throws on missing config (no VOYAGE_API_KEY) — returns [] instead,
// so a misconfigured embeddings key degrades to "no semantic match"
// rather than breaking tool_search entirely.
export async function semanticMatchCategories(query, categories, byName) {
  const q = String(query || '').trim();
  if (!q) return [];

  const cached = await getCachedMatch(q);
  if (cached) return cached;

  try {
    const categoryEmbeddings = await getCategoryEmbeddings(categories, byName);
    const [queryVector] = await embed([q], 'query');
    const scored = Object.entries(categoryEmbeddings)
      .map(([key, vector]) => [key, cosineSimilarity(queryVector, vector)])
      .sort((a, b) => b[1] - a[1]);
    const matched = scored.filter(([, score]) => score >= SIMILARITY_THRESHOLD).slice(0, 2).map(([key]) => key);
    await setCachedMatch(q, matched);
    return matched;
  } catch (err) {
    console.error('semanticMatchCategories failed, degrading to no match:', err.message);
    return [];
  }
}
