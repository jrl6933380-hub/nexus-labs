// Durable, room-scoped visuals rendered by Nex.
// Supabase is the primary store. Redis is a safe compatibility fallback so a
// missing migration never turns a visual request into a broken Nex run.

import crypto from 'node:crypto';

const MAX_WIDGET_CHARS = 120_000;
const MAX_HISTORY = 5;
const REDIS_KEY = 'nexus:pinned-visuals:v1';

function cleanRoomId(value) {
  const roomId = String(value || '').trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(roomId)) {
    throw new Error('room_id must use 1-64 lowercase letters, numbers, dashes, or underscores');
  }
  return roomId;
}

function cleanWidgetCode(value) {
  const code = String(value || '').trim();
  if (!code) throw new Error('widget_code is required');
  if (code.length > MAX_WIDGET_CHARS) throw new Error(`widget_code exceeds ${MAX_WIDGET_CHARS} characters`);
  return code;
}

function cleanSource(value) {
  return String(value || 'nex').trim().slice(0, 60) || 'nex';
}

function emptyRecord(roomId) {
  return {
    room_id: roomId,
    widget_code: '',
    source: 'nex',
    locked: false,
    history: [],
    updated_at: null,
  };
}

function normalizeEntry(entry) {
  if (!entry || typeof entry !== 'object' || !entry.widget_code) return null;
  return {
    id: String(entry.id || crypto.randomUUID()),
    widget_code: String(entry.widget_code).slice(0, MAX_WIDGET_CHARS),
    source: cleanSource(entry.source),
    created_at: String(entry.created_at || new Date().toISOString()),
  };
}

function normalizeRecord(roomId, record) {
  const base = emptyRecord(roomId);
  if (!record || typeof record !== 'object') return base;
  return {
    ...base,
    room_id: roomId,
    widget_code: String(record.widget_code || '').slice(0, MAX_WIDGET_CHARS),
    source: cleanSource(record.source),
    locked: record.locked === true,
    history: (Array.isArray(record.history) ? record.history : []).map(normalizeEntry).filter(Boolean).slice(0, MAX_HISTORY),
    updated_at: record.updated_at || null,
  };
}

export function createPinnedVisualService(store) {
  if (!store?.read || !store?.write) throw new Error('Pinned visual store requires read and write methods');

  async function get(roomId) {
    const normalizedRoomId = cleanRoomId(roomId);
    return normalizeRecord(normalizedRoomId, await store.read(normalizedRoomId));
  }

  async function render({ room_id, widget_code, source = 'nex' }) {
    const roomId = cleanRoomId(room_id);
    const code = cleanWidgetCode(widget_code);
    const now = new Date().toISOString();
    const current = await get(roomId);
    const entry = { id: crypto.randomUUID(), widget_code: code, source: cleanSource(source), created_at: now };
    const history = [entry, ...current.history.filter((item) => item.id !== entry.id)].slice(0, MAX_HISTORY);
    const next = current.locked
      ? { ...current, history, updated_at: now }
      : { ...current, widget_code: code, source: entry.source, history, updated_at: now };
    await store.write(next);
    return { ...next, rendered: !current.locked, saved_to_history: true };
  }

  async function setLocked({ room_id, locked }) {
    const roomId = cleanRoomId(room_id);
    const current = await get(roomId);
    const next = { ...current, locked: locked === true, updated_at: new Date().toISOString() };
    await store.write(next);
    return next;
  }

  async function restore({ room_id, history_id }) {
    const roomId = cleanRoomId(room_id);
    const current = await get(roomId);
    const entry = current.history.find((item) => item.id === String(history_id || ''));
    if (!entry) throw new Error('That visual is no longer in this room’s five-item history');
    const next = {
      ...current,
      widget_code: entry.widget_code,
      source: entry.source,
      history: [entry, ...current.history.filter((item) => item.id !== entry.id)].slice(0, MAX_HISTORY),
      updated_at: new Date().toISOString(),
    };
    await store.write(next);
    return next;
  }

  return { get, render, setLocked, restore };
}

function supabaseStore(env = process.env, fetchImpl = globalThis.fetch) {
  const url = String(env.SUPABASE_URL || '').replace(/\/$/u, '');
  const key = env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_ANON_KEY;
  if (!url || !key || typeof fetchImpl !== 'function') return null;
  const headers = { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  return {
    async read(roomId) {
      const response = await fetchImpl(`${url}/rest/v1/pinned_visuals?room_id=eq.${encodeURIComponent(roomId)}&select=room_id,widget_code,source,locked,history,updated_at&limit=1`, { headers });
      if (!response.ok) throw new Error(`Supabase pinned_visuals read failed (HTTP ${response.status})`);
      const rows = await response.json();
      return Array.isArray(rows) ? rows[0] || null : null;
    },
    async write(record) {
      const response = await fetchImpl(`${url}/rest/v1/pinned_visuals?on_conflict=room_id`, {
        method: 'POST',
        headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=minimal' },
        body: JSON.stringify(record),
      });
      if (!response.ok) throw new Error(`Supabase pinned_visuals write failed (HTTP ${response.status})`);
    },
  };
}

function redisStore(env = process.env, fetchImpl = globalThis.fetch) {
  const url = env.KV_REST_API_URL;
  const token = env.KV_REST_API_TOKEN;
  if (!url || !token || typeof fetchImpl !== 'function') return null;

  async function command(args) {
    const response = await fetchImpl(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
    });
    const data = await response.json();
    if (!response.ok || data.error) throw new Error(`Pinned visual Redis ${args[0]} failed`);
    return data.result;
  }

  return {
    async read(roomId) {
      const raw = await command(['HGET', REDIS_KEY, roomId]);
      if (!raw) return null;
      try { return JSON.parse(raw); } catch { return null; }
    },
    async write(record) {
      await command(['HSET', REDIS_KEY, record.room_id, JSON.stringify(record)]);
    },
  };
}

export function createProductionPinnedVisualStore({ env = process.env, fetchImpl = globalThis.fetch } = {}) {
  const primary = supabaseStore(env, fetchImpl);
  const fallback = redisStore(env, fetchImpl);
  if (!primary && !fallback) throw new Error('Pinned visuals require Supabase or Redis configuration');
  if (!primary) return fallback;
  if (!fallback) return primary;
  return {
    async read(roomId) {
      try {
        const record = await primary.read(roomId);
        return record || fallback.read(roomId);
      }
      catch (error) {
        console.warn('pinnedVisuals: Supabase unavailable, reading Redis fallback:', error.message);
        return fallback.read(roomId);
      }
    },
    async write(record) {
      try { await primary.write(record); }
      catch (error) {
        console.warn('pinnedVisuals: Supabase unavailable, writing Redis fallback:', error.message);
        await fallback.write(record);
      }
    },
  };
}

let productionService;
function service() {
  if (!productionService) productionService = createPinnedVisualService(createProductionPinnedVisualStore());
  return productionService;
}

export function getPinnedVisual(roomId) { return service().get(roomId); }
export function renderPinnedVisual(input) { return service().render(input); }
export function setPinnedVisualLocked(input) { return service().setLocked(input); }
export function restorePinnedVisual(input) { return service().restore(input); }

export const PINNED_VISUAL_LIMITS = Object.freeze({ maxWidgetChars: MAX_WIDGET_CHARS, maxHistory: MAX_HISTORY });
