// Bounded, project-scoped conversation memory for the customer-facing Web
// Builder Nex. Each key is isolated by the authenticated Room account and a
// server-validated project id. This is working context, not long-term Nex
// memory: it expires after 30 days and keeps only the latest 40 turns.

import { redactSecrets } from './secretScan.js';

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const MAX_TURNS = 40;
const MAX_TEXT_LENGTH = 2_000;
const TTL_SECONDS = 30 * 24 * 60 * 60;
const PROJECT_ID_RE = /^[a-zA-Z0-9_-]{1,120}$/;

function conversationKey(userId, projectId) {
  return `nexus:room:conversation:${encodeURIComponent(String(userId))}:${encodeURIComponent(projectId)}`;
}

function normalizeProjectId(projectId) {
  const value = String(projectId || '');
  if (!PROJECT_ID_RE.test(value)) throw new Error('Invalid Room project id');
  return value;
}

function normalizeTurn(turn, now) {
  if (!turn || (turn.role !== 'user' && turn.role !== 'assistant')) {
    throw new Error('Invalid Room conversation role');
  }
  const rawText = String(turn.text || '').trim();
  if (!rawText) throw new Error('Room conversation text is required');
  const { text } = redactSecrets(rawText.slice(0, MAX_TEXT_LENGTH));
  return { role: turn.role, text, createdAt: Number(turn.createdAt) || now() };
}

async function defaultRedisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const response = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Room conversation ${command[0]} failed`);
  return data.result;
}

export function createRoomConversationStore({ command = defaultRedisCommand, now = () => Date.now() } = {}) {
  async function getConversation(userId, projectId) {
    if (!userId) throw new Error('Room conversation requires a user id');
    const key = conversationKey(userId, normalizeProjectId(projectId));
    const raw = await command(['LRANGE', key, '0', '-1']);
    if (!Array.isArray(raw)) return [];
    return raw.map((entry) => {
      try {
        const parsed = JSON.parse(entry);
        return normalizeTurn(parsed, now);
      } catch {
        return null;
      }
    }).filter(Boolean).slice(-MAX_TURNS);
  }

  async function appendTurns(userId, projectId, turns) {
    if (!userId) throw new Error('Room conversation requires a user id');
    if (!Array.isArray(turns) || turns.length === 0) return [];
    const key = conversationKey(userId, normalizeProjectId(projectId));
    const normalized = turns.map((turn) => normalizeTurn(turn, now));
    await command(['RPUSH', key, ...normalized.map((turn) => JSON.stringify(turn))]);
    await command(['LTRIM', key, String(-MAX_TURNS), '-1']);
    await command(['EXPIRE', key, String(TTL_SECONDS)]);
    return normalized;
  }

  return { getConversation, appendTurns };
}

export const roomConversations = createRoomConversationStore();
export const __internals = { MAX_TURNS, MAX_TEXT_LENGTH, TTL_SECONDS, PROJECT_ID_RE };
