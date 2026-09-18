import { recentKeyFor } from './nexConversationStore.js';

export function requestKey(user, id) {
  if (!/^[a-zA-Z0-9-]{16,80}$/.test(String(id || ''))) throw new Error('Invalid request id');
  return `${recentKeyFor(user)}:request:${id}`;
}
export async function chatRequest(user, id, value) {
  const key = requestKey(user, id);
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  const command = value === undefined ? ['GET', key] : ['SET', key, JSON.stringify(value), 'EX', 86400];
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Request status storage unavailable');
  return value === undefined && data.result ? JSON.parse(data.result) : null;
}
