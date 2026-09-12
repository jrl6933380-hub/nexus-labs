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

import { clampPosition, defaultMobileRect, finalizeResize } from './canvas-geometry.js';

const POLL_INTERVAL_MS = 4000;
const DEFAULT_CANVAS_ID = 'dashboard';
const MOBILE_BREAKPOINT_PX = 720;

function injectStyles() {
  if (document.getElementById('nexus-canvas-styles')) return;
  const style = document.createElement('style');
  style.id = 'nexus-canvas-styles';
  style.textContent = `
    :root {
      --nx-ink: #070a0f;
      --nx-surface: rgba(16, 22, 32, .94);
      --nx-surface-raised: rgba(22, 29, 42, .96);
      --nx-line: rgba(148, 163, 184, .18);
      --nx-line-strong: rgba(148, 163, 184, .32);
      --nx-text: #f4f7fb;
      --nx-muted: #a0abba;
      --nx-faint: #6f7b8d;
      --nx-accent: #5db8ff;
      --nx-success: #56d6a0;
      --nx-warning: #f2ba63;
      --nx-danger: #ff7c8c;
      --nx-radius: 16px;
      --nx-sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      --nx-mono: 'JetBrains Mono', ui-monospace, SFMono-Regular, Consolas, monospace;
    }
    #nexus-canvas-root {
      position: fixed;
      inset: 0;
      overflow: hidden;
      color: var(--nx-text);
      background: radial-gradient(ellipse 62% 46% at 52% -10%, rgba(54, 113, 175, .19), transparent 70%),
                  linear-gradient(155deg, #0c1119 0%, var(--nx-ink) 54%, #05070b 100%);
      font-family: var(--nx-sans);
      isolation: isolate;
    }
    #nexus-canvas-atmosphere-grid {
      position: absolute;
      inset: 0;
      z-index: 0;
      opacity: .38;
      pointer-events: none;
      background-image: linear-gradient(rgba(148, 163, 184, .035) 1px, transparent 1px),
                         linear-gradient(90deg, rgba(148, 163, 184, .035) 1px, transparent 1px);
      background-size: 48px 48px;
      mask-image: linear-gradient(to bottom, black, transparent 86%);
    }
    #nexus-canvas-atmosphere-vignette {
      position: absolute;
      inset: 0;
      z-index: 0;
      pointer-events: none;
      background: radial-gradient(ellipse at 50% 42%, transparent 38%, rgba(0, 0, 0, .65) 100%);
    }
    #nexus-canvas-backdrop {
      position: absolute;
      inset: 0;
      z-index: 1;
      background-size: cover;
      background-position: center;
      background-repeat: no-repeat;
      transition: background-image 260ms ease;
    }
    .nexus-canvas-brand {
      position: fixed;
      top: max(14px, env(safe-area-inset-top));
      left: 16px;
      z-index: 3;
      display: flex;
      align-items: center;
      gap: 10px;
      min-height: 34px;
      color: var(--nx-text);
      pointer-events: none;
      text-shadow: 0 2px 18px #000;
    }
    .nexus-canvas-brand-mark {
      display: grid;
      place-items: center;
      width: 30px;
      height: 30px;
      border: 1px solid rgba(93, 184, 255, .46);
      border-radius: 9px;
      background: linear-gradient(145deg, rgba(93, 184, 255, .2), rgba(93, 184, 255, .04));
      color: #bce2ff;
      font: 700 12px var(--nx-mono);
    }
    .nexus-canvas-brand-copy { display: grid; gap: 1px; }
    .nexus-canvas-brand-name { font: 650 13px/1.1 var(--nx-sans); letter-spacing: .01em; }
    .nexus-canvas-brand-context { color: var(--nx-muted); font: 500 9px/1.1 var(--nx-mono); letter-spacing: .12em; text-transform: uppercase; }
    .nexus-canvas-panel:focus-within,
    .nexus-canvas-panel:hover { border-color: var(--nx-line-strong); }
    .nexus-canvas-panel:focus-within { box-shadow: 0 24px 70px rgba(0, 0, 0, .5), 0 0 0 1px rgba(93, 184, 255, .2); }
    .nexus-canvas-panel {
      position: absolute;
      z-index: 2;
      display: flex;
      flex-direction: column;
      background: var(--nx-surface);
      border: 1px solid var(--nx-line);
      border-radius: var(--nx-radius);
      box-shadow: 0 24px 70px rgba(0, 0, 0, .48), inset 0 1px rgba(255, 255, 255, .035);
      backdrop-filter: blur(18px) saturate(112%);
      overflow: hidden;
      min-width: 200px;
      min-height: 120px;
      transition: border-color 160ms ease, box-shadow 160ms ease;
    }
    .nexus-canvas-panel.is-workspace-locked {
      inset: 0 !important;
      width: 100% !important;
      height: 100% !important;
      min-width: 0;
      min-height: 0;
      border: 0;
      border-radius: 0;
      box-shadow: none;
      backdrop-filter: none;
    }
    .nexus-canvas-panel.is-workspace-locked > .nexus-canvas-panel-header,
    .nexus-canvas-panel.is-workspace-locked > .nexus-canvas-resize-handle { display: none; }
    .nexus-canvas-panel.is-workspace-locked > .nexus-canvas-panel-body { overflow: hidden; }
    .nexus-canvas-panel-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      box-sizing: border-box;
      min-height: 48px;
      padding: 8px 9px 8px 16px;
      background: linear-gradient(90deg, rgba(93, 184, 255, .055), transparent 62%);
      border-bottom: 1px solid var(--nx-line);
      cursor: grab;
      touch-action: none;
      user-select: none;
      font: 650 12px var(--nx-sans);
      letter-spacing: .015em;
      text-transform: none;
      color: var(--nx-text);
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
      width: 32px;
      height: 32px;
      padding: 0;
      border: 1px solid transparent;
      border-radius: 9px;
      background: transparent;
      color: var(--nx-muted);
      cursor: pointer;
      font: 500 18px/1 var(--nx-mono);
      touch-action: manipulation;
    }
    .nexus-canvas-panel-toggle:hover,
    .nexus-canvas-panel-toggle:focus-visible {
      border-color: var(--nx-line-strong);
      background: rgba(255, 255, 255, .055);
      color: var(--nx-text);
      outline: 2px solid transparent;
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
      color: var(--nx-text);
      scrollbar-color: rgba(160, 171, 186, .36) transparent;
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
      border-right: 2px solid rgba(160, 171, 186, .58);
      border-bottom: 2px solid rgba(160, 171, 186, .58);
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
      border: 1px solid var(--nx-line);
      border-radius: 999px;
      background: rgba(13, 18, 27, .92);
      box-shadow: 0 16px 40px rgba(0, 0, 0, .45);
      backdrop-filter: blur(18px);
      font: 12px var(--nx-sans);
      color: var(--nx-text);
      pointer-events: none;
    }
    .nexus-build-feedback[hidden] { display: none; }
    .nexus-build-feedback-dot { width: 7px; height: 7px; flex: 0 0 auto; border-radius: 50%; background: var(--nx-warning); }
    .nexus-build-feedback-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font: 600 10px var(--nx-mono); letter-spacing: .02em; color: var(--nx-text); }
    .nexus-build-feedback.complete .nexus-build-feedback-dot { background: var(--nx-success); }
    .nexus-build-feedback.failed .nexus-build-feedback-dot { background: var(--nx-danger); }

    .canvas-title-bar,
    .return-link,
    #nexus-canvas-backdrop-control {
      box-sizing: border-box;
      border: 1px solid var(--nx-line) !important;
      background: rgba(13, 18, 27, .88) !important;
      box-shadow: 0 12px 34px rgba(0, 0, 0, .3) !important;
      backdrop-filter: blur(18px) !important;
    }
    .canvas-title-bar {
      color: var(--nx-text) !important;
      border-radius: 999px !important;
      font: 600 11px var(--nx-sans) !important;
      letter-spacing: .02em !important;
      text-transform: none !important;
      padding: 9px 15px !important;
    }
    .return-link {
      color: var(--nx-muted) !important;
      border-radius: 10px !important;
      font: 600 11px var(--nx-sans) !important;
      letter-spacing: 0 !important;
      text-transform: none !important;
      padding: 9px 12px !important;
    }
    .return-link:hover, .return-link:focus-visible { color: var(--nx-text) !important; border-color: var(--nx-line-strong) !important; outline: none; }
    #nexus-canvas-backdrop-control {
      left: 16px !important;
      bottom: max(16px, env(safe-area-inset-bottom)) !important;
      display: block !important;
      padding: 0 !important;
      border-radius: 12px !important;
      font: 12px var(--nx-sans) !important;
    }
    #nexus-canvas-backdrop-control summary {
      list-style: none;
      cursor: pointer;
      color: var(--nx-muted);
      padding: 10px 13px;
      font-weight: 600;
      user-select: none;
    }
    #nexus-canvas-backdrop-control summary::-webkit-details-marker { display: none; }
    #nexus-canvas-backdrop-control summary::before { content: '◐'; margin-right: 8px; color: var(--nx-accent); }
    #nexus-canvas-backdrop-control[open] summary { border-bottom: 1px solid var(--nx-line); color: var(--nx-text); }
    .nexus-appearance-fields { display: flex; gap: 8px; padding: 10px; }
    #nexus-canvas-backdrop-control input {
      box-sizing: border-box;
      width: min(240px, calc(100vw - 142px)) !important;
      border: 1px solid var(--nx-line) !important;
      border-radius: 9px !important;
      background: rgba(255, 255, 255, .035) !important;
      color: var(--nx-text) !important;
      padding: 9px 10px !important;
      font: 12px var(--nx-sans) !important;
    }
    #nexus-canvas-backdrop-control button {
      border: 1px solid rgba(93, 184, 255, .34) !important;
      border-radius: 9px !important;
      background: rgba(93, 184, 255, .1) !important;
      color: #bce2ff !important;
      padding: 8px 11px !important;
      font: 650 11px var(--nx-sans) !important;
      letter-spacing: 0 !important;
      text-transform: none !important;
    }
    #nexus-canvas-backdrop-control input:focus-visible,
    #nexus-canvas-backdrop-control button:focus-visible { outline: 2px solid rgba(93, 184, 255, .6); outline-offset: 2px; }
    @media (max-width: 720px) {
      .nexus-canvas-brand { top: max(10px, env(safe-area-inset-top)); left: 12px; }
      .nexus-canvas-brand-copy { display: none; }
      .nexus-canvas-panel { border-radius: 14px; min-width: 0; }
      .nexus-canvas-panel-header { min-height: 50px; padding: 5px 6px 5px 15px; font-size: 12px; }
      .nexus-canvas-panel-toggle { width: 40px; height: 40px; border-radius: 10px; }
      .nexus-canvas-resize-handle { display: block; width: 44px; height: 44px; }
      .nexus-canvas-resize-handle::after { right: 9px; bottom: 9px; width: 10px; height: 10px; border-color: var(--nx-accent); }

      /* Every minimized canvas panel becomes a phone-style app tile. The
         engine supplies grid coordinates and an icon, so this also covers
         venture panels and future panel types without page-specific CSS. */
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed {
        left: var(--nx-mobile-tile-left, 12px) !important;
        top: var(--nx-mobile-tile-top, 92px) !important;
        width: 96px !important;
        height: 108px !important;
        min-width: 96px !important;
        min-height: 108px !important;
        border: 0;
        border-radius: 22px;
        background: transparent;
        box-shadow: none;
        backdrop-filter: none;
        overflow: visible;
      }
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed .nexus-canvas-panel-header {
        display: grid;
        place-items: center;
        width: 96px;
        height: 108px;
        min-height: 108px;
        box-sizing: border-box;
        padding: 0 4px 5px;
        border: 0;
        border-radius: 22px;
        background: transparent;
        overflow: visible;
        cursor: pointer;
      }
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed .nexus-canvas-panel-title-group,
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed .nexus-canvas-panel-title {
        display: grid;
        place-items: center;
        gap: 7px;
        width: 100%;
        overflow: visible;
      }
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed .nexus-canvas-panel-title {
        color: #eef6ff;
        font: 600 11px/1.15 var(--nx-sans);
        text-align: center;
        white-space: normal;
        text-shadow: 0 2px 10px #000;
      }
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed .nexus-canvas-panel-title::before {
        content: attr(data-app-icon);
        display: grid;
        place-items: center;
        width: 68px;
        height: 68px;
        border: 1px solid rgba(134, 203, 255, .36);
        border-radius: 19px;
        background: linear-gradient(145deg, hsl(var(--nx-app-hue, 207) 64% 43%), hsl(var(--nx-app-hue, 207) 56% 14%));
        box-shadow: inset 0 1px rgba(255,255,255,.18), 0 12px 28px rgba(0,0,0,.42);
        color: #eff9ff;
        font: 700 25px/1 var(--nx-mono);
      }
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed .nexus-canvas-panel-toggle {
        position: absolute;
        inset: 0;
        z-index: 2;
        width: 100%;
        height: 100%;
        border: 0;
        border-radius: 22px;
        opacity: 0;
      }
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed:focus-within .nexus-canvas-panel-title::before {
        outline: 2px solid var(--nx-accent);
        outline-offset: 3px;
      }
      .nexus-build-feedback { top: max(10px, env(safe-area-inset-top)); right: 10px; max-width: min(190px, calc(100vw - 62px)); }
      #nexus-canvas-backdrop-control { left: 12px !important; bottom: max(12px, env(safe-area-inset-bottom)) !important; }
      .canvas-title-bar { top: max(10px, env(safe-area-inset-top)) !important; max-width: 48vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .return-link { top: max(10px, env(safe-area-inset-top)) !important; left: 12px !important; }
    }
    @media (prefers-reduced-motion: reduce) {
      #nexus-canvas-backdrop, .nexus-canvas-panel { transition: none; }
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

export function mountCanvas({ canvasId = DEFAULT_CANVAS_ID, canvasTitle = 'Venture Factory' } = {}) {
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
  let brand = root.querySelector('.nexus-canvas-brand');
  if (!brand) {
    brand = document.createElement('div');
    brand.className = 'nexus-canvas-brand';
    brand.setAttribute('aria-label', `Nexus — ${canvasTitle}`);
    brand.innerHTML = `
      <span class="nexus-canvas-brand-mark" aria-hidden="true">N</span>
      <span class="nexus-canvas-brand-copy">
        <span class="nexus-canvas-brand-name">Nexus</span>
        <span class="nexus-canvas-brand-context"></span>
      </span>
    `;
    root.appendChild(brand);
  }
  brand.querySelector('.nexus-canvas-brand-context').textContent = canvasTitle;
  brand.hidden = Boolean(document.querySelector('.return-link'));
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

  function displayRect(rect, el, panelIndex = 0, useDefaultMobilePlacement = false) {
    if (!isMobileViewport()) return rect;
    const view = interactionViewport();
    if (useDefaultMobilePlacement) {
      const initial = defaultMobileRect(rect, view, panelIndex);
      if (!el?.classList.contains('is-collapsed')) return initial;
      return { ...initial, h: Math.max(50, el.querySelector('.nexus-canvas-panel-header')?.getBoundingClientRect().height || 50) };
    }
    const w = Math.min(Math.max(200, Number(rect.w) || 360), Math.max(200, view.width - 32));
    const h = Math.min(Math.max(120, Number(rect.h) || 280), Math.max(120, Math.floor(view.height * 0.78)));
    const collapsedHeight = el?.classList.contains('is-collapsed')
      ? Math.max(40, el.querySelector('.nexus-canvas-panel-header')?.getBoundingClientRect().height || 40)
      : h;
    const position = clampPosition({ x: Number(rect.x) || 8, y: Number(rect.y) || 8, w, h: collapsedHeight }, view);
    return { ...position, w, h };
  }

  function applyRect(el, rect, panelIndex = 0, useDefaultMobilePlacement = false) {
    const displayed = displayRect(rect, el, panelIndex, useDefaultMobilePlacement);
    el.style.left = `${displayed.x}px`;
    el.style.top = `${displayed.y}px`;
    el.style.width = `${displayed.w}px`;
    el.style.height = `${displayed.h}px`;
  }

  function refreshPanels() {
    const mobile = isMobileViewport();
    const view = interactionViewport();
    const tileWidth = 96;
    const tileGap = Math.max(8, Math.floor((view.width - 24 - tileWidth * 3) / 2));
    let panelIndex = 0;
    for (const entry of panels.values()) {
      if (mobile) {
        const column = panelIndex % 3;
        const row = Math.floor(panelIndex / 3);
        entry.el.style.setProperty('--nx-mobile-tile-left', `${12 + column * (tileWidth + tileGap)}px`);
        entry.el.style.setProperty('--nx-mobile-tile-top', `${Math.max(92, 76 + row * 116)}px`);
        applyRect(entry.el, entry.mobileRect || entry.remoteRect, panelIndex, !entry.mobileRect);
      } else {
        entry.el.style.removeProperty('--nx-mobile-tile-left');
        entry.el.style.removeProperty('--nx-mobile-tile-top');
        applyRect(entry.el, entry.remoteRect);
      }
      entry.el.hidden = false;
      panelIndex += 1;
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
    const panelIndex = [...panels.keys()].indexOf(id);
    applyRect(entry.el, isMobileViewport() && entry.mobileRect ? entry.mobileRect : remoteRect, panelIndex, isMobileViewport() && !entry.mobileRect);
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

  function addPanel({ id, title, content, x = 80, y = 80, w = 360, h = 280, locked = false }) {
    const el = document.createElement('div');
    el.className = 'nexus-canvas-panel';
    el.classList.toggle('is-workspace-locked', locked);
    el.dataset.panelId = id;
    applyRect(el, { x, y, w, h });

    const header = document.createElement('div');
    header.className = 'nexus-canvas-panel-header';
    const titleGroup = document.createElement('div');
    titleGroup.className = 'nexus-canvas-panel-title-group';
    const titleLabel = document.createElement('span');
    titleLabel.className = 'nexus-canvas-panel-title';
    titleLabel.textContent = title;
    const appIcons = { 'room-list': '⌂', 'agent-list': '◎', 'board-summary': '▥', notes: '✎' };
    titleLabel.dataset.appIcon = appIcons[id] || String(title || id || 'N').trim().charAt(0).toUpperCase() || 'N';
    let hue = 0;
    for (const character of String(id)) hue = (hue * 31 + character.charCodeAt(0)) % 360;
    el.style.setProperty('--nx-app-hue', String(hue));
    titleGroup.append(titleLabel);
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
      mobileRect = JSON.parse(localStorage.getItem(`nexus-mobile-panel-v2:${canvasId}:${id}`));
      const collapsedKey = `nexus-panel-collapsed:${canvasId}:${id}`;
      const savedCollapsed = localStorage.getItem(collapsedKey);
      collapsed = savedCollapsed === '1';
      if (isMobileViewport() && savedCollapsed === null && !locked) {
        collapsed = true;
        localStorage.setItem(collapsedKey, '1');
      }
    } catch {
      // Safe clamping still works when storage is unavailable.
      collapsed = isMobileViewport() && !locked;
    }
    if (locked) collapsed = false;
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
        try { localStorage.setItem(`nexus-mobile-panel-v2:${canvasId}:${id}`, JSON.stringify(rect)); } catch {}
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
