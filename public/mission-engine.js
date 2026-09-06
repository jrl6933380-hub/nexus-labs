// /public/mission-engine.js
// Shared "engine" for every Mission Control skin (board view,
// conference room, future scenes). A skin never invents its own
// fetch/escaping logic — it consumes this instead — so the one thing
// that actually has to be right (real data, safely rendered) is
// written and tested once, not re-solved correctly by every new skin
// forever. See test/mission-engine.test.mjs for the real coverage.

// Escapes untrusted text (task titles, agent messages — anything that
// ultimately came from an agent or a board post) before it's ever
// inserted into innerHTML. Every skin MUST run agent/task text through
// this before rendering it; skipping it is exactly how an agent's own
// posted text could break out and run as script in a human's browser.
export function safeText(value) {
  return String(value || '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

// The one, single fallback shape every skin renders when /api/board is
// unreachable or errors — so a skin never has to invent its own "empty
// state" and never accidentally shows stale or fabricated activity as
// if it were real.
export const DISCONNECTED_BOARD = Object.freeze({
  tasks: [],
  agents: [],
  telemetry: {
    tasks_by_status: {},
    completed_tasks: 0,
    total_tasks: 0,
    needs_approval: 0,
    crash_count: 0,
    open_crash_count: 0,
    active_agents: 0,
  },
  disconnected: true,
});

// Fetches the real board snapshot. Never throws — any failure (network,
// non-2xx, malformed JSON) resolves to DISCONNECTED_BOARD instead, so a
// skin's render function never needs its own try/catch around this.
export async function fetchBoard(fetchImpl = fetch) {
  try {
    const res = await fetchImpl('/api/board', { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return DISCONNECTED_BOARD;
    const data = await res.json();
    return data && typeof data === 'object' ? data : DISCONNECTED_BOARD;
  } catch {
    return DISCONNECTED_BOARD;
  }
}

// Polls fetchBoard on an interval, calling onUpdate(board) each time,
// and pauses while the tab is hidden (battery — matches the existing
// index.html behavior this engine is meant to eventually replace
// there too). Returns a stop() function; always call it if the skin
// is torn down (e.g. switching skins) to avoid a leaked timer.
export function startPolling(onUpdate, { intervalMs = 8000, fetchImpl = fetch, doc = typeof document !== 'undefined' ? document : null } = {}) {
  let stopped = false;

  async function tick() {
    if (stopped) return;
    if (doc && doc.hidden) return;
    onUpdate(await fetchBoard(fetchImpl));
  }

  tick();
  const timer = setInterval(tick, intervalMs);

  const onVisible = () => { if (doc && !doc.hidden) tick(); };
  if (doc && typeof doc.addEventListener === 'function') {
    doc.addEventListener('visibilitychange', onVisible);
  }

  return function stop() {
    stopped = true;
    clearInterval(timer);
    if (doc && typeof doc.removeEventListener === 'function') {
      doc.removeEventListener('visibilitychange', onVisible);
    }
  };
}

// Visual identity shared across skins, so an agent's color/label is
// consistent whichever scene is showing it. Skins may add their own
// scene-specific visuals (a chair style, a window position) on top of
// this, but the color/label mapping itself lives in exactly one place.
export const AGENT_VISUALS = {
  nex: { color: '#4DD8E8', label: 'Nex' },
  chatgpt: { color: '#2E7FFF', label: 'ChatGPT' },
  claude: { color: '#A879FF', label: 'Claude' },
  gemini: { color: '#F2C94C', label: 'Gemini' },
  e2b: { color: '#4DE8A0', label: 'E2B' },
};

export function visualFor(agent) {
  return AGENT_VISUALS[agent?.id] || { color: '#8891A3', label: agent?.display_name || agent?.id || 'Agent' };
}

// Picks, for a given agent, the task they're most relevant to right
// now: their own in-progress task if they have one, otherwise their
// most recent task, otherwise null (nothing assigned). Shared so
// "what is this agent doing" means the same thing in every skin.
export function currentTaskFor(agent, tasks) {
  const owned = (tasks || []).filter((task) => task.owner === agent.id);
  return owned.find((task) => task.status !== 'complete') || owned[0] || null;
}
