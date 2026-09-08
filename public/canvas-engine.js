// /public/canvas-engine.js
// The single persistent Nexus canvas — now generalized to MANY
// canvases, each addressable by id (defaults to 'dashboard', the
// original homepage canvas, so existing callers that don't pass an
// id keep working unchanged). One full-viewport backdrop, panels
// that live on top of it as draggable/resizable objects. Position/
// size and the backdrop are shared, live state per canvas (see
// lib/canvasState.js) — a change made in one browser shows up in any
// other one open on the SAME canvas within one poll interval, no
// reload needed. This deliberately does NOT touch DOM at import time
// (unlike nex-chat-bar.js's auto-init) so canvas-geometry.js's pure
// functions stay importable under Node for tests without this file
// dragging a `document` reference in with it.
//
// Visual theme matches nexus-space.css exactly (same color tokens,
// grid+vignette atmosphere, JetBrains Mono panel headers) so a page
// using this engine looks like the rest of Nexus by default, not a
// generic dark-glass placeholder — a custom backdrop image (set via
// setBackdropUrl) layers on top of this same atmosphere rather than
// replacing it outright.

import { clampPosition, finalizeResize } from './canvas-geometry.js';

const POLL_INTERVAL_MS = 4000;
const DEFAULT_CANVAS_ID = 'dashboard';
const MOBILE_BREAKPOINT_PX = 720;

function injectStyles() {
  if (document.getElementById('nexus-canvas-styles')) return;
  const style = document.createElement('style');
  style.id = 'nexus-canvas-styles';
  style.textContent = `
    #nexus-canvas-root {
      position: fixed;
      inset: 0;
      overflow: hidden;
      background: radial-gradient(ellipse 70% 52% at 50% 0, #245bb433, transparent 72%),
                  linear-gradient(180deg, #111b2d 0, #080c15 55%, #05070c 100%);
      font-family: Inter, -apple-system, sans-serif;
    }
    #nexus-canvas-atmosphere-grid {
      position: absolute;
      inset: 0;
      z-index: 0;
      opacity: 0.32;
      pointer-events: none;
      background-image: linear-gradient(#5680bc10 1px, transparent 1px),
                         linear-gradient(90deg, #5680bc10 1px, transparent 1px);
      background-size: 42px 42px;
    }
    #nexus-canvas-atmosphere-vignette {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background: radial-gradient(ellipse at center, transparent 42%, #020409ca 100%);
    }
    #nexus-canvas-backdrop {
      position: absolute;
      inset: 0;
      z-index: 1;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      transition: background-image 400ms ease;
    }
    .nexus-canvas-panel {
      position: absolute;
      z-index: 2;
      display: flex;
      flex-direction: column;
      background: #111827cc;
      border: 1px solid #3c5a84;
      border-radius: 14px;
      box-shadow: 0 30px 90px #000b, inset 0 1px #b8d9ff2e;
      backdrop-filter: blur(14px);
      overflow: hidden;
      min-width: 200px;
      min-height: 120px;
    }
    .nexus-canvas-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      background: linear-gradient(90deg, #4b8dff14, transparent);
      border-bottom: 1px solid #26334d;
      cursor: grab;
      touch-action: none;
      user-select: none;
      font: 700 10px 'JetBrains Mono', monospace;
      letter-spacing: 0.14em;
      text-transform: uppercase;
      color: #58d7ff;
      flex-shrink: 0;
    }
    .nexus-canvas-panel-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      position: relative;
      color: #e8eefb;
    }
    .nexus-canvas-resize-handle {
      position: absolute;
      width: 16px;
      height: 16px;
      right: 0;
      bottom: 0;
      cursor: se-resize;
      touch-action: none;
    }
    .nexus-canvas-resize-handle::after {
      content: '';
      position: absolute;
      right: 4px;
      bottom: 4px;
      width: 8px;
      height: 8px;
      border-right: 2px solid #58d7ff77;
      border-bottom: 2px solid #58d7ff77;
    }
    .nexus-canvas-mobile-panels {
      display: none;
      position: fixed;
      left: max(12px, env(safe-area-inset-left));
      bottom: max(76px, calc(env(safe-area-inset-bottom) + 62px));
      z-index: 5;
      max-width: calc(100vw - 24px);
      gap: 7px;
      padding: 7px;
      overflow-x: auto;
      border: 1px solid #3c5a84;
      border-radius: 12px;
      background: #0a1020e8;
      box-shadow: 0 12px 34px #0009;
      backdrop-filter: blur(14px);
      -webkit-overflow-scrolling: touch;
    }
    /* The mobile media rule enables this dock, but one-panel rooms mark
       it hidden. Keep that state authoritative so an empty blue strip
       can never cover the workspace. */
    .nexus-canvas-mobile-panels[hidden] { display: none !important; }
    .nexus-canvas-mobile-panel-button {
      flex: 0 0 auto;
      min-height: 36px;
      border: 1px solid #314665;
      border-radius: 8px;
      padding: 7px 10px;
      color: #9bb3d5;
      background: #121b2de6;
      font: 700 10px 'JetBrains Mono', monospace;
      letter-spacing: .06em;
      text-transform: uppercase;
    }
    .nexus-canvas-mobile-panel-button.active { color: #07101a; border-color: #58d7ff; background: #58d7ff; }
    @media (max-width: 720px) {
      .nexus-canvas-panel { border-radius: 12px; min-width: 0; }
      .nexus-canvas-panel-header { min-height: 44px; padding: 12px 14px; font-size: 11px; }
      .nexus-canvas-panel-header::after { content: 'PHONE WORKSPACE'; color: #91a0b9; font: 600 9px 'JetBrains Mono', monospace; letter-spacing: .08em; }
      .nexus-canvas-resize-handle { display: none; }
      .nexus-canvas-mobile-panels { display: flex; }
      .nexus-build-feedback { top: auto; right: 10px; bottom: 128px; width: min(240px, calc(100vw - 20px)); }
    }
    .nexus-build-feedback {
      position: fixed;
      right: 18px;
      top: 18px;
      z-index: 4;
      width: min(240px, calc(100vw - 36px));
      padding: 8px 10px;
      border: 1px solid #3c5a84;
      border-radius: 12px;
      background: #0a1020e8;
      box-shadow: 0 18px 50px #000a;
      backdrop-filter: blur(14px);
      font: 11px Inter, sans-serif;
      color: #dce9ff;
      pointer-events: none;
    }
    .nexus-build-feedback-title { color: #58d7ff; font: 700 9px 'JetBrains Mono', monospace; letter-spacing: .13em; margin-bottom: 6px; }
    .nexus-build-feedback-row { padding: 2px 0; font-size: 10px; }
    .nexus-build-feedback-row.running { color: #f0c866; }
    .nexus-build-feedback-row.complete { color: #78e6b0; }
    .nexus-build-feedback-row.failed { color: #ff8293; }
  `;
  document.head.appendChild(style);
}

async function fetchCanvasState(canvasId) {
  try {
    const res = await fetch(`/api/board?canvas_id=${encodeURIComponent(canvasId)}`, { headers: { Accept: 'application/json' }, cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data?.canvas || null;
  } catch {
    return null;
  }
}

function postCanvasAction(action, params) {
  return fetch('/api/board', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...params }),
  }).catch(() => {
    // A failed live-sync write never blocks local interaction — the
    // panel already moved/resized on screen; it just won't have
    // persisted for other viewers or across reload this time.
  });
}

export function mountCanvas({ canvasId = DEFAULT_CANVAS_ID } = {}) {
  injectStyles();

  // Root/backdrop/atmosphere elements are per-page (one canvas visible
  // at a time in one browser tab), so they're safe to reuse by fixed
  // id even though the DATA behind them (fetched/posted below) is now
  // scoped by canvasId — two different pages each calling mountCanvas
  // with different ids never collide because each runs in its own tab.
  let root = document.getElementById('nexus-canvas-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'nexus-canvas-root';
    document.body.appendChild(root);
  }
  root.dataset.canvasId = canvasId;
  const mobilePanelDock = document.createElement('nav');
  mobilePanelDock.className = 'nexus-canvas-mobile-panels';
  mobilePanelDock.setAttribute('aria-label', 'Canvas panels');
  root.appendChild(mobilePanelDock);
  let feedbackHud = root.querySelector('.nexus-build-feedback');
  const feedbackItems = [];
  if (!feedbackHud) {
    feedbackHud = document.createElement('aside');
    feedbackHud.className = 'nexus-build-feedback';
    feedbackHud.setAttribute('aria-live', 'polite');
    feedbackHud.setAttribute('aria-label', 'Live build feedback');
    root.appendChild(feedbackHud);
  }
  const renderFeedback = () => {
    feedbackHud.replaceChildren();
    const title = document.createElement('div');
    title.className = 'nexus-build-feedback-title';
    title.textContent = 'LIVE BUILD';
    feedbackHud.appendChild(title);
    feedbackItems.slice(-6).forEach((item) => {
      const row = document.createElement('div');
      row.className = `nexus-build-feedback-row ${item.state}`;
      row.textContent = `${item.state === 'running' ? '◌' : item.state === 'failed' ? '×' : '✓'} ${item.label}`;
      feedbackHud.appendChild(row);
    });
  };
  window.addEventListener('nexus:build-feedback', (event) => {
    const item = event.detail;
    if (!item?.label) return;
    const open = feedbackItems.find((existing) => existing.tool === item.tool && existing.state === 'running');
    if (open && item.state !== 'running') Object.assign(open, item);
    else feedbackItems.push(item);
    renderFeedback();
  });
  renderFeedback();

  // Atmosphere layers (grid + vignette) sit behind the backdrop image
  // so the on-brand look shows through when no custom backdrop is
  // set, and stays visible at the edges even when one is.
  if (!document.getElementById('nexus-canvas-atmosphere-grid')) {
    const grid = document.createElement('div');
    grid.id = 'nexus-canvas-atmosphere-grid';
    root.appendChild(grid);
  }
  if (!document.getElementById('nexus-canvas-atmosphere-vignette')) {
    const vignette = document.createElement('div');
    vignette.id = 'nexus-canvas-atmosphere-vignette';
    root.appendChild(vignette);
  }

  let backdrop = document.getElementById('nexus-canvas-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'nexus-canvas-backdrop';
    root.appendChild(backdrop);
  }

  const panels = new Map(); // id -> { el, dragging, resizing, title, mobileButton }
  let activeMobilePanelId = null;

  function applyBackdrop(url) {
    backdrop.style.backgroundImage = url ? `url("${url}")` : 'none';
  }

  function viewport() {
    const visual = window.visualViewport;
    return { width: visual?.width || window.innerWidth, height: visual?.height || window.innerHeight };
  }

  function isMobileViewport() {
    return viewport().width <= MOBILE_BREAKPOINT_PX;
  }

  function interactionViewport() {
    const view = viewport();
    if (!isMobileViewport()) return view;
    const bottomInset = panels.size >= 2 ? 140 : 76;
    return { width: view.width, height: Math.max(160, view.height - bottomInset) };
  }

  function displayRect(rect) {
    if (!isMobileViewport()) return rect;
    const view = interactionViewport();
    const w = Math.min(Math.max(200, Number(rect.w) || 360), Math.max(200, view.width - 16));
    const h = Math.min(Math.max(120, Number(rect.h) || 280), Math.max(120, view.height - 16));
    const position = clampPosition({ x: Number(rect.x) || 8, y: Number(rect.y) || 8, w, h }, view);
    return { ...position, w, h };
  }

  function applyRect(el, rect) {
    const displayed = displayRect(rect);
    el.style.left = `${displayed.x}px`;
    el.style.top = `${displayed.y}px`;
    el.style.width = `${displayed.w}px`;
    el.style.height = `${displayed.h}px`;
  }

  function refreshMobilePanels() {
    const mobile = isMobileViewport();
    mobilePanelDock.hidden = !mobile || panels.size < 2;
    for (const [id, entry] of panels) {
      if (mobile) {
        applyRect(entry.el, entry.mobileRect || entry.remoteRect);
        entry.el.hidden = id !== activeMobilePanelId;
      } else {
        applyRect(entry.el, entry.remoteRect);
        entry.el.hidden = false;
      }
      entry.mobileButton?.classList.toggle('active', id === activeMobilePanelId);
    }
  }

  function currentPanelRect(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
  }

  function activateMobilePanel(id) {
    activeMobilePanelId = id;
    refreshMobilePanels();
  }

  // Called on every poll for panels the current tab isn't actively
  // dragging/resizing right now — this is how one browser's edit shows
  // up live in another without either fighting the user's own in-
  // progress gesture.
  function syncPanelFromRemote(id, remoteRect) {
    const entry = panels.get(id);
    if (!entry || entry.dragging || entry.resizing) return;
    entry.remoteRect = remoteRect;
    applyRect(entry.el, isMobileViewport() && entry.mobileRect ? entry.mobileRect : remoteRect);
  }

  async function poll() {
    const state = await fetchCanvasState(canvasId);
    if (!state) return;
    applyBackdrop(state.backdrop_url);
    for (const [id, rect] of Object.entries(state.panels || {})) {
      syncPanelFromRemote(id, rect);
    }
  }

  poll();
  const pollTimer = setInterval(poll, POLL_INTERVAL_MS);

  function addPanel({ id, title, content, x = 80, y = 80, w = 360, h = 280 }) {
    const el = document.createElement('div');
    el.className = 'nexus-canvas-panel';
    el.dataset.panelId = id;
    applyRect(el, { x, y, w, h });

    const header = document.createElement('div');
    header.className = 'nexus-canvas-panel-header';
    header.innerHTML = `<span>${title}</span>`;
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'nexus-canvas-panel-body';
    if (content instanceof Node) body.appendChild(content);
    el.appendChild(body);

    const handle = document.createElement('div');
    handle.className = 'nexus-canvas-resize-handle';
    el.appendChild(handle);

    root.appendChild(el);
    let mobileRect = null;
    try {
      mobileRect = JSON.parse(localStorage.getItem(`nexus-mobile-panel:${canvasId}:${id}`));
    } catch {
      // Safe clamping still works when storage is unavailable.
    }
    const entry = { el, dragging: false, resizing: false, title, remoteRect: { x, y, w, h }, mobileRect };
    panels.set(id, entry);
    if (!activeMobilePanelId) activeMobilePanelId = id;
    const mobileButton = document.createElement('button');
    mobileButton.type = 'button';
    mobileButton.className = 'nexus-canvas-mobile-panel-button';
    mobileButton.textContent = title;
    mobileButton.addEventListener('click', () => activateMobilePanel(id));
    mobilePanelDock.appendChild(mobileButton);
    entry.mobileButton = mobileButton;
    refreshMobilePanels();

    function currentRect() {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    function persist(rect) {
      postCanvasAction('set_canvas_panel_layout', { canvas_id: canvasId, id, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }

    // Drag — same pointer-capture pattern as the existing Nex chat
    // dock (public/nex-chat-bar.js), generalized to persist to the
    // shared canvas store on release instead of localStorage.
    let drag = null;
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = currentRect();
      drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect };
      entry.dragging = true;
      header.setPointerCapture(event.pointerId);
      header.style.cursor = 'grabbing';
    });
    header.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      const next = clampPosition({ x: drag.rect.x + dx, y: drag.rect.y + dy, w: drag.rect.w, h: drag.rect.h }, interactionViewport());
      el.style.left = `${next.x}px`;
      el.style.top = `${next.y}px`;
    });
    function endDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
      header.style.cursor = 'grab';
      entry.dragging = false;
      const persisted = currentRect();
      if (isMobileViewport()) {
        entry.mobileRect = persisted;
        try { localStorage.setItem(`nexus-mobile-panel:${canvasId}:${id}`, JSON.stringify(persisted)); } catch {}
      } else {
        entry.remoteRect = persisted;
        persist(persisted);
      }
      drag = null;
    }
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    // Resize — bottom-right handle only for v1; finalizeResize already
    // supports all 8 compass points if more handles get added later.
    let resize = null;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      resize = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, rect: currentRect() };
      entry.resizing = true;
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', (event) => {
      if (!resize || event.pointerId !== resize.pointerId) return;
      const dx = event.clientX - resize.startX;
      const dy = event.clientY - resize.startY;
      const next = finalizeResize({ startRect: resize.rect, dx, dy, handle: 'se' }, viewport());
      applyRect(el, next);
    });
    function endResize(event) {
      if (!resize || event.pointerId !== resize.pointerId) return;
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      entry.resizing = false;
      const persisted = currentRect();
      entry.remoteRect = persisted;
      persist(persisted);
      resize = null;
    }
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);

    return { el, body };
  }

  function setBackdropUrl(url) {
    applyBackdrop(url);
    return postCanvasAction('set_canvas_backdrop', { canvas_id: canvasId, url });
  }

  function destroy() {
    clearInterval(pollTimer);
  }

  window.addEventListener('resize', refreshMobilePanels);
  window.visualViewport?.addEventListener('resize', refreshMobilePanels);

  return { root, canvasId, addPanel, setBackdropUrl, destroy };
}
