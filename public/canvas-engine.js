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
    root.innerHTML = `
      <div id="nexus-canvas-atmosphere-grid"></div>
      <div id="nexus-canvas-atmosphere-vignette"></div>
      <div id="nexus-canvas-backdrop"></div>
      <div id="nexus-canvas-panels"></div>
      <div id="nexus-canvas-mobile-panels" class="nexus-canvas-mobile-panels" hidden></div>
      <div id="nexus-build-feedback" class="nexus-build-feedback" style="opacity: 0; transition: opacity 300ms ease;"></div>
    `;
    document.body.insertBefore(root, document.body.firstChild);
  }

  // Panel and backdrop management — these are keyed by canvasId so
  // two canvases (e.g., two tabs on different pages) stay independent
  // even though they share the same root/atmosphere/feedback elements.
  const panels = new Map();
  const state = { canvasId, backdrop: '', feedback: null };

  async function poll() {
    const canvasState = await fetchCanvasState(canvasId);
    if (!canvasState) return;

    // Backdrop — apply new backdrop image if it changed.
    if (canvasState.backdrop && canvasState.backdrop !== state.backdrop) {
      state.backdrop = canvasState.backdrop;
      const backdropEl = document.getElementById('nexus-canvas-backdrop');
      if (canvasState.backdrop.startsWith('http')) {
        backdropEl.style.backgroundImage = `url('${canvasState.backdrop}')`;
      } else {
        backdropEl.style.backgroundImage = 'none';
      }
    }

    // Feedback box — activity/building/running status.
    const feedbackEl = document.getElementById('nexus-build-feedback');
    if (canvasState.feedback && JSON.stringify(canvasState.feedback) !== JSON.stringify(state.feedback)) {
      state.feedback = canvasState.feedback;
      if (canvasState.feedback.rows && canvasState.feedback.rows.length) {
        feedbackEl.innerHTML = `
          <div class="nexus-build-feedback-title">${canvasState.feedback.title || 'ACTIVITY'}</div>
          ${canvasState.feedback.rows.map(r => `<div class="nexus-build-feedback-row ${r.status || ''}">${r.text}</div>`).join('')}
        `;
        feedbackEl.style.opacity = '1';
      } else {
        feedbackEl.style.opacity = '0';
      }
    }

    // Panels — add, update, remove based on canvas state.
    const incomingIds = new Set(canvasState.panels?.map(p => p.id) || []);
    const currentIds = new Set(panels.keys());

    // Remove panels no longer in state
    for (const id of currentIds) {
      if (!incomingIds.has(id)) {
        panels.get(id).remove();
        panels.delete(id);
      }
    }

    // Add or update panels
    for (const panelDef of canvasState.panels || []) {
      if (panels.has(panelDef.id)) {
        // Update existing panel position/size
        const panel = panels.get(panelDef.id);
        panel.style.left = panelDef.x + 'px';
        panel.style.top = panelDef.y + 'px';
        panel.style.width = panelDef.w + 'px';
        panel.style.height = panelDef.h + 'px';
      } else {
        // Create new panel
        const panel = document.createElement('div');
        panel.className = 'nexus-canvas-panel';
        panel.style.left = panelDef.x + 'px';
        panel.style.top = panelDef.y + 'px';
        panel.style.width = panelDef.w + 'px';
        panel.style.height = panelDef.h + 'px';
        panel.innerHTML = `
          <div class="nexus-canvas-panel-header">${panelDef.title || 'PANEL'}</div>
          <div class="nexus-canvas-panel-body"></div>
          <div class="nexus-canvas-resize-handle"></div>
        `;
        const panelsContainer = document.getElementById('nexus-canvas-panels');
        panelsContainer.appendChild(panel);
        panels.set(panelDef.id, panel);

        // Make draggable and resizable
        const header = panel.querySelector('.nexus-canvas-panel-header');
        const body = panel.querySelector('.nexus-canvas-panel-body');
        const handle = panel.querySelector('.nexus-canvas-resize-handle');

        if (panelDef.content) {
          body.appendChild(panelDef.content);
        }

        let isDragging = false;
        let dragOffsetX = 0;
        let dragOffsetY = 0;

        header.addEventListener('mousedown', (e) => {
          isDragging = true;
          dragOffsetX = e.clientX - panel.offsetLeft;
          dragOffsetY = e.clientY - panel.offsetTop;
        });

        document.addEventListener('mousemove', (e) => {
          if (isDragging) {
            let newX = e.clientX - dragOffsetX;
            let newY = e.clientY - dragOffsetY;
            [newX, newY] = clampPosition(newX, newY, panel.offsetWidth, panel.offsetHeight);
            panel.style.left = newX + 'px';
            panel.style.top = newY + 'px';
            postCanvasAction('movePanel', { canvasId, panelId: panelDef.id, x: newX, y: newY });
          }
        });

        document.addEventListener('mouseup', () => {
          isDragging = false;
        });

        // Resize handling
        if (handle) {
          let isResizing = false;
          let resizeStartX = 0;
          let resizeStartY = 0;
          let resizeStartW = 0;
          let resizeStartH = 0;

          handle.addEventListener('mousedown', (e) => {
            isResizing = true;
            resizeStartX = e.clientX;
            resizeStartY = e.clientY;
            resizeStartW = panel.offsetWidth;
            resizeStartH = panel.offsetHeight;
          });

          document.addEventListener('mousemove', (e) => {
            if (isResizing) {
              let deltaX = e.clientX - resizeStartX;
              let deltaY = e.clientY - resizeStartY;
              let newW = Math.max(200, resizeStartW + deltaX);
              let newH = Math.max(120, resizeStartH + deltaY);
              [newW, newH] = finalizeResize(newW, newH);
              panel.style.width = newW + 'px';
              panel.style.height = newH + 'px';
              postCanvasAction('resizePanel', { canvasId, panelId: panelDef.id, w: newW, h: newH });
            }
          });

          document.addEventListener('mouseup', () => {
            isResizing = false;
          });
        }
      }
    }

    // Mobile panels dock — tab to switch between panels on small screens
    const mobileDocsEl = document.getElementById('nexus-canvas-mobile-panels');
    const showMobileDock = (canvasState.panels || []).length > 1;
    if (showMobileDock && window.innerWidth <= MOBILE_BREAKPOINT_PX) {
      mobileDocsEl.innerHTML = (canvasState.panels || []).map(p => `
        <button class="nexus-canvas-mobile-panel-button" data-panel-id="${p.id}">${p.title || 'Panel'}</button>
      `).join('');
      mobileDocsEl.removeAttribute('hidden');

      mobileDocsEl.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', (e) => {
          const panelId = e.currentTarget.dataset.panelId;
          const panel = panels.get(panelId);
          if (panel) {
            mobileDocsEl.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            e.currentTarget.classList.add('active');
            panels.forEach(p => p.style.display = 'none');
            panel.style.display = 'flex';
          }
        });
      });

      // Show the first panel by default
      const firstBtn = mobileDocsEl.querySelector('button');
      if (firstBtn) {
        firstBtn.click();
      }
    } else {
      mobileDocsEl.setAttribute('hidden', '');
      panels.forEach(p => p.style.display = 'flex');
    }
  }

  // Kick off polling and return the canvas API
  let pollInterval = setInterval(poll, POLL_INTERVAL_MS);
  poll();

  return {
    addPanel(def) {
      const content = def.content || document.createElement('div');
      postCanvasAction('addPanel', {
        canvasId,
        panelId: def.id,
        title: def.title || 'Panel',
        x: def.x || 0,
        y: def.y || 0,
        w: def.w || 300,
        h: def.h || 200,
      });
      // Optimistically add it locally
      if (!panels.has(def.id)) {
        const panel = document.createElement('div');
        panel.className = 'nexus-canvas-panel';
        panel.style.left = (def.x || 0) + 'px';
        panel.style.top = (def.y || 0) + 'px';
        panel.style.width = (def.w || 300) + 'px';
        panel.style.height = (def.h || 200) + 'px';
        panel.innerHTML = `
          <div class="nexus-canvas-panel-header">${def.title || 'PANEL'}</div>
          <div class="nexus-canvas-panel-body"></div>
          <div class="nexus-canvas-resize-handle"></div>
        `;
        panel.querySelector('.nexus-canvas-panel-body').appendChild(content);
        document.getElementById('nexus-canvas-panels').appendChild(panel);
        panels.set(def.id, panel);
      }
    },

    removePanel(id) {
      postCanvasAction('removePanel', { canvasId, panelId: id });
      if (panels.has(id)) {
        panels.get(id).remove();
        panels.delete(id);
      }
    },

    setBackdropUrl(url) {
      postCanvasAction('setBackdrop', { canvasId, backdropUrl: url });
      const backdropEl = document.getElementById('nexus-canvas-backdrop');
      if (url.startsWith('http')) {
        backdropEl.style.backgroundImage = `url('${url}')`;
      } else {
        backdropEl.style.backgroundImage = 'none';
      }
      state.backdrop = url;
    },

    setFeedback(title, rows) {
      // rows is an array of { text, status?: 'running'|'complete'|'failed' }
      postCanvasAction('setFeedback', { canvasId, feedback: { title, rows } });
      const feedbackEl = document.getElementById('nexus-build-feedback');
      if (rows && rows.length) {
        feedbackEl.innerHTML = `
          <div class="nexus-build-feedback-title">${title || 'ACTIVITY'}</div>
          ${rows.map(r => `<div class="nexus-build-feedback-row ${r.status || ''}">${r.text}</div>`).join('')}
        `;
        feedbackEl.style.opacity = '1';
      } else {
        feedbackEl.style.opacity = '0';
      }
      state.feedback = { title, rows };
    },

    stopPolling() {
      clearInterval(pollInterval);
    },
  };
}
