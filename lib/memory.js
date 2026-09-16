// /lib/memory.js
// Shared helpers for Nex's structured long-term memory.
// Storage: Upstash Redis hash "nex:memories" — field = memory id, value = JSON string.
// This replaces the old flat conversation-log-as-memory approach.

import { routeMessage } from './modelRouter.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const MEMORY_KEY = 'nex:memories';
const CANDIDATE_KEY = 'nex:memory:candidates';
const EVENT_KEY = 'nex:memory:events';
const VALID_CATEGORIES = ['fact', 'project', 'for_claude'];
const VALID_SCOPES = ['profile', 'preference', 'project', 'topic', 'person', 'system'];
const VALID_PROVENANCE = ['stated', 'explicit_decision', 'observed_result', 'legacy', 'curated'];
const ACTIVE_STATUS = 'active';
const DEFAULT_CURATOR_IDLE_MS = 60_000;
const CURATOR_BATCH_LIMIT = 4;

// Compression settings — every memory currently gets sent in full on
// every single message (see nexBrain.js), so an unbounded memory list
// means unbounded token cost forever. Once the total crosses
// COMPRESS_THRESHOLD, the oldest entries beyond the most recent
// KEEP_RECENT get condensed into one summary per category, replacing
// many raw entries with one dense paragraph. Keeps cost bounded
// without losing the actual signal.
const COMPRESS_THRESHOLD = 30;
const KEEP_RECENT = 15;
const SEARCH_LIMIT = 8;

const STOP_WORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'have', 'has', 'was', 'were',
  'are', 'but', 'not', 'you', 'your', 'his', 'her', 'its', 'our', 'they', 'them',
  'into', 'about', 'when', 'what', 'where', 'which', 'who', 'how', 'why', 'can',
]);

function normalizeTags(tags, content = '') {
  const supplied = Array.isArray(tags) ? tags : [];
  const candidates = supplied.length ? supplied : tokenize(content);
  return [...new Set(candidates.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].slice(0, 5);
}

function tokenize(value) {
  return String(value || '')
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]{2,}/g)?.filter((word) => !STOP_WORDS.has(word)) || [];
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('redisCommand failed', command[0], res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

function defaultScope(category) {
  if (category === 'project') return 'project';
  if (category === 'for_claude') return 'system';
  return 'profile';
}

export function normalizeMemory(memory = {}) {
  const category = VALID_CATEGORIES.includes(memory.category) ? memory.category : 'fact';
  const content = String(memory.content || memory.claim || '').trim();
  return {
    ...memory,
    content,
    claim: content,
    category,
    scope: VALID_SCOPES.includes(memory.scope) ? memory.scope : defaultScope(category),
    provenance: VALID_PROVENANCE.includes(memory.provenance) ? memory.provenance : 'legacy',
    confidence: Number.isFinite(Number(memory.confidence)) ? Math.max(0, Math.min(1, Number(memory.confidence))) : 1,
    status: memory.status || ACTIVE_STATUS,
    tags: Array.isArray(memory.tags) ? memory.tags : [],
  };
}

function parseHash(raw, normalize = (value) => value) {
  if (!raw || !Array.isArray(raw)) return [];
  const values = [];
  for (let i = 0; i < raw.length; i += 2) {
    try {
      values.push(normalize(JSON.parse(raw[i + 1])));
    } catch {
      // One malformed record should not make the whole memory system unavailable.
    }
  }
  return values;
}

async function recordMemoryEvent(action, payload = {}) {
  try {
    const event = JSON.stringify({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, action, at: Date.now(), ...payload });
    await redisCommand(['LPUSH', EVENT_KEY, event]);
    await redisCommand(['LTRIM', EVENT_KEY, '0', '199']);
  } catch (err) {
    // Audit telemetry is useful, but it must never block the memory mutation.
    console.error('recordMemoryEvent failed:', err.message);
  }
}

export async function listMemories() {
  try {
    const raw = await redisCommand(['HGETALL', MEMORY_KEY]);
    if (!raw || !Array.isArray(raw)) return [];
    const memories = parseHash(raw, normalizeMemory);
    memories.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    return memories;
  } catch (err) {
    console.error('listMemories failed:', err.message);
    return [];
  }
}

async function addMemoryRaw(content, category, tags = [], metadata = {}) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const memory = normalizeMemory({
    id,
    content,
    category: VALID_CATEGORIES.includes(category) ? category : 'fact',
    tags: normalizeTags(tags, content),
    created_at: Date.now(),
    scope: metadata.scope,
    project: metadata.project || null,
    topic: metadata.topic || null,
    provenance: metadata.provenance || 'stated',
    confidence: metadata.confidence ?? 1,
    source_turn: metadata.source_turn || null,
    supersedes: metadata.supersedes || null,
    status: metadata.status || ACTIVE_STATUS,
  });
  await redisCommand(['HSET', MEMORY_KEY, id, JSON.stringify(memory)]);
  await recordMemoryEvent('memory_saved', { memory_id: id, provenance: memory.provenance });
  return memory;
}

async function summarizeWithClaude(combinedText, category) {
  // If summarization can't run for any reason, fall back to a plain
  // truncation rather than failing — a rough compression still beats
  // blocking the save or leaving the count unbounded.
  if (!process.env.AI_GATEWAY_API_KEY) return combinedText.slice(0, 800);
  try {
    const { data } = await routeMessage({
      tier: 'cheap',
      claudeModel: process.env.MEMORY_SUMMARY_MODEL || 'claude-haiku-4-5-20251001',
      body: {
        max_tokens: 600,
        system: `Condense these ${category} memories into a single dense paragraph. Preserve every concrete fact, name, decision, and number — do not summarize away specifics. No commentary, no meta-language about "these memories" — just write it as one memory entry that reads naturally on its own.`,
        messages: [{ role: 'user', content: combinedText }],
      },
      env: { ...process.env, NEX_FORCE_GATEWAY: 'true' },
    });
    const textBlock = data?.content?.find((b) => b.type === 'text');
    return textBlock?.text || combinedText.slice(0, 800);
  } catch (err) {
    console.error('summarizeWithClaude threw:', err.message);
    return combinedText.slice(0, 800);
  }
}

export async function compressOldMemories() {
  // Never let a superseded fact leak back into active context through a
  // compression summary. Only active canonical records are eligible.
  const memories = (await listMemories()).filter((memory) => memory.status === ACTIVE_STATUS); // oldest first
  const overflow = memories.length - KEEP_RECENT;
  if (overflow < 5) return null; // not worth compressing a tiny batch

  const toCompress = memories.slice(0, overflow);

  const byCategory = {};
  for (const m of toCompress) {
    if (!byCategory[m.category]) byCategory[m.category] = [];
    byCategory[m.category].push(m);
  }

  const summaries = [];
  for (const [category, items] of Object.entries(byCategory)) {
    const combinedText = items.map((m) => `- ${m.content}`).join('\n');
    const summaryText = await summarizeWithClaude(combinedText, category);
    const summaryMemory = await addMemoryRaw(
      `[Summary of ${items.length} older entries] ${summaryText}`,
      category,
      [...new Set(items.flatMap((m) => m.tags || []))].slice(0, 5),
      { provenance: 'curated', scope: defaultScope(category) }
    );
    for (const m of items) {
      await redisCommand(['HDEL', MEMORY_KEY, m.id]);
    }
    summaries.push(summaryMemory);
  }

  console.log('compressOldMemories: compressed', toCompress.length, 'entries into', summaries.length, 'summaries');
  return summaries;
}

export async function addMemory(content, category, tags = [], metadata = {}) {
  const memory = await addMemoryRaw(content, category, tags, metadata);

  // Check and compress after saving. Never let a compression failure
  // block the actual save the caller cares about.
  try {
    const count = await redisCommand(['HLEN', MEMORY_KEY]);
    if (count && count > COMPRESS_THRESHOLD) {
      await compressOldMemories();
    }
  } catch (err) {
    console.error('post-save compression check failed:', err.message);
  }

  return memory;
}

export async function updateMemory(id, content, category, tags) {
  const raw = await redisCommand(['HGET', MEMORY_KEY, id]);
  if (!raw) throw new Error(`Memory not found: ${id}`);
  const existing = JSON.parse(raw);
  const updated = normalizeMemory({
    ...existing,
    content: content !== undefined ? content : existing.content,
    category: category !== undefined && VALID_CATEGORIES.includes(category) ? category : existing.category,
    tags: tags !== undefined ? normalizeTags(tags, content ?? existing.content) : (Array.isArray(existing.tags) ? existing.tags : []),
    updated_at: Date.now(),
  });
  await redisCommand(['HSET', MEMORY_KEY, id, JSON.stringify(updated)]);
  await recordMemoryEvent('memory_updated', { memory_id: id });
  return updated;
}

export async function searchMemories(query, limit = SEARCH_LIMIT) {
  const memories = await listMemories();
  return rankMemories(memories, query, limit);
}

export function rankMemories(memories, query, limit = SEARCH_LIMIT) {
  const queryText = String(query || '').toLowerCase();
  const queryTerms = [...new Set(tokenize(queryText))];
  const safeLimit = Math.max(1, Math.min(Number(limit) || SEARCH_LIMIT, 20));

  const required = (Array.isArray(memories) ? memories : [])
    .filter((memory) => (memory.status || ACTIVE_STATUS) === ACTIVE_STATUS)
    .filter((memory) => memory.category === 'for_claude')
    .sort((a, b) => (b.updated_at || b.created_at || 0) - (a.updated_at || a.created_at || 0))
    .slice(0, safeLimit);
  const requiredIds = new Set(required.map((memory) => memory.id));

  const ranked = (Array.isArray(memories) ? memories : [])
    .filter((memory) => (memory.status || ACTIVE_STATUS) === ACTIVE_STATUS)
    .filter((memory) => !requiredIds.has(memory.id))
    .map((memory) => {
      const content = String(memory.content || '').toLowerCase();
      const tags = normalizeTags(memory.tags);
      let score = queryText && content.includes(queryText) ? 8 : 0;
      for (const term of queryTerms) {
        if (tags.includes(term)) score += 5;
        if (content.includes(term)) score += 1;
        if (tags.some((tag) => tag.startsWith(term) || term.startsWith(tag))) score += 2;
      }
      return { memory, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.memory.updated_at || b.memory.created_at || 0) - (a.memory.updated_at || a.memory.created_at || 0))
    .slice(0, Math.max(0, safeLimit - required.length))
    .map(({ memory }) => memory);

  return [...required, ...ranked];
}

export async function deleteMemory(id) {
  await redisCommand(['HDEL', MEMORY_KEY, id]);
  await recordMemoryEvent('memory_deleted', { memory_id: id });
}

export async function stageExchangeForMemory({ userMessage, assistantReply, sourceTurn = null } = {}) {
  const user = String(userMessage || '').trim();
  if (!user) return null;
  const id = `candidate-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const candidate = {
    id,
    kind: 'exchange',
    status: 'pending',
    user_message: user.slice(0, 6000),
    assistant_reply: String(assistantReply || '').trim().slice(0, 6000),
    source_turn: sourceTurn,
    created_at: Date.now(),
  };
  await redisCommand(['HSET', CANDIDATE_KEY, id, JSON.stringify(candidate)]);
  await recordMemoryEvent('candidate_staged', { candidate_id: id });
  return candidate;
}

export async function listMemoryCandidates({ status = 'pending' } = {}) {
  try {
    const candidates = parseHash(await redisCommand(['HGETALL', CANDIDATE_KEY]));
    return candidates
      .filter((candidate) => !status || candidate.status === status)
      .sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  } catch (err) {
    console.error('listMemoryCandidates failed:', err.message);
    return [];
  }
}

export function parseCuratorDecision(text) {
  const cleaned = String(text || '').replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Memory curator returned no JSON object');
  const parsed = JSON.parse(cleaned.slice(start, end + 1));
  const memories = Array.isArray(parsed.memories) ? parsed.memories : [];
  return {
    memories: memories
      .filter((item) => item && String(item.content || '').trim())
      .slice(0, 6)
      .map((item) => ({
        content: String(item.content).trim(),
        category: VALID_CATEGORIES.includes(item.category) ? item.category : 'fact',
        scope: VALID_SCOPES.includes(item.scope) ? item.scope : defaultScope(item.category),
        provenance: ['stated', 'explicit_decision'].includes(item.provenance) ? item.provenance : 'stated',
        confidence: Math.max(0, Math.min(1, Number(item.confidence) || 1)),
        tags: normalizeTags(item.tags, item.content),
        project: item.project ? String(item.project).slice(0, 120) : null,
        topic: item.topic ? String(item.topic).slice(0, 120) : null,
        supersedes_id: item.supersedes_id ? String(item.supersedes_id) : null,
      })),
  };
}

async function defaultCurator({ candidate, activeMemories }) {
  const { data } = await routeMessage({
    tier: 'cheap',
    claudeModel: process.env.MEMORY_CURATOR_MODEL || 'claude-haiku-4-5-20251001',
    body: {
      max_tokens: 900,
      system: `You curate durable memory for an AI assistant. Return only JSON: {"memories":[]}.
Add a memory only for a durable fact, preference, ongoing project fact, or explicit decision that the USER stated. Never store the assistant's suggestion, inference, praise, summary, or research as a fact about the user. Ignore casual requests and facts useful only inside the current chat. Each item may contain content, category (fact|project), scope (profile|preference|project|topic|person), provenance (stated|explicit_decision), confidence, tags, project, topic, and supersedes_id. If the user corrects an active memory, include that id as supersedes_id. Keep standalone wording and at most six items.`,
      messages: [{
        role: 'user',
        content: JSON.stringify({
          user_message: candidate.user_message,
          assistant_reply_for_exclusion_only: candidate.assistant_reply,
          active_memories: activeMemories.map(({ id, content, category, scope, project, topic }) => ({ id, content, category, scope, project, topic })),
        }),
      }],
    },
    env: { ...process.env, NEX_FORCE_GATEWAY: 'true' },
  });
  const text = data?.content?.find((block) => block.type === 'text')?.text || '';
  return parseCuratorDecision(text);
}

async function finishCandidate(candidate, status, details = {}) {
  const updated = { ...candidate, status, reviewed_at: Date.now(), ...details };
  await redisCommand(['HSET', CANDIDATE_KEY, candidate.id, JSON.stringify(updated)]);
  await recordMemoryEvent(`candidate_${status}`, { candidate_id: candidate.id, memory_ids: details.memory_ids || [] });
  return updated;
}

export async function curatePendingMemories({ now = Date.now(), idleMs, limit = CURATOR_BATCH_LIMIT, curator = defaultCurator, force = false } = {}) {
  if (!process.env.AI_GATEWAY_API_KEY && curator === defaultCurator) return { reviewed: 0, created: 0, skipped: 'gateway_unavailable' };
  const waitMs = Number.isFinite(Number(idleMs)) ? Number(idleMs) : Number(process.env.MEMORY_CURATOR_IDLE_MS || DEFAULT_CURATOR_IDLE_MS);
  const pending = (await listMemoryCandidates())
    .filter((candidate) => force || now - (candidate.created_at || 0) >= waitMs)
    .slice(0, Math.max(1, Math.min(Number(limit) || CURATOR_BATCH_LIMIT, 10)));
  if (!pending.length) return { reviewed: 0, created: 0 };

  let activeMemories = (await listMemories()).filter((memory) => memory.status === ACTIVE_STATUS);
  const created = [];
  for (const candidate of pending) {
    try {
      const decision = await curator({ candidate, activeMemories });
      const ids = [];
      for (const proposed of decision.memories || []) {
        const duplicate = activeMemories.find((memory) => memory.content.toLowerCase() === proposed.content.toLowerCase());
        if (duplicate) continue;
        if (proposed.supersedes_id) {
          const superseded = activeMemories.find((memory) => memory.id === proposed.supersedes_id);
          if (superseded) {
            const archived = normalizeMemory({ ...superseded, status: 'superseded', superseded_at: now, updated_at: now });
            await redisCommand(['HSET', MEMORY_KEY, superseded.id, JSON.stringify(archived)]);
            activeMemories = activeMemories.filter((memory) => memory.id !== superseded.id);
          }
        }
        const memory = await addMemory(proposed.content, proposed.category, proposed.tags, {
          ...proposed,
          source_turn: candidate.source_turn || candidate.id,
          supersedes: proposed.supersedes_id,
        });
        ids.push(memory.id);
        created.push(memory);
        activeMemories.push(memory);
      }
      await finishCandidate(candidate, 'reviewed', { memory_ids: ids });
    } catch (err) {
      console.error('curatePendingMemories failed for candidate:', candidate.id, err.message);
      const attempts = Number(candidate.attempts || 0) + 1;
      await finishCandidate(candidate, attempts >= 3 ? 'failed' : 'pending', {
        attempts,
        error: err.message.slice(0, 240),
      });
    }
  }
  return { reviewed: pending.length, created: created.length, memories: created };
}

export async function promoteMemoryCandidate(id, overrides = {}) {
  const raw = await redisCommand(['HGET', CANDIDATE_KEY, id]);
  if (!raw) throw new Error(`Memory candidate not found: ${id}`);
  const candidate = JSON.parse(raw);
  const content = String(overrides.content || candidate.user_message || '').trim();
  if (!content) throw new Error('Candidate has no content to promote');
  const memory = await addMemory(content, overrides.category || 'fact', overrides.tags || [], {
    scope: overrides.scope,
    project: overrides.project,
    topic: overrides.topic,
    provenance: overrides.provenance || 'stated',
    confidence: overrides.confidence ?? 1,
    source_turn: candidate.source_turn || candidate.id,
  });
  await finishCandidate(candidate, 'promoted', { memory_ids: [memory.id] });
  return memory;
}

export async function rejectMemoryCandidate(id) {
  const raw = await redisCommand(['HGET', CANDIDATE_KEY, id]);
  if (!raw) throw new Error(`Memory candidate not found: ${id}`);
  return finishCandidate(JSON.parse(raw), 'rejected');
}
