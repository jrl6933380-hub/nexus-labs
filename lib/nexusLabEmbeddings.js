import crypto from 'node:crypto';

// Persistent per-owner embedding index for Lab Search.
// One hash per owner: field = catalog item id, value = JSON {id,h,m,v,t}.
// An entry is "current" only when its text fingerprint AND model match, so edited
// items and model changes are re-embedded and removed items are dropped.
export const INDEX_LIMIT = 300;
export const BUILD_BATCH = 64;
export const BUILD_MAX = 192;
const fail = (message, status = 400) => Object.assign(new Error(message), {status});
const modelOf = env => env.VOYAGE_EMBED_MODEL || 'voyage-3.5-lite';
const textOf = d => `${d.name}\n${d.text}`.slice(0, 2000);
const fingerprint = (model, text) => crypto.createHash('sha256').update(`${model}\n${text}`).digest('hex').slice(0, 16);
const round = vector => vector.map(x => Math.round(x * 1e4) / 1e4);
function cosine(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length || a.length !== b.length || [...a, ...b].some(v => !Number.isFinite(v))) throw fail('The embedding provider returned invalid vectors.', 502);
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
function normalize(docs) {
  const seen = new Set(), out = [];
  for (const d of docs || []) {
    const id = String(d.id ?? `${d.source || ''}:${d.name}`);
    if (!d.name || seen.has(id)) continue;
    seen.add(id);
    out.push({id, name: String(d.name), text: String(d.text || ''), source: d.source || ''});
    if (out.length >= INDEX_LIMIT) break;
  }
  return out;
}
export function createEmbeddingIndex({command, embed, env = process.env, now = () => Date.now()}) {
  const key = owner => {
    if (!owner?.id) throw fail('Owner authentication required.', 401);
    return `nexus:lab:${encodeURIComponent(owner.id)}:embeddings:v1`;
  };
  async function load(owner) {
    const raw = await command(['HVALS', key(owner)]);
    const entries = new Map();
    for (const item of Array.isArray(raw) ? raw : []) {
      try {
        const e = JSON.parse(item);
        if (e && typeof e.id === 'string' && Array.isArray(e.v)) entries.set(e.id, e);
      } catch { /* skip corrupt entry; it will be rebuilt */ }
    }
    return entries;
  }
  function plan(docs, entries) {
    const model = modelOf(env), ids = new Set(docs.map(d => d.id));
    const current = [], stale = [], missing = [];
    for (const d of docs) {
      const e = entries.get(d.id), h = fingerprint(model, textOf(d));
      if (!e) missing.push({doc: d, h});
      else if (e.h !== h || e.m !== model) stale.push({doc: d, h});
      else current.push({doc: d, entry: e});
    }
    const removed = [...entries.keys()].filter(id => !ids.has(id));
    return {model, current, stale, missing, removed};
  }
  const summary = (p, total, entries) => ({
    model: p.model, catalog: total, indexed: p.current.length, stale: p.stale.length, missing: p.missing.length, removed: p.removed.length,
    ready: total > 0 && p.stale.length + p.missing.length === 0,
    updatedAt: [...entries.values()].reduce((m, e) => Math.max(m, e.t || 0), 0) || null,
  });
  return {
    async status(owner, catalog) {
      const docs = normalize(catalog), entries = await load(owner);
      return summary(plan(docs, entries), docs.length, entries);
    },
    async build(owner, catalog, {signal} = {}) {
      if (!env.VOYAGE_API_KEY) throw fail('Building the index needs the Voyage connection.', 409);
      const docs = normalize(catalog);
      if (!docs.length) throw fail('There are no catalog items to index.', 409);
      const entries = await load(owner), p = plan(docs, entries), k = key(owner);
      const todo = [...p.missing, ...p.stale].slice(0, BUILD_MAX);
      for (let i = 0; i < todo.length; i += BUILD_BATCH) {
        const batch = todo.slice(i, i + BUILD_BATCH);
        const vectors = await embed(batch.map(b => textOf(b.doc)), 'document', {env, signal});
        if (!Array.isArray(vectors) || vectors.length !== batch.length) throw fail('The embedding provider returned an incomplete response.', 502);
        const args = [];
        batch.forEach((b, j) => {
          if (!Array.isArray(vectors[j]) || !vectors[j].length || vectors[j].some(v => !Number.isFinite(v))) throw fail('The embedding provider returned invalid vectors.', 502);
          args.push(b.doc.id, JSON.stringify({id: b.doc.id, h: b.h, m: p.model, v: round(vectors[j]), t: now()}));
        });
        await command(['HSET', k, ...args]);
      }
      if (p.removed.length) await command(['HDEL', k, ...p.removed]);
      const after = await load(owner), next = plan(docs, after);
      return {...summary(next, docs.length, after), embedded: todo.length};
    },
    // Rank only entries that are current for today's catalog text and model.
    async query(owner, catalog, query, {signal, limit = 12} = {}) {
      if (!env.VOYAGE_API_KEY) throw fail('Indexed search needs the Voyage connection. Use keyword search for now.', 409);
      const docs = normalize(catalog), entries = await load(owner), p = plan(docs, entries);
      if (!p.current.length) throw fail('Build the index first, then search it.', 409);
      const q = await embed([query], 'query', {env, signal});
      if (!Array.isArray(q) || q.length !== 1) throw fail('The embedding provider returned an incomplete response.', 502);
      const results = p.current.map(({doc, entry}) => ({...doc, score: cosine(q[0], entry.v)})).sort((a, b) => b.score - a.score).slice(0, limit);
      const behind = p.stale.length + p.missing.length;
      return {results, model: p.model, indexed: p.current.length, behind};
    },
  };
}
