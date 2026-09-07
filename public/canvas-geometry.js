// /public/canvas-geometry.js
// Pure math for the canvas engine: no DOM access anywhere in this file,
// so it can be unit-tested directly under Node (see
// test/canvas-geometry.test.mjs) instead of only being provable by
// clicking around in a browser. canvas-engine.js is the DOM layer that
// calls into these functions.

export const MIN_PANEL_W = 200;
export const MIN_PANEL_H = 120;

// Keeps a panel's top-left corner on screen — same idea as the
// existing Nex chat dock's keepOnScreen, generalized to any panel
// size instead of one hardcoded container.
export function clampPosition({ x, y, w, h }, viewport) {
  const maxX = Math.max(8, viewport.width - w - 8);
  const maxY = Math.max(8, viewport.height - h - 8);
  return {
    x: Math.max(8, Math.min(x, maxX)),
    y: Math.max(8, Math.min(y, maxY)),
  };
}

// Enforces a sane minimum, and an optional maximum (defaults to the
// viewport if none given, so a panel can never be resized larger than
// the screen it lives on).
export function clampSize({ w, h }, viewport, { minW = MIN_PANEL_W, minH = MIN_PANEL_H } = {}) {
  const maxW = viewport?.width ? viewport.width - 16 : Infinity;
  const maxH = viewport?.height ? viewport.height - 16 : Infinity;
  return {
    w: Math.max(minW, Math.min(w, maxW)),
    h: Math.max(minH, Math.min(h, maxH)),
  };
}

// Computes the new rect for a resize-handle drag. `handle` is one of
// the 8 compass points ('e','se','s','sw','w','nw','n','ne'):
// dragging 'se' grows width+height from the bottom-right corner while
// x/y stay fixed; dragging 'nw' shrinks/grows from the top-left corner
// while the *opposite* corner (bottom-right) stays fixed, which means
// x and y move too. This is the one part of "resize" that's easy to
// get subtly wrong, so it's isolated here and tested on its own.
export function resizeFromHandle({ startRect, dx, dy, handle }) {
  let { x, y, w, h } = startRect;

  if (handle.includes('e')) w = startRect.w + dx;
  if (handle.includes('s')) h = startRect.h + dy;
  if (handle.includes('w')) {
    w = startRect.w - dx;
    x = startRect.x + dx;
  }
  if (handle.includes('n')) {
    h = startRect.h - dy;
    y = startRect.y + dy;
  }

  return { x, y, w, h };
}

// After resizeFromHandle can produce a rect smaller than the minimum
// (e.g. dragging 'nw' past the panel's own bottom-right corner), this
// re-derives x/y so shrinking never lets the FIXED opposite corner
// drift — clampSize alone would clamp w/h but leave x/y computed from
// the wrong (pre-clamp) size.
export function finalizeResize({ startRect, dx, dy, handle }, viewport, opts) {
  const raw = resizeFromHandle({ startRect, dx, dy, handle });
  const { w, h } = clampSize(raw, viewport, opts);
  let { x, y } = raw;
  // If width got clamped while shrinking from the west, keep the east
  // edge fixed instead of the west edge silently drifting.
  if (handle.includes('w') && w !== raw.w) x = startRect.x + startRect.w - w;
  if (handle.includes('n') && h !== raw.h) y = startRect.y + startRect.h - h;
  return { x, y, w, h };
}
