const ROOM_BY_PATH = Object.freeze({
  '/': 'command-center',
  '/index.html': 'command-center',
  '/mission-control.html': 'command-center',
  '/conference-room.html': 'conference-room',
  '/room.html': 'room-builder',
  '/canvas.html': 'room-builder',
  '/nexus-canvas.html': 'room-builder',
  '/memory.html': 'memory-archive',
  '/queue.html': 'approval-queue',
  '/connectors.html': 'connector-bay',
  '/tenants.html': 'tenant-hub',
  '/story-studio.html': 'story-studio',
});

const ROOM_BY_SCENE = Object.freeze({
  command: 'command-center',
  conference: 'conference-room',
  builder: 'room-builder',
  story: 'story-studio',
  memory: 'memory-archive',
  queue: 'approval-queue',
  connectors: 'connector-bay',
  tenants: 'tenant-hub',
});

const PANEL_ID = 'nexPinnedVisualPanel';
const POLL_MS = 2800;

export function roomIdFromLocation(locationLike = {}) {
  const pathname = String(locationLike.pathname || '/').replace(/\/+$/u, '') || '/';
  if (pathname === '/nexus-space.html') {
    const scene = String(locationLike.hash || '').replace(/^#/u, '').trim().toLowerCase();
    return ROOM_BY_SCENE[scene] || 'command-center';
  }
  return ROOM_BY_PATH[pathname] || null;
}

export function buildSandboxedDocument(widgetCode) {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; media-src data:; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>html,body{margin:0;min-height:100%;background:#071016;color:#e8fbff;font-family:Inter,ui-sans-serif,system-ui,sans-serif}*{box-sizing:border-box}</style></head><body>${String(widgetCode || '')}</body></html>`;
}

function timeLabel(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved visual';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function ensureStylesheet() {
  if (document.querySelector('link[data-pinned-visual-styles]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/pinned-visual-panel.css?v=20260918-1';
  link.dataset.pinnedVisualStyles = 'true';
  document.head.appendChild(link);
}

export function mountPinnedVisualPanel() {
  if (typeof document === 'undefined' || document.getElementById(PANEL_ID)) return null;
  let roomId = roomIdFromLocation(window.location);
  if (!roomId) return null;
  ensureStylesheet();

  const panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.className = 'pinned-visual-panel is-empty';
  panel.setAttribute('aria-label', 'Nex pinned visual');
  panel.innerHTML = `
    <header class="pvp-header">
      <div class="pvp-title"><span class="pvp-signal"></span><span><b>NEX VISUAL</b><small>PINNED TO ROOM</small></span></div>
      <div class="pvp-actions">
        <button type="button" class="pvp-lock" aria-label="Lock pinned visual" title="Lock current visual">LOCK</button>
        <button type="button" class="pvp-minimize" aria-label="Minimize pinned visual" title="Minimize">−</button>
      </div>
    </header>
    <div class="pvp-body">
      <div class="pvp-empty"><b>Nothing pinned yet</b><span>Ask Nex to render a visual in this room.</span></div>
      <iframe class="pvp-frame" title="Nex rendered visual" sandbox="allow-scripts" referrerpolicy="no-referrer"></iframe>
      <footer class="pvp-footer">
        <span class="pvp-source">NEX</span>
        <details class="pvp-history"><summary>HISTORY <span>0</span></summary><div class="pvp-history-list"></div></details>
      </footer>
    </div>`;
  document.body.appendChild(panel);

  const frame = panel.querySelector('.pvp-frame');
  const lockButton = panel.querySelector('.pvp-lock');
  const minimizeButton = panel.querySelector('.pvp-minimize');
  const source = panel.querySelector('.pvp-source');
  const historyCount = panel.querySelector('.pvp-history summary span');
  const historyList = panel.querySelector('.pvp-history-list');
  let signature = '';
  let busy = false;

  function render(visual) {
    const nextSignature = JSON.stringify(visual || null);
    if (nextSignature === signature) return;
    signature = nextSignature;
    const hasVisual = Boolean(visual?.widget_code);
    panel.classList.toggle('is-empty', !hasVisual);
    panel.classList.toggle('is-locked', visual?.locked === true);
    lockButton.textContent = visual?.locked ? 'LOCKED' : 'LOCK';
    lockButton.setAttribute('aria-label', visual?.locked ? 'Unlock pinned visual' : 'Lock pinned visual');
    lockButton.title = visual?.locked ? 'Unlock current visual' : 'Lock current visual';
    source.textContent = String(visual?.source || 'NEX').toUpperCase().slice(0, 24);
    if (hasVisual) frame.srcdoc = buildSandboxedDocument(visual.widget_code);

    const history = Array.isArray(visual?.history) ? visual.history : [];
    historyCount.textContent = String(history.length);
    historyList.replaceChildren(...history.map((entry, index) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.historyId = entry.id;
      const label = document.createElement('span');
      label.textContent = index === 0 ? 'LATEST' : `VERSION ${index + 1}`;
      const when = document.createElement('small');
      when.textContent = timeLabel(entry.created_at);
      button.append(label, when);
      return button;
    }));
  }

  async function request(method = 'GET', body = null) {
    const url = method === 'GET' ? `/api/pinned-visuals?room_id=${encodeURIComponent(roomId)}` : '/api/pinned-visuals';
    const response = await fetch(url, {
      method,
      cache: 'no-store',
      credentials: 'same-origin',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    if (response.status === 401) {
      panel.hidden = true;
      return null;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Pinned visual request failed');
    panel.hidden = false;
    return data.visual;
  }

  async function refresh() {
    if (busy || document.hidden) return;
    busy = true;
    try { render(await request()); }
    catch (error) { console.warn('Pinned visual refresh failed:', error.message); }
    finally { busy = false; }
  }

  lockButton.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    lockButton.disabled = true;
    try {
      const locked = !panel.classList.contains('is-locked');
      render(await request('POST', { action: 'set_lock', room_id: roomId, locked }));
    } catch (error) { console.warn('Pinned visual lock failed:', error.message); }
    finally { busy = false; lockButton.disabled = false; }
  });

  minimizeButton.addEventListener('click', () => {
    const minimized = panel.classList.toggle('is-minimized');
    minimizeButton.textContent = minimized ? '+' : '−';
    minimizeButton.setAttribute('aria-label', minimized ? 'Expand pinned visual' : 'Minimize pinned visual');
  });

  historyList.addEventListener('click', async (event) => {
    const button = event.target.closest('button[data-history-id]');
    if (!button || busy) return;
    busy = true;
    try {
      render(await request('POST', { action: 'restore', room_id: roomId, history_id: button.dataset.historyId }));
      panel.querySelector('.pvp-history').open = false;
    } catch (error) { console.warn('Pinned visual restore failed:', error.message); }
    finally { busy = false; }
  });

  function followRoom() {
    const nextRoom = roomIdFromLocation(window.location);
    if (!nextRoom || nextRoom === roomId) return;
    roomId = nextRoom;
    signature = '';
    panel.classList.add('is-empty');
    refresh();
  }

  window.addEventListener('hashchange', followRoom);
  window.addEventListener('popstate', followRoom);
  window.addEventListener('nexus:room-changed', followRoom);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  refresh();
  window.setInterval(refresh, POLL_MS);
  return panel;
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountPinnedVisualPanel, { once: true });
  else mountPinnedVisualPanel();
}
