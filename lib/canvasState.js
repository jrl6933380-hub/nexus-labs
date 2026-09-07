// /lib/canvasState.js
// Shared, live state for the single Nexus canvas: one backdrop image
// and the position/size of every panel on it. Stored as one JSON blob
// in Redis (same pattern as board.js/queue.js) and read back on every
// board poll (see api/board.js), so a change made from one browser —
// dragging a panel, or setting a new backdrop from Room Builder —
// shows up for anyone else looking at the canvas within one poll
// interval, with no redeploy and no per-user storage.
//
// Deliberately one canvas, not one per room: Justin's call was that
// "rooms" become saved views on this same shared surface, not
// separate pages each with their own layout to maintain.

const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
const CANVAS_KEY = 'nexus:canvas:state';

const DEFAULT_STATE = Object.freeze({
  backdrop_url: null,
  panels: {},
  updated_at: null,
});

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

export async function getCanvasState() {
  const raw = await redisCommand(['GET', CANVAS_KEY]);
  if (!raw) return { ...DEFAULT_STATE, panels: {} };
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_STATE, ...parsed, panels: parsed.panels || {} };
  } catch {
    return { ...DEFAULT_STATE, panels: {} };
  }
}

async function saveCanvasState(state) {
  state.updated_at = Date.now();
  await redisCommand(['SET', CANVAS_KEY, JSON.stringify(state)]);
  return state;
}

// Only a URL is stored — no validation of what it points to beyond
// "is a non-empty string" or null to clear it. This is deliberately
// simple: it renders as a CSS background-image, so a bad value just
// shows a broken/blank backdrop, never anything worse.
export async function setBackdrop({ url }) {
  const state = await getCanvasState();
  state.backdrop_url = url ? String(url).slice(0, 2000) : null;
  return saveCanvasState(state);
}

// Upserts one panel's layout by id. A panel id that doesn't exist yet
// is created — this is how a brand-new panel gets its first position
// the first time someone drags or resizes it, no separate "register
// this panel" step required.
export async function setPanelLayout({ id, x, y, w, h, z }) {
  if (!id) throw new Error('id is required');
  const state = await getCanvasState();
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

export async function deletePanelLayout({ id }) {
  if (!id) throw new Error('id is required');
  const state = await getCanvasState();
  delete state.panels[id];
  return saveCanvasState(state);
}
