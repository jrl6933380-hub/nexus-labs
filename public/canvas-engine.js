// /public/canvas-engine.js
// The single persistent Nexus canvas. One full-viewport backdrop,
// panels that live on top of it as draggable/resizable objects.
// Position/size and the backdrop are shared, live state (see
// lib/canvasState.js) — a change made in one browser shows up in any
// other one open on the canvas within one poll interval, no reload
// needed. This deliberately does NOT touch DOM at import time (unlike
// nex-chat-bar.js's auto-init) so canvas-geometry.js's pure functions
// stay importable under Node for tests without this file dragging a
// `document` reference in with it.

import { clampPosition, finalizeResize } from './canvas-geometry.js';

const POLL_INTERVAL_MS = 4000;

function injectStyles() {
  if (document.getElementById('nexus-canvas-styles')) return;
  const style = document.createElement('style');
  style.id = 'nexus-canvas-styles';
  style.textContent = `
    #nexus-canvas-root {
      position: fixed;
      inset: 0;
      overflow: hidden;
      background: #05070c;
    }
    #nexus-canvas-backdrop {
      position: absolute;
      inset: 0;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      transition: background-image 400ms ease;
      z-index: 0;
    }
    .nexus-canvas-panel {
      position: absolute;
      display: flex;
      flex-direction: column;
      background: rgba(10, 14, 20, 0.92);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 10px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
      overflow: hidden;
      min-width: 200px;
      min-height: 120px;
    }
    .nexus-canvas-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 8px 12px;
      background: rgba(255, 255, 255, 0.04);
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
      cursor: grab;
      touch-action: none;
      user-select: none;
      font: 600 12px/1.2 -apple-system, sans-serif;
      color: #cfd6e4;
      flex-shrink: 0;
    }
    .nexus-canvas-panel-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      position: relative;
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
      border-right: 2px solid rgba(255, 255, 255, 0.25);
      border-bottom: 2px solid rgba(255, 255, 255, 0.25);
    }
  `;
  document.head.appendChild(style);
}

async function fetchCanvasState() {
  try {
    const res = await fetch('/api/board', { headers: { Accept: 'application/json' }, cache: 'no-store' });
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

export function mountCanvas() {
  injectStyles();

  let root = document.getElementById('nexus-canvas-root');
  if (!root) {
    root = document.createElement('div');
    root.id = 'nexus-canvas-root';
    document.body.appendChild(root);
  }

  let backdrop = document.getElementById('nexus-canvas-backdrop');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.id = 'nexus-canvas-backdrop';
    root.appendChild(backdrop);
  }

  const panels = new Map(); // id -> { el, dragging, resizing }

  function applyBackdrop(url) {
    backdrop.style.backgroundImage = url ? `url("${url}")` : 'none';
  }

  function viewport() {
    return { width: window.innerWidth, height: window.innerHeight };
  }

  function applyRect(el, rect) {
    el.style.left = `${rect.x}px`;
    el.style.top = `${rect.y}px`;
    el.style.width = `${rect.w}px`;
    el.style.height = `${rect.h}px`;
  }

  // Called on every poll for panels the current tab isn't actively
  // dragging/resizing right now — this is how one browser's edit shows
  // up live in another without either fighting the user's own in-
  // progress gesture.
  function syncPanelFromRemote(id, remoteRect) {
    const entry = panels.get(id);
    if (!entry || entry.dragging || entry.resizing) return;
    applyRect(entry.el, remoteRect);
  }

  async function poll() {
    const state = await fetchCanvasState();
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
    const entry = { el, dragging: false, resizing: false };
    panels.set(id, entry);

    function currentRect() {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    function persist(rect) {
      postCanvasAction('set_canvas_panel_layout', { id, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }

    // Drag — same pointer-capture pattern as the existing Nex chat
    // dock (public/nex-chat-bar.js), generalized to persist to the
    // shared canvas store on release instead of localStorage.
    let drag = null;
    header.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
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
      const next = clampPosition({ x: drag.rect.x + dx, y: drag.rect.y + dy, w: drag.rect.w, h: drag.rect.h }, viewport());
      el.style.left = `${next.x}px`;
      el.style.top = `${next.y}px`;
    });
    function endDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
      header.style.cursor = 'grab';
      entry.dragging = false;
      persist(currentRect());
      drag = null;
    }
    header.addEventListener('pointerup', endDrag);
    header.addEventListener('pointercancel', endDrag);

    // Resize — bottom-right handle only for v1; finalizeResize already
    // supports all 8 compass points if more handles get added later.
    let resize = null;
    handle.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
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
      persist(currentRect());
      resize = null;
    }
    handle.addEventListener('pointerup', endResize);
    handle.addEventListener('pointercancel', endResize);

    return { el, body };
  }

  function setBackdropUrl(url) {
    applyBackdrop(url);
    return postCanvasAction('set_canvas_backdrop', { url });
  }

  function destroy() {
    clearInterval(pollTimer);
  }

  return { root, addPanel, setBackdropUrl, destroy };
}
