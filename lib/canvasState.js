// /lib/canvasState.js
// Shared, live state for Nexus canvases — plural now. What started as
// one global surface (backdrop + panel layout) is now a named
// instance per canvas, stored in one Redis hash keyed by canvas id, so
// each room (and each new venture) can have its own persistent,
// live-editable surface instead of sharing a single one.
//
// Backward compatible on purpose: every function defaults canvas_id
// to DEFAULT_CANVAS_ID ('dashboard') when omitted, so the existing
// homepage canvas — built before this generalization — keeps working
// with zero changes to its own calls.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const CANVASES_KEY = 'nexus:canvas:instances';
export const DEFAULT_CANVAS_ID = 'dashboard';

function emptyCanvas(id, name) {
  return {
    id,
    name: name || id,
    backdrop_url: null,
    panels: {},
    created_at: Date.now(),
    updated_at: null,
  };
}

// Loose bounds only — real clamping to the viewport happens client-side
// (a panel's "home" position on a 1440-wide screen is still meaningful
// data on a 1024-wide one, just re-clamped on load). This just stops a
// clearly bad write (negative size, absurd coordinates) from poisoning
// the shared state for everyone.
const MIN_SIZE = 40;
const MAX_COORD = 20000;

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('Missing KV_REST_API_URL or KV_REST_API_TOKEN');
  const res = await fetch(KV_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const data = await res.json();
  if (!res.ok) {
    console.error('canvasState redisCommand failed', command[0], res.status, JSON.stringify(data).slice(0, 300));
    throw new Error(`Redis command ${command[0]} failed`);
  }
  return data.result;
}

function clampCoord(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(-MAX_COORD, Math.min(MAX_COORD, n));
}

function clampSize(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < MIN_SIZE) return fallback;
  return Math.min(MAX_COORD, n);
}

function normalizeId(canvas_id) {
  const id = String(canvas_id || DEFAULT_CANVAS_ID).trim();
  return id || DEFAULT_CANVAS_ID;
}

export async function listCanvases() {
  const raw = await redisCommand(['HGETALL', CANVASES_KEY]);
  if (!raw || !Array.isArray(raw)) return [];
  const canvases = [];
  for (let i = 0; i < raw.length; i += 2) {
    try {
      canvases.push(JSON.parse(raw[i + 1]));
    } catch {
      // skip a malformed entry rather than crashing the whole list
    }
  }
  canvases.sort((a, b) => (a.created_at || 0) - (b.created_at || 0));
  return canvases;
}

export async function getCanvasState(canvas_id) {
  const id = normalizeId(canvas_id);
  const raw = await redisCommand(['HGET', CANVASES_KEY, id]);
  if (!raw) return emptyCanvas(id);
  try {
    const parsed = JSON.parse(raw);
    return { ...emptyCanvas(id), ...parsed, panels: parsed.panels || {} };
  } catch {
    return emptyCanvas(id);
  }
}

async function saveCanvasState(state) {
  state.updated_at = Date.now();
  await redisCommand(['HSET', CANVASES_KEY, state.id, JSON.stringify(state)]);
  return state;
}

// Creates a brand new canvas — the "new venture" moment: naming an
// idea gets it a real, empty, on-brand surface immediately. Returns
// the existing canvas unchanged if the id already exists, rather than
// clobbering it — creating is idempotent, not a reset.
export async function createCanvas({ id, name }) {
  if (!id) throw new Error('id is required');
  const normalizedId = normalizeId(id);
  const existing = await redisCommand(['HGET', CANVASES_KEY, normalizedId]);
  if (existing) {
    try {
      return JSON.parse(existing);
    } catch {
      // fall through and recreate a malformed entry
    }
  }
  return saveCanvasState(emptyCanvas(normalizedId, name));
}

export async function deleteCanvas({ id }) {
  if (!id) throw new Error('id is required');
  const normalizedId = normalizeId(id);
  if (normalizedId === DEFAULT_CANVAS_ID) throw new Error('The dashboard canvas cannot be deleted');
  await redisCommand(['HDEL', CANVASES_KEY, normalizedId]);
  return { id: normalizedId, deleted: true };
}

// Only a URL is stored — no validation of what it points to beyond
// "is a non-empty string" or null to clear it. This is deliberately
// simple: it renders as a CSS background-image, so a bad value just
// shows a broken/blank backdrop, never anything worse.
export async function setBackdrop({ canvas_id, url }) {
  const state = await getCanvasState(canvas_id);
  state.backdrop_url = url ? String(url).slice(0, 2000) : null;
  return saveCanvasState(state);
}

// Upserts one panel's layout by id, within one canvas. A panel id that
// doesn't exist yet is created — this is how a brand-new panel gets
// its first position the first time someone drags or resizes it, no
// separate "register this panel" step required.
export async function setPanelLayout({ canvas_id, id, x, y, w, h, z }) {
  if (!id) throw new Error('id is required');
  const state = await getCanvasState(canvas_id);
  const existing = state.panels[id] || {};
  state.panels[id] = {
    x: clampCoord(x, existing.x ?? 0),
    y: clampCoord(y, existing.y ?? 0),
    w: clampSize(w, existing.w ?? 320),
    h: clampSize(h, existing.h ?? 200),
    z: Number.isFinite(Number(z)) ? Number(z) : (existing.z ?? 0),
  };
  return saveCanvasState(state);
}

export async function deletePanelLayout({ canvas_id, id }) {
  if (!id) throw new Error('id is required');
  const state = await getCanvasState(canvas_id);
  delete state.panels[id];
  return saveCanvasState(state);
}
