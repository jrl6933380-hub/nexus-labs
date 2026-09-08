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
      gap: 10px;
      box-sizing: border-box;
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
    .nexus-canvas-panel-title-group {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-width: 0;
      flex: 1;
    }
    .nexus-canvas-panel-title {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .nexus-canvas-panel-context { display: none; }
    .nexus-canvas-panel-toggle {
      display: grid;
      place-items: center;
      flex: 0 0 auto;
      width: 30px;
      height: 30px;
      padding: 0;
      border: 1px solid #3c5a84;
      border-radius: 8px;
      background: #0b1324cc;
      color: #a9eaff;
      box-shadow: inset 0 1px #b8d9ff18;
      cursor: pointer;
      font: 700 18px/1 'JetBrains Mono', monospace;
      touch-action: manipulation;
    }
    .nexus-canvas-panel-toggle:hover,
    .nexus-canvas-panel-toggle:focus-visible {
      border-color: #58d7ff;
      background: #14223a;
      outline: none;
    }
    .nexus-canvas-panel.is-collapsed {
      min-height: 0;
      height: auto !important;
    }
    .nexus-canvas-panel.is-collapsed .nexus-canvas-panel-header { border-bottom: 0; }
    .nexus-canvas-panel.is-collapsed .nexus-canvas-panel-context,
    .nexus-canvas-panel.is-collapsed .nexus-canvas-panel-body,
    .nexus-canvas-panel.is-collapsed .nexus-canvas-resize-handle { display: none; }
    .nexus-canvas-panel-body {
      flex: 1;
      min-height: 0;
      overflow: auto;
      position: relative;
      color: #e8eefb;
    }
    .nexus-canvas-resize-handle {
      position: absolute;
      z-index: 1;
      width: 16px;
      height: 16px;
      right: 0;
      bottom: 0;
      padding: 0;
      border: 0;
      background: transparent;
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
    .nexus-build-feedback {
      box-sizing: border-box;
      position: fixed;
      right: 18px;
      top: 18px;
      z-index: 4;
      display: flex;
      align-items: center;
      gap: 7px;
      width: auto;
      max-width: min(200px, calc(100vw - 36px));
      min-height: 32px;
      padding: 7px 10px;
      border: 1px solid #3c5a84;
      border-radius: 999px;
      background: #0a1020e8;
      box-shadow: 0 18px 50px #000a;
      backdrop-filter: blur(14px);
      font: 11px Inter, sans-serif;
      color: #dce9ff;
      pointer-events: none;
    }
    .nexus-build-feedback[hidden] { display: none; }
    .nexus-build-feedback-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: #f0c866; box-shadow: 0 0 10px #f0c866aa; }
    .nexus-build-feedback-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 700 9px 'JetBrains Mono', monospace; letter-spacing: .04em; color: #dce9ff; }
    .nexus-build-feedback.complete .nexus-build-feedback-dot { background: #78e6b0; box-shadow: 0 0 10px #78e6b0aa; }
    .nexus-build-feedback.failed .nexus-build-feedback-dot { background: #ff8293; box-shadow: 0 0 10px #ff8293aa; }
    @media (max-width: 720px) {
      .nexus-canvas-panel { border-radius: 12px; min-width: 0; }
      .nexus-canvas-panel-header { min-height: 48px; padding: 4px 8px 4px 14px; font-size: 11px; }
      .nexus-canvas-panel-context { display: inline; color: #91a0b9; font: 600 9px 'JetBrains Mono', monospace; letter-spacing: .08em; white-space: nowrap; }
      .nexus-canvas-panel-toggle { width: 40px; height: 40px; border-radius: 10px; }
      .nexus-canvas-resize-handle { display: block; width: 44px; height: 44px; }
      .nexus-canvas-resize-handle::after { right: 9px; bottom: 9px; width: 10px; height: 10px; border-color: #58d7ffcc; }
      .nexus-build-feedback { top: auto; right: 10px; bottom: 76px; max-width: min(190px, calc(100vw - 20px)); }
    }
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
  let feedbackHud = root.querySelector('.nexus-build-feedback');
  let feedbackHideTimer = null;
  if (!feedbackHud) {
    feedbackHud = document.createElement('aside');
    feedbackHud.className = 'nexus-build-feedback';
    feedbackHud.setAttribute('aria-live', 'polite');
    feedbackHud.setAttribute('aria-label', 'Live build feedback');
    root.appendChild(feedbackHud);
  }
  const renderFeedback = (item = null) => {
    feedbackHud.replaceChildren();
    feedbackHud.classList.remove('running', 'complete', 'failed');
    if (!item) {
      feedbackHud.hidden = true;
      return;
    }
    feedbackHud.hidden = false;
    feedbackHud.classList.add(item.state || 'running');
    const dot = document.createElement('span');
    dot.className = 'nexus-build-feedback-dot';
    const label = document.createElement('span');
    label.className = 'nexus-build-feedback-label';
    label.textContent = `NEX · ${item.label}`;
    feedbackHud.append(dot, label);
  };
  window.addEventListener('nexus:build-feedback', (event) => {
    const item = event.detail;
    if (!item?.label) return;
    clearTimeout(feedbackHideTimer);
    renderFeedback(item);
    if (item.state && item.state !== 'running') {
      feedbackHideTimer = setTimeout(() => renderFeedback(), 3000);
    }
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

  const panels = new Map(); // id -> { el, dragging, resizing, title, remoteRect, mobileRect }
  let topPanelZ = 2;

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
    // The canvas itself owns the entire visual viewport. Floating UI such
    // as the Nex dock can overlap momentarily, but must never create an
    // invisible floor that prevents a panel from using the screen below it.
    return viewport();
  }

  function displayRect(rect, el) {
    if (!isMobileViewport()) return rect;
    const view = interactionViewport();
    const w = Math.min(Math.max(200, Number(rect.w) || 360), Math.max(200, view.width - 32));
    const h = Math.min(Math.max(120, Number(rect.h) || 280), Math.max(120, Math.floor(view.height * 0.78)));
    const collapsedHeight = el?.classList.contains('is-collapsed')
      ? Math.max(40, el.querySelector('.nexus-canvas-panel-header')?.getBoundingClientRect().height || 40)
      : h;
    const position = clampPosition({ x: Number(rect.x) || 8, y: Number(rect.y) || 8, w, h: collapsedHeight }, view);
    return { ...position, w, h };
  }

  function applyRect(el, rect) {
    const displayed = displayRect(rect, el);
    el.style.left = `${displayed.x}px`;
    el.style.top = `${displayed.y}px`;
    el.style.width = `${displayed.w}px`;
    el.style.height = `${displayed.h}px`;
  }

  function refreshPanels() {
    const mobile = isMobileViewport();
    for (const entry of panels.values()) {
      if (mobile) {
        applyRect(entry.el, entry.mobileRect || entry.remoteRect);
      } else {
        applyRect(entry.el, entry.remoteRect);
      }
      entry.el.hidden = false;
    }
  }

  function currentPanelRect(el) {
    const rect = el.getBoundingClientRect();
    return { x: rect.left, y: rect.top, w: rect.width, h: rect.height };
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
    const titleGroup = document.createElement('div');
    titleGroup.className = 'nexus-canvas-panel-title-group';
    const titleLabel = document.createElement('span');
    titleLabel.className = 'nexus-canvas-panel-title';
    titleLabel.textContent = title;
    const contextLabel = document.createElement('span');
    contextLabel.className = 'nexus-canvas-panel-context';
    contextLabel.textContent = 'Phone workspace';
    titleGroup.append(titleLabel, contextLabel);
    header.appendChild(titleGroup);
    el.appendChild(header);

    const body = document.createElement('div');
    body.className = 'nexus-canvas-panel-body';
    body.id = `nexus-panel-body-${canvasId}-${id}`.replace(/[^a-zA-Z0-9_-]/g, '-');
    if (content instanceof Node) body.appendChild(content);
    el.appendChild(body);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'nexus-canvas-panel-toggle';
    toggle.setAttribute('aria-controls', body.id);
    const toggleIcon = document.createElement('span');
    toggleIcon.setAttribute('aria-hidden', 'true');
    toggle.appendChild(toggleIcon);
    header.appendChild(toggle);

    const handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'nexus-canvas-resize-handle';
    handle.setAttribute('aria-label', `Resize ${title}`);
    el.appendChild(handle);

    root.appendChild(el);
    let mobileRect = null;
    let collapsed = false;
    try {
      mobileRect = JSON.parse(localStorage.getItem(`nexus-mobile-panel:${canvasId}:${id}`));
      collapsed = localStorage.getItem(`nexus-panel-collapsed:${canvasId}:${id}`) === '1';
    } catch {
      // Safe clamping still works when storage is unavailable.
    }
    const entry = { el, dragging: false, resizing: false, collapsed, title, remoteRect: { x, y, w, h }, mobileRect };
    panels.set(id, entry);
    el.classList.toggle('is-collapsed', collapsed);

    function updateToggle() {
      toggleIcon.textContent = entry.collapsed ? '+' : '\u2212';
      toggle.setAttribute('aria-expanded', String(!entry.collapsed));
      toggle.setAttribute('aria-label', `${entry.collapsed ? 'Restore' : 'Minimize'} ${title}`);
      toggle.title = `${entry.collapsed ? 'Restore' : 'Minimize'} ${title}`;
    }

    function expandedRect() {
      return isMobileViewport() ? (entry.mobileRect || entry.remoteRect) : entry.remoteRect;
    }

    updateToggle();
    el.addEventListener('pointerdown', () => {
      topPanelZ += 1;
      el.style.zIndex = String(topPanelZ);
    });
    refreshPanels();

    function currentRect() {
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    }

    function persist(rect) {
      postCanvasAction('set_canvas_panel_layout', { canvas_id: canvasId, id, x: rect.x, y: rect.y, w: rect.w, h: rect.h });
    }

    function saveFinishedRect(visibleRect) {
      const rect = entry.collapsed
        ? { ...expandedRect(), x: visibleRect.x, y: visibleRect.y, w: visibleRect.w }
        : visibleRect;
      if (isMobileViewport()) {
        entry.mobileRect = rect;
        try { localStorage.setItem(`nexus-mobile-panel:${canvasId}:${id}`, JSON.stringify(rect)); } catch {}
      } else {
        entry.remoteRect = rect;
        persist(rect);
      }
    }

    toggle.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
    });
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (!entry.collapsed) saveFinishedRect(currentRect());
      entry.collapsed = !entry.collapsed;
      el.classList.toggle('is-collapsed', entry.collapsed);
      updateToggle();
      try {
        if (entry.collapsed) localStorage.setItem(`nexus-panel-collapsed:${canvasId}:${id}`, '1');
        else localStorage.removeItem(`nexus-panel-collapsed:${canvasId}:${id}`);
      } catch {}
      applyRect(el, expandedRect());
    });

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
      saveFinishedRect(currentRect());
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
      saveFinishedRect(currentRect());
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

  window.addEventListener('resize', refreshPanels);
  window.visualViewport?.addEventListener('resize', refreshPanels);

  return { root, canvasId, addPanel, setBackdropUrl, destroy };
}
