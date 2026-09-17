const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
export const RECENT_LIMIT = 24;

export function primaryOperatorUsername() {
  return String(process.env.NEXUS_OPERATOR_USERNAMES || 'Mrlopez')
    .split(',')[0]
    .trim() || 'Mrlopez';
}

export function recentKeyFor(username) {
  const normalized = String(username || '').trim().toLowerCase();
  if (!/^[a-z0-9_-]{3,32}$/u.test(normalized)) throw new Error('A valid operator username is required for Nex conversation storage.');
  return `nex:recent-conversation:${normalized}`;
}

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) return null;
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error(`Nex conversation Redis ${command[0]} failed`);
  return data.result;
}

export async function loadRecentConversation(username) {
  const raw = await redisCommand(['GET', recentKeyFor(username)]);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((message) => message && typeof message.content === 'string' && message.content.trim())
      : [];
  } catch {
    return [];
  }
}

export async function saveRecentConversation(username, fullHistory) {
  if (!KV_URL || !KV_TOKEN) return;
  const clean = (Array.isArray(fullHistory) ? fullHistory : [])
    .filter((message) => message?.role !== 'system' && typeof message?.content === 'string' && message.content.trim())
    .slice(-RECENT_LIMIT);
  await redisCommand(['SET', recentKeyFor(username), JSON.stringify(clean)]);
}

export async function appendRecentConversation(username, message) {
  const history = await loadRecentConversation(username);
  history.push(message);
  await saveRecentConversation(username, history);
  return history.slice(-RECENT_LIMIT);
}
