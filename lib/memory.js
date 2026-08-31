// /lib/memory.js
// Shared helpers for Nex's structured long-term memory.
// Storage: Upstash Redis hash "nex:memories" — field = memory id, value = JSON string.
// This replaces the old flat conversation-log-as-memory approach.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const MEMORY_KEY = 'nex:memories';
const VALID_CATEGORIES = ['fact', 'project', 'for_claude'];

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
        memories.push(JSON.parse(raw[i + 1]));
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

export async function addMemory(content, category) {
  const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const memory = {
    id,
    content,
    category: VALID_CATEGORIES.includes(category) ? category : 'fact',
    created_at: Date.now(),
  };
  await redisCommand(['HSET', MEMORY_KEY, id, JSON.stringify(memory)]);
  return memory;
}

export async function deleteMemory(id) {
  await redisCommand(['HDEL', MEMORY_KEY, id]);
}
