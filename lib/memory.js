// /lib/memory.js
// Shared helpers for Nex's structured long-term memory.
// Storage: Upstash Redis hash "nex:memories" — field = memory id, value = JSON string.
// This replaces the old flat conversation-log-as-memory approach.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const MEMORY_KEY = 'nex:memories';
const VALID_CATEGORIES = ['fact', 'project', 'for_claude'];

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

const CLAUDE_API_KEY = process.env.ANTHROPIC_API_KEY;
const CLAUDE_ENDPOINT = 'https://api.anthropic.com/v1/messages';

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

export async function listMemories() {
  try {
    const raw = await redisCommand(['HGETALL', MEMORY_KEY]);
    if (!raw || !Array.isArray(raw)) return [];
    const memories = [];
    for (let i = 0; i < raw.length; i += 2) {
      try {
        const memory = JSON.parse(raw[i + 1]);
        memories.push({ ...memory, tags: Array.isArray(memory.tags) ? memory.tags : [] });
      } catch {
        // skip a malformed entry rather than crashing the whole list
      }
    }
    memories.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
    return memories;
  } catch (err) {
    console.error('listMemories failed:', err.message);
    return [];
  }
}

async function addMemoryRaw(content, category, tags = []) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const memory = {
    id,
    content,
    category: VALID_CATEGORIES.includes(category) ? category : 'fact',
    tags: normalizeTags(tags, content),
    created_at: Date.now(),
  };
  await redisCommand(['HSET', MEMORY_KEY, id, JSON.stringify(memory)]);
  return memory;
}

async function summarizeWithClaude(combinedText, category) {
  // If summarization can't run for any reason, fall back to a plain
  // truncation rather than failing — a rough compression still beats
  // blocking the save or leaving the count unbounded.
  if (!CLAUDE_API_KEY) return combinedText.slice(0, 800);
  try {
    const response = await fetch(CLAUDE_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': CLAUDE_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 600,
        system: `Condense these ${category} memories into a single dense paragraph. Preserve every concrete fact, name, decision, and number — do not summarize away specifics. No commentary, no meta-language about "these memories" — just write it as one memory entry that reads naturally on its own.`,
        messages: [{ role: 'user', content: combinedText }],
      }),
    });
    if (!response.ok) {
      console.error('summarizeWithClaude: bad response', response.status);
      return combinedText.slice(0, 800);
    }
    const data = await response.json();
    const textBlock = data?.content?.find((b) => b.type === 'text');
    return textBlock?.text || combinedText.slice(0, 800);
  } catch (err) {
    console.error('summarizeWithClaude threw:', err.message);
    return combinedText.slice(0, 800);
  }
}

export async function compressOldMemories() {
  const memories = await listMemories(); // oldest first
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
      [...new Set(items.flatMap((m) => m.tags || []))].slice(0, 5)
    );
    for (const m of items) {
      await redisCommand(['HDEL', MEMORY_KEY, m.id]);
    }
    summaries.push(summaryMemory);
  }

  console.log('compressOldMemories: compressed', toCompress.length, 'entries into', summaries.length, 'summaries');
  return summaries;
}

export async function addMemory(content, category, tags = []) {
  const memory = await addMemoryRaw(content, category, tags);

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
  const updated = {
    ...existing,
    content: content !== undefined ? content : existing.content,
    category: category !== undefined && VALID_CATEGORIES.includes(category) ? category : existing.category,
    tags: tags !== undefined ? normalizeTags(tags, content ?? existing.content) : (Array.isArray(existing.tags) ? existing.tags : []),
    updated_at: Date.now(),
  };
  await redisCommand(['HSET', MEMORY_KEY, id, JSON.stringify(updated)]);
  return updated;
}

export async function searchMemories(query, limit = SEARCH_LIMIT) {
  const memories = await listMemories();
  const queryText = String(query || '').toLowerCase();
  const queryTerms = [...new Set(tokenize(queryText))];
  const safeLimit = Math.max(1, Math.min(Number(limit) || SEARCH_LIMIT, 20));

  const required = memories.filter((memory) => memory.category === 'for_claude');
  const requiredIds = new Set(required.map((memory) => memory.id));

  const ranked = memories
    .filter((memory) => !requiredIds.has(memory.id))
    .map((memory) => {
      const content = String(memory.content || '').toLowerCase();
      const tags = normalizeTags(memory.tags);
      let score = queryText && content.includes(queryText) ? 8 : 0;
      for (const term of queryTerms) {
        if (tags.includes(term)) score += 5;
        if (content.includes(term)) score += 1;
      }
      return { memory, score };
    })
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || (b.memory.updated_at || b.memory.created_at || 0) - (a.memory.updated_at || a.memory.created_at || 0))
    .slice(0, safeLimit)
    .map(({ memory }) => memory);

  return [...required, ...ranked];
}

export async function deleteMemory(id) {
  await redisCommand(['HDEL', MEMORY_KEY, id]);
}
