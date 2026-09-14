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

import { clampPosition, defaultMobileRect, finalizeResize, foldTiles, unfoldTile, resolveVisibleItems } from './canvas-geometry.js';

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
    /* Folded tiles are hidden via the native `hidden` attribute
       (public/canvas-engine.js sets entry.el.hidden = true), but the
       class rule above sets display:flex at equal CSS specificity to
       the UA's own [hidden]{display:none} rule -- being injected later
       in the cascade, it silently wins and the element stays visible
       despite hidden being true. Same fix already used elsewhere in
       this file for .nexus-build-feedback[hidden]. */
    .nexus-canvas-panel[hidden] { display: none !important; }
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
      /* The phone dashboard is an app launcher whose tile rows can extend
         beyond the viewport. The fixed root previously clipped those rows,
         leaving no scroll container at all. Let the root own vertical scroll
         on mobile while keeping horizontal canvas overflow contained. */
      #nexus-canvas-root {
        overflow-x: hidden;
        overflow-y: auto;
        overscroll-behavior-y: contain;
        -webkit-overflow-scrolling: touch;
      }
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
        touch-action: none;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
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
        touch-action: none;
        -webkit-user-select: none;
        user-select: none;
        -webkit-touch-callout: none;
      }
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed:focus-within .nexus-canvas-panel-title::before {
        outline: 2px solid var(--nx-accent);
        outline-offset: 3px;
      }
      /* App-Store-style install ring for a venture still being built.
         Approximate, not pixel-perfect — anchored to the top of the
         title box (where the icon square lands, being the ::before
         content) rather than precisely traced to the icon alone. */
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed.has-progress .nexus-canvas-panel-title {
        position: relative;
      }
      #nexus-canvas-root .nexus-canvas-panel.is-collapsed.has-progress .nexus-canvas-panel-title::after {
        content: '';
        position: absolute;
        top: -6px;
        left: 50%;
        transform: translateX(-50%);
        width: 80px;
        height: 80px;
        border-radius: 50%;
        background: conic-gradient(var(--nx-accent) calc(var(--nx-progress, 0) * 3.6deg), rgba(255,255,255,.14) 0);
        -webkit-mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
        mask: radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px));
        animation: nex-progress-pulse 1.6s ease-in-out infinite;
      }
      @keyframes nex-progress-pulse {
        50% { opacity: .55; }
      }
      .nexus-build-feedback { top: max(10px, env(safe-area-inset-top)); right: 10px; max-width: min(190px, calc(100vw - 62px)); }
      #nexus-canvas-backdrop-control { left: 12px !important; bottom: max(12px, env(safe-area-inset-bottom)) !important; }
      .canvas-title-bar { top: max(10px, env(safe-area-inset-top)) !important; max-width: 48vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .return-link { top: max(10px, env(safe-area-inset-top)) !important; left: 12px !important; }
    }
    @media (prefers-reduced-motion: reduce) {
      #nexus-canvas-backdrop, .nexus-canvas-panel { transition: none; }
      .nexus-canvas-panel.is-jiggling { animation: none !important; }
    }

    /* Long-press-to-rearrange ("jiggle mode"), same idea as the iOS
       home screen: every foldable tile wiggles so it's clear the
       screen is in edit mode, and a Done pill appears to exit it. */
    @keyframes nexus-tile-jiggle {
      0%, 100% { transform: rotate(-1.5deg); }
      50% { transform: rotate(1.5deg); }
    }
    .nexus-canvas-panel.is-jiggling {
      animation: nexus-tile-jiggle 0.22s ease-in-out infinite;
      animation-delay: calc(var(--nx-jiggle-offset, 0) * 1s);
    }
    .nexus-canvas-panel.is-fold-target .nexus-canvas-panel-title::before {
      box-shadow: 0 0 0 3px var(--nx-accent), inset 0 1px rgba(255,255,255,.18), 0 12px 28px rgba(0,0,0,.42) !important;
    }
    #nexus-canvas-edit-done {
      position: fixed;
      top: max(14px, env(safe-area-inset-top));
      right: 14px;
      z-index: 500;
      background: var(--nx-accent);
      color: #04121f;
      border: 0;
      border-radius: 999px;
      font: 700 13px var(--nx-sans);
      padding: 8px 18px;
      display: none;
    }
    #nexus-canvas-root.nexus-canvas-edit-mode #nexus-canvas-edit-done { display: block; }
    .nexus-canvas-folder-count {
      position: absolute;
      top: -2px;
      right: -2px;
      min-width: 19px;
      height: 19px;
      padding: 0 4px;
      border-radius: 999px;
      background: var(--nx-danger);
      color: #2a060b;
      font: 700 11px var(--nx-mono);
      display: grid;
      place-items: center;
    }
    #nexus-canvas-folder-overlay {
      position: fixed;
      inset: 0;
      z-index: 600;
      background: rgba(7, 10, 15, .82);
      display: none;
      align-items: flex-end;
      justify-content: center;
    }
    #nexus-canvas-folder-overlay.is-open { display: flex; }
    .nexus-canvas-folder-sheet {
      width: 100%;
      max-width: 480px;
      background: var(--nx-surface-raised);
      border-top-left-radius: 22px;
      border-top-right-radius: 22px;
      border: 1px solid var(--nx-line);
      padding: 18px 16px max(18px, env(safe-area-inset-bottom));
      max-height: 72vh;
      overflow-y: auto;
    }
    .nexus-canvas-folder-sheet-title {
      font: 700 15px var(--nx-sans);
      color: var(--nx-text);
      margin-bottom: 14px;
      text-align: center;
    }
    .nexus-canvas-folder-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 14px;
    }
    .nexus-canvas-folder-item {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      background: none;
      border: 0;
      color: var(--nx-text);
      font: 600 11px var(--nx-sans);
      text-align: center;
    }
    .nexus-canvas-folder-item-icon {
      width: 56px;
      height: 56px;
      border-radius: 16px;
      display: grid;
      place-items: center;
      font: 700 21px var(--nx-mono);
      color: #eff9ff;
    }
    .nexus-canvas-folder-item-remove {
      position: absolute;
      top: -6px;
      right: 6px;
      width: 22px;
      height: 22px;
      border-radius: 999px;
      background: var(--nx-danger);
      color: #2a060b;
      border: 2px solid var(--nx-surface-raised);
      font: 700 13px var(--nx-mono);
      display: grid;
      place-items: center;
    }
    .nexus-canvas-folder-close {
      display: block;
      margin: 16px auto 0;
      background: none;
      border: 1px solid var(--nx-line-strong);
      color: var(--nx-muted);
      border-radius: 999px;
      padding: 8px 22px;
      font: 600 12px var(--nx-sans);
    }
    .nexus-canvas-folder-delete {
      display: block;
      margin: 16px auto 0;
      background: none;
      border: 1px solid var(--nx-danger);
      color: var(--nx-danger);
      border-radius: 999px;
      padding: 8px 22px;
      font: 600 12px var(--nx-sans);
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
  // The floating "NEX · doing X" HUD used to live here. It's gone —
  // that same live progress now renders inline in the Nex chat log
  // itself (public/nex-chat-bar.js), the same window you're already
  // reading his replies in, instead of a separate popup elsewhere on
  // screen.

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

  let currentBackdropUrl = null;
  function applyBackdrop(url) {
    currentBackdropUrl = url || null;
    backdrop.style.backgroundImage = url ? `url("${url}")` : 'none';
  }

  // The backdrop is a personal preference, not shared canvas state —
  // it lives only in THIS browser's localStorage, scoped per canvas id,
  // the same pattern already used above for mobile panel rects and
  // collapsed state. Nothing here is posted to the server, so setting
  // a picture never shows up for anyone else polling this same canvas.
  const backdropStorageKey = `nexus-canvas-backdrop:${canvasId}`;
  function loadLocalBackdrop() {
    try { return localStorage.getItem(backdropStorageKey); } catch { return null; }
  }
  function saveLocalBackdrop(url) {
    try {
      if (url) localStorage.setItem(backdropStorageKey, url);
      else localStorage.removeItem(backdropStorageKey);
    } catch {
      // No persistence this session if storage is unavailable — the
      // backdrop still applies visually for the current page load.
    }
  }
  applyBackdrop(loadLocalBackdrop());

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

    if (mobile) {
      const visible = resolveVisibleItems([...panels.keys()], folders);
      for (const entry of panels.values()) entry.el.hidden = true;
      for (const el of folderElements.values()) el.hidden = true;
      let panelIndex = 0;
      for (const item of visible) {
        const column = panelIndex % 3;
        const row = Math.floor(panelIndex / 3);
        const left = `${12 + column * (tileWidth + tileGap)}px`;
        const top = `${Math.max(92, 76 + row * 116)}px`;
        if (item.isFolder) {
          folderRegistry.set(item.id, item);
          const el = getOrCreateFolderElement(item);
          el.style.setProperty('--nx-mobile-tile-left', left);
          el.style.setProperty('--nx-mobile-tile-top', top);
          const badge = el.querySelector('.nexus-canvas-folder-count');
          if (badge) badge.textContent = String(item.children.length);
          el.hidden = false;
          el.classList.toggle('is-jiggling', editMode);
        } else {
          const entry = panels.get(item.id);
          if (!entry) continue;
          entry.el.style.setProperty('--nx-mobile-tile-left', left);
          entry.el.style.setProperty('--nx-mobile-tile-top', top);
          applyRect(entry.el, entry.mobileRect || entry.remoteRect, panelIndex, !entry.mobileRect);
          entry.el.hidden = false;
        }
        panelIndex += 1;
      }
    } else {
      for (const entry of panels.values()) {
        entry.el.style.removeProperty('--nx-mobile-tile-left');
        entry.el.style.removeProperty('--nx-mobile-tile-top');
        applyRect(entry.el, entry.remoteRect);
        entry.el.hidden = false;
      }
      for (const el of folderElements.values()) el.hidden = true;
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
    // A personal backdrop in localStorage always wins for this browser.
    // If there isn't one, still honor the shared canvas backdrop so
    // older callers using setBackdropUrl(url, false) keep working.
    if (!loadLocalBackdrop()) applyBackdrop(state.backdrop_url);
    for (const [id, rect] of Object.entries(state.panels || {})) {
      syncPanelFromRemote(id, rect);
    }
  }

  poll();
  const pollTimer = setInterval(poll, POLL_INTERVAL_MS);

  // --- Folders & long-press rearrange mode (mobile home screen) ---
  // Folders are a personal, per-device grouping (like the localStorage
  // backdrop above) -- not shared canvas state, since two people
  // looking at the same dashboard may want to organize it differently.
  const foldersKey = `nexus-folders:${canvasId}`;
  let folders = {};
  try { folders = JSON.parse(localStorage.getItem(foldersKey)) || {}; } catch { folders = {}; }
  function saveFolders() {
    try { localStorage.setItem(foldersKey, JSON.stringify(folders)); } catch {}
  }

  let editMode = false;
  function setEditMode(next) {
    editMode = next;
    root.classList.toggle('nexus-canvas-edit-mode', editMode);
    for (const entry of panels.values()) {
      if (entry.isLinkTile) entry.el.classList.toggle('is-jiggling', editMode);
    }
    for (const el of folderElements.values()) el.classList.toggle('is-jiggling', editMode);
  }

  let doneBtn = document.getElementById('nexus-canvas-edit-done');
  if (!doneBtn) {
    doneBtn = document.createElement('button');
    doneBtn.id = 'nexus-canvas-edit-done';
    doneBtn.type = 'button';
    doneBtn.textContent = 'Done';
    doneBtn.addEventListener('click', () => setEditMode(false));
    root.appendChild(doneBtn);
  }

  // Finds which OTHER foldable tile (real or folder) the given point is
  // currently over, for drop-to-fold. Hit tests actual on-screen rects
  // rather than grid math, so it stays correct regardless of how the
  // grid is laid out.
  function findFoldTargetUnder(x, y, excludeId) {
    for (const [id, entry] of panels) {
      if (id === excludeId || entry.el.hidden || !entry.isLinkTile) continue;
      const r = entry.el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    for (const [id, el] of folderElements) {
      if (id === excludeId || el.hidden) continue;
      const r = el.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return id;
    }
    return null;
  }

  let currentFoldTargetEl = null;
  function setFoldHighlight(el) {
    if (currentFoldTargetEl === el) return;
    if (currentFoldTargetEl) currentFoldTargetEl.classList.remove('is-fold-target');
    currentFoldTargetEl = el;
    if (currentFoldTargetEl) currentFoldTargetEl.classList.add('is-fold-target');
  }

  function elementForId(id) {
    return panels.get(id)?.el || folderElements.get(id) || null;
  }

  function promptRenameVenture(id, currentTitle) {
    const nextName = window.prompt('Rename this venture', currentTitle);
    if (!nextName || !nextName.trim() || nextName.trim() === currentTitle) return;
    const trimmed = nextName.trim();
    const entry = panels.get(id);
    if (entry) entry.title = trimmed;
    const titleLabel = entry?.el.querySelector('.nexus-canvas-panel-title');
    if (titleLabel) titleLabel.textContent = trimmed;
    fetch('/api/board', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'rename_canvas', canvas_id: id.replace(/^venture-/, ''), name: trimmed }),
    }).catch(() => {});
  }

  const folderElements = new Map();
  let folderOverlay = document.getElementById('nexus-canvas-folder-overlay');
  if (!folderOverlay) {
    folderOverlay = document.createElement('div');
    folderOverlay.id = 'nexus-canvas-folder-overlay';
    folderOverlay.innerHTML = '<div class="nexus-canvas-folder-sheet"><div class="nexus-canvas-folder-sheet-title"></div><div class="nexus-canvas-folder-grid"></div><button type="button" class="nexus-canvas-folder-delete">Delete folder</button><button type="button" class="nexus-canvas-folder-close">Close</button></div>';
    folderOverlay.addEventListener('click', (event) => {
      if (event.target === folderOverlay) folderOverlay.classList.remove('is-open');
    });
    folderOverlay.querySelector('.nexus-canvas-folder-close').addEventListener('click', () => folderOverlay.classList.remove('is-open'));
    // Deletes the whole folder in one step -- every child becomes a
    // normal top-level tile again immediately, rather than needing to
    // be removed one at a time via each item's own X.
    folderOverlay.querySelector('.nexus-canvas-folder-delete').addEventListener('click', () => {
      const openId = folderOverlay.dataset.openFolderId;
      if (openId) delete folders[openId];
      saveFolders();
      folderOverlay.classList.remove('is-open');
      refreshPanels();
    });
    root.appendChild(folderOverlay);
  }

  function openFolderOverlay(item) {
    folderOverlay.dataset.openFolderId = item.id;
    folderOverlay.querySelector('.nexus-canvas-folder-sheet-title').textContent = item.title || 'Folder';
    const grid = folderOverlay.querySelector('.nexus-canvas-folder-grid');
    grid.innerHTML = '';
    for (const childId of item.children) {
      const entry = panels.get(childId);
      if (!entry) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'nexus-canvas-folder-item';
      const iconEl = document.createElement('span');
      iconEl.className = 'nexus-canvas-folder-item-icon';
      iconEl.style.background = `linear-gradient(145deg, hsl(${entry.el.style.getPropertyValue('--nx-app-hue') || 207} 64% 43%), hsl(${entry.el.style.getPropertyValue('--nx-app-hue') || 207} 56% 14%))`;
      iconEl.textContent = entry.el.querySelector('.nexus-canvas-panel-title')?.dataset.appIcon || 'N';
      const label = document.createElement('span');
      label.textContent = entry.title;
      const removeBtn = document.createElement('span');
      removeBtn.className = 'nexus-canvas-folder-item-remove';
      removeBtn.textContent = '\u00d7';
      removeBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        folders = unfoldTile(folders, childId);
        saveFolders();
        openFolderOverlay({ ...item, children: item.children.filter((id) => id !== childId) });
        refreshPanels();
      });
      button.append(iconEl, label, removeBtn);
      button.addEventListener('click', () => {
        folderOverlay.classList.remove('is-open');
        if (entry.href) window.location.href = entry.href;
        else if (entry.onActivate) entry.onActivate();
      });
      grid.appendChild(button);
    }
    folderOverlay.classList.add('is-open');
  }

  function getOrCreateFolderElement(item) {
    let el = folderElements.get(item.id);
    if (el) return el;
    el = document.createElement('div');
    el.className = 'nexus-canvas-panel is-collapsed';
    el.dataset.panelId = item.id;
    let hue = 0;
    for (const character of String(item.id)) hue = (hue * 31 + character.charCodeAt(0)) % 360;
    el.style.setProperty('--nx-app-hue', String(hue));
    el.innerHTML = `
      <div class="nexus-canvas-panel-header">
        <div class="nexus-canvas-panel-title-group">
          <span class="nexus-canvas-panel-title" data-app-icon="\u25a6"></span>
        </div>
        <button type="button" class="nexus-canvas-panel-toggle" aria-label="Open folder"><span aria-hidden="true"></span></button>
      </div>
    `;
    const countBadge = document.createElement('span');
    countBadge.className = 'nexus-canvas-folder-count';
    el.querySelector('.nexus-canvas-panel-title').appendChild(countBadge);
    root.appendChild(el);

    let drag = null;
    let longPressTimer = null;
    let longPressFired = false;
    const toggle = el.querySelector('.nexus-canvas-panel-toggle');
    toggle.addEventListener('pointerdown', (event) => {
      event.stopPropagation();
      event.preventDefault();
      if (event.button !== 0) return;
      longPressFired = false;
      const startRect = el.getBoundingClientRect();
      longPressTimer = setTimeout(() => {
        longPressFired = true;
        setEditMode(true);
        drag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startLeft: startRect.left, startTop: startRect.top };
        toggle.setPointerCapture(event.pointerId);
      }, 550);
    });
    toggle.addEventListener('pointermove', (event) => {
      if (!drag || event.pointerId !== drag.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      el.style.setProperty('--nx-mobile-tile-left', `${drag.startLeft + dx}px`);
      el.style.setProperty('--nx-mobile-tile-top', `${drag.startTop + dy}px`);
      setFoldHighlight(elementForId(findFoldTargetUnder(event.clientX, event.clientY, item.id)));
    });
    toggle.addEventListener('pointerup', (event) => {
      clearTimeout(longPressTimer);
      if (drag && drag.pointerId === event.pointerId) {
        const targetId = findFoldTargetUnder(event.clientX, event.clientY, item.id);
        setFoldHighlight(null);
        drag = null;
        if (targetId) {
          folders = foldTiles(folders, item.id, targetId);
          saveFolders();
        }
        refreshPanels();
      }
    });
    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      if (longPressFired) { longPressFired = false; return; }
      if (editMode) return;
      const current = folderRegistry.get(item.id);
      if (current) openFolderOverlay(current);
    });

    folderElements.set(item.id, el);
    return el;
  }

  const folderRegistry = new Map();

  function addPanel({ id, title, content, x = 80, y = 80, w = 360, h = 280, locked = false, href = null, onActivate = null, progress = null }) {
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
    const appIcons = { 'room-list': '⌂', 'agent-list': '◎', 'board-summary': '▥', notes: '✎', 'new-venture': '+' };
    titleLabel.dataset.appIcon = appIcons[id] || String(title || id || 'N').trim().charAt(0).toUpperCase() || 'N';
    let hue = 0;
    for (const character of String(id)) hue = (hue * 31 + character.charCodeAt(0)) % 360;
    el.style.setProperty('--nx-app-hue', String(hue));
    if (progress != null) {
      el.classList.add('has-progress');
      el.style.setProperty('--nx-progress', String(Math.max(0, Math.min(100, Number(progress) || 0))));
    }
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
    const entry = { el, dragging: false, resizing: false, collapsed, title, remoteRect: { x, y, w, h }, mobileRect, isLinkTile: Boolean(href || onActivate), href, onActivate };
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

    const isLinkTile = Boolean(href || onActivate);
    const isVenture = String(id).startsWith('venture-');

    if (isLinkTile) {
      let tileLongPressTimer = null;
      let tileLongPressFired = false;
      let tileDrag = null;
      toggle.addEventListener('pointerdown', (event) => {
        event.stopPropagation();
        event.preventDefault();
        if (event.button !== 0) return;
        tileLongPressFired = false;
        const startRect = el.getBoundingClientRect();
        tileLongPressTimer = setTimeout(() => {
          tileLongPressFired = true;
          setEditMode(true);
          tileDrag = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, startLeft: startRect.left, startTop: startRect.top };
          entry.dragging = true;
          toggle.setPointerCapture(event.pointerId);
        }, 550);
      });
      toggle.addEventListener('pointermove', (event) => {
        if (!tileDrag || event.pointerId !== tileDrag.pointerId) return;
        const dx = event.clientX - tileDrag.startX;
        const dy = event.clientY - tileDrag.startY;
        el.style.setProperty('--nx-mobile-tile-left', `${tileDrag.startLeft + dx}px`);
        el.style.setProperty('--nx-mobile-tile-top', `${tileDrag.startTop + dy}px`);
        setFoldHighlight(elementForId(findFoldTargetUnder(event.clientX, event.clientY, id)));
      });
      toggle.addEventListener('pointerup', (event) => {
        clearTimeout(tileLongPressTimer);
        if (tileDrag && tileDrag.pointerId === event.pointerId) {
          const targetId = findFoldTargetUnder(event.clientX, event.clientY, id);
          setFoldHighlight(null);
          tileDrag = null;
          entry.dragging = false;
          if (targetId) {
            folders = foldTiles(folders, id, targetId);
            saveFolders();
          }
          refreshPanels();
        }
      });
      toggle.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (tileLongPressFired) { tileLongPressFired = false; return; }
        if (editMode) {
          if (isVenture) promptRenameVenture(id, entry.title);
          return;
        }
        if (href) { window.location.href = href; return; }
        if (onActivate) { onActivate(); return; }
      });
    } else {
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

  function setBackdropUrl(url, personalOnly = false) {
    applyBackdrop(url);
    saveLocalBackdrop(url);
    if (!personalOnly) {
      return postCanvasAction('set_canvas_backdrop', { canvas_id: canvasId, url });
    }
  }

  function getBackdropUrl() {
    return currentBackdropUrl;
  }

  function destroy() {
    clearInterval(pollTimer);
  }

  window.addEventListener('resize', refreshPanels);
  window.visualViewport?.addEventListener('resize', refreshPanels);

  return { root, canvasId, addPanel, setBackdropUrl, getBackdropUrl, destroy };
}
