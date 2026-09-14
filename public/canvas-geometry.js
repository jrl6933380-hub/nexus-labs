// /public/canvas-geometry.js
// Pure math for the canvas engine: no DOM access anywhere in this file,
// so it can be unit-tested directly under Node (see
// test/canvas-geometry.test.mjs) instead of only being provable by
// clicking around in a browser. canvas-engine.js is the DOM layer that
// calls into these functions.

export const MIN_PANEL_W = 200;
export const MIN_PANEL_H = 120;

// Gives every panel an immediately reachable title bar on a phone. Desktop
// layouts often place several panels beyond the mobile viewport's right edge;
// clamping each one independently used to put them at the same x/y and made
// the lower panels appear "stuck" behind the first. A short vertical cascade
// keeps the freeform canvas while exposing every window on first load.
export function defaultMobileRect(rect, viewport, panelIndex = 0) {
  const width = Math.max(MIN_PANEL_W, viewport.width - 24);
  const height = Math.min(
    Math.max(MIN_PANEL_H, Number(rect.h) || 280),
    Math.max(MIN_PANEL_H, Math.floor(viewport.height * 0.72)),
  );
  const visibleHeaderStep = 56;
  const availableTop = Math.max(68, viewport.height - 168);
  const y = Math.min(72 + (Math.max(0, panelIndex) * visibleHeaderStep), availableTop);

  return {
    x: 12,
    y,
    w: width,
    h: height,
  };
}

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

// Folds one tile into another: creates a new folder if neither is
// already one, adds the dragged tile/folder's members into an
// existing target folder, or (if the dragged item is itself a folder
// and the target isn't) absorbs the target into the dragged folder.
// Self-drops and missing ids are no-ops. Pure data transform -- no
// DOM, so the drag/drop gesture handling in canvas-engine.js can stay
// thin and just call this with whatever ids the pointer landed on.
export function foldTiles(folders, draggedId, targetId) {
  if (!draggedId || !targetId || draggedId === targetId) return folders;
  const next = { ...folders };
  const draggedFolder = next[draggedId];
  const targetFolder = next[targetId];

  if (targetFolder) {
    const incoming = draggedFolder ? draggedFolder.children : [draggedId];
    const merged = [...new Set([...targetFolder.children, ...incoming])];
    next[targetId] = { ...targetFolder, children: merged };
    if (draggedFolder) delete next[draggedId];
    return next;
  }

  if (draggedFolder) {
    const merged = [...new Set([...draggedFolder.children, targetId])];
    next[draggedId] = { ...draggedFolder, children: merged };
    return next;
  }

  const folderId = `folder-${draggedId}-${targetId}`.slice(0, 60);
  next[folderId] = { title: 'Folder', children: [draggedId, targetId] };
  return next;
}

// Removes one tile from whichever folder currently contains it. If
// that leaves the folder with only one child, the folder dissolves
// and that last child becomes a normal top-level tile again -- a
// one-item "folder" isn't a folder, it's just an app hidden inside a
// pointless wrapper.
export function unfoldTile(folders, tileId) {
  const folderId = Object.keys(folders).find((id) => folders[id].children.includes(tileId));
  if (!folderId) return folders;
  const next = { ...folders };
  const remaining = folders[folderId].children.filter((id) => id !== tileId);
  if (remaining.length <= 1) delete next[folderId];
  else next[folderId] = { ...folders[folderId], children: remaining };
  return next;
}

// Turns a flat list of real tile ids into the list of things that
// should actually render: a plain tile for anything not in a folder,
// or one folder entry (at the position of its first member) for a
// group of tiles that got folded together. Filters folder membership
// down to ids that still exist, so a deleted venture never leaves a
// broken reference inside a folder.
export function resolveVisibleItems(itemIds, folders) {
  const idSet = new Set(itemIds);
  const seenFolders = new Set();
  const items = [];
  for (const id of itemIds) {
    const folderId = Object.keys(folders).find((fid) => folders[fid].children.includes(id));
    if (folderId) {
      if (seenFolders.has(folderId)) continue;
      seenFolders.add(folderId);
      const children = folders[folderId].children.filter((childId) => idSet.has(childId));
      if (children.length <= 1) {
        items.push(...children.map((childId) => ({ id: childId, isFolder: false })));
        continue;
      }
      items.push({ id: folderId, isFolder: true, title: folders[folderId].title, children });
      continue;
    }
    items.push({ id, isFolder: false });
  }
  return items;
}
