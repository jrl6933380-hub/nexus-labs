// Layer operations for graphic scenes: the logic behind agent tools (list, select, patch, group, reorder, duplicate, replace).
// Pure functions: they take a project and return a new one (or {ok:false, error}). Every edit is validated against the closed
// vocabulary, addresses a layer by its stable id, and can be baseline-aware (pass the hash you read; a stale edit is refused).
import { createHash } from 'node:crypto';
import { validateProjectV2, graphicCost, layerCost, GRAPHIC_BUDGET } from '../public/ad-vocabulary.mjs';

const clone = (v) => JSON.parse(JSON.stringify(v));
const fail = (error, extra = {}) => ({ ok: false, error, ...extra });
export const layerHash = (L) => createHash('sha256').update(JSON.stringify(canonical(L))).digest('hex').slice(0, 12);
function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v).sort().map((k) => [k, canonical(v[k])]));
  return v;
}
const sceneIndex = (project, sceneId) => (project.scenes || []).findIndex((s) => s.id === sceneId && s.type === 'graphic');
function locate(project, sceneId, layerId) {
  const si = sceneIndex(project, sceneId);
  if (si < 0) return { error: `scene "${sceneId}" is not a graphic scene in this project` };
  const layers = project.scenes[si].params.layers || [];
  const li = layers.findIndex((l) => l.id === layerId);
  if (li < 0) return { error: `scene "${sceneId}": no layer with id "${layerId}"`, si };
  return { si, li, layers };
}
// Re-validate after an edit and say where it went wrong.
function checked(project, what) {
  const v = validateProjectV2(project);
  if (!v.ok) return fail(`${what} would make the ad invalid: ${v.errors[0]}`, { errors: v.errors.slice(0, 5) });
  return { ok: true, project };
}
const descendants = (layers, id) => {
  const out = new Set([id]);
  let grew = true;
  while (grew) { grew = false; for (const l of layers) if (l.parent && out.has(l.parent) && !out.has(l.id)) { out.add(l.id); grew = true; } }
  out.delete(id);
  return out;
};

// ---- ids and names ----------------------------------------------------------------------------------
// Give every layer a stable id and a readable name. Existing ids are kept; new ones are deterministic (shape-index).
export function ensureIds(project) {
  const p = clone(project);
  for (const s of p.scenes) {
    if (s.type !== 'graphic') continue;
    const used = new Set(s.params.layers.map((l) => l.id).filter(Boolean));
    s.params.layers.forEach((l, i) => {
      if (!l.id) { let id = `${l.shape}-${i + 1}`.slice(0, 24); while (used.has(id)) id = (id + 'x').slice(0, 24); l.id = id; used.add(id); }
      if (!l.name) l.name = (l.text ? String(l.text) : l.id).slice(0, 40);
    });
  }
  return p;
}

// ---- reading ----------------------------------------------------------------------------------------
export function listLayers(project, sceneId) {
  const si = sceneIndex(project, sceneId);
  if (si < 0) return fail(`scene "${sceneId}" is not a graphic scene in this project`);
  const layers = project.scenes[si].params.layers || [];
  const depthOf = (l) => { let d = 0, cur = l; while (cur && cur.parent) { d++; cur = layers.find((x) => x.id === cur.parent); } return d; };
  const rows = layers.map((l, i) => ({ order: i, id: l.id || null, name: l.name || null, role: l.role || null, shape: l.shape, parent: l.parent || null, depth: depthOf(l), visible: l.visible !== false, locked: !!l.locked, z: l.z ?? null, cost: layerCost(l), hash: layerHash(l), imageId: l.imageId || null, keyed: !!l.key, matted: !!(l.matte || l.matteImage), animated: !!(l.keys && l.keys.length) }));
  const cost = graphicCost(layers);
  return { ok: true, sceneId, count: rows.length, cost, budget: GRAPHIC_BUDGET, overWarn: cost > GRAPHIC_BUDGET.warn, layers: rows, unaddressable: rows.filter((r) => !r.id).length };
}
export function readLayer(project, sceneId, layerId) {
  const at = locate(project, sceneId, layerId);
  if (at.error) return fail(at.error);
  const layer = at.layers[at.li];
  return { ok: true, sceneId, layer: clone(layer), hash: layerHash(layer), children: [...descendants(at.layers, layerId)] };
}
// Find layers by what they are: { name, role, shape, color, imageId, parent, visible }. Returns ids, never guesses.
export function selectLayers(project, sceneId, q = {}) {
  const si = sceneIndex(project, sceneId);
  if (si < 0) return fail(`scene "${sceneId}" is not a graphic scene in this project`);
  const hit = project.scenes[si].params.layers.filter((l) => (
    (q.name === undefined || (l.name || '').toLowerCase().includes(String(q.name).toLowerCase()))
    && (q.role === undefined || l.role === q.role) && (q.shape === undefined || l.shape === q.shape)
    && (q.color === undefined || l.color === q.color) && (q.imageId === undefined || l.imageId === q.imageId)
    && (q.parent === undefined || l.parent === q.parent) && (q.visible === undefined || (l.visible !== false) === q.visible)
  ));
  return { ok: true, matches: hit.map((l) => ({ id: l.id || null, name: l.name || null, role: l.role || null, shape: l.shape })) };
}

// ---- editing ----------------------------------------------------------------------------------------
// Add one new layer. `layer` is a complete layer (shape and position at least); it gets a fresh id if it has none.
// index places it in the draw order (default: on top); afterLayerId places it just above that layer.
export function addLayer(project, { sceneId, layer, index, afterLayerId }) {
  const si = sceneIndex(project, sceneId);
  if (si < 0) return fail(`scene "${sceneId}" is not a graphic scene in this project`);
  if (!layer || typeof layer !== 'object' || Array.isArray(layer)) return fail('layer must be an object like {shape, x, y, w, ...}');
  const p = clone(project), layers = p.scenes[si].params.layers, L = clone(layer);
  const used = new Set(layers.map((l) => l.id).filter(Boolean));
  if (L.id !== undefined && used.has(L.id)) return fail(`scene "${sceneId}": a layer with id "${L.id}" already exists`);
  if (L.id === undefined) { let n = layers.length + 1, id; do { id = `${L.shape || 'layer'}-${n++}`.slice(0, 24); } while (used.has(id)); L.id = id; }
  let at = layers.length;
  if (afterLayerId !== undefined) { const j = layers.findIndex((l) => l.id === afterLayerId); if (j < 0) return fail(`scene "${sceneId}": no layer with id "${afterLayerId}" to place this after`); at = j + 1; }
  else if (index !== undefined) { if (!Number.isInteger(index) || index < 0 || index > layers.length) return fail(`index must be a whole number from 0 to ${layers.length}`); at = index; }
  layers.splice(at, 0, L);
  const r = checked(p, `adding "${L.id}"`);
  return r.ok ? { ...r, layerId: L.id, hash: layerHash(L) } : { ...r, error: `scene "${sceneId}" new layer: ${r.error}` };
}
// patch: fields to set (null deletes a field). baseline: the hash from listLayers/readLayer; if given and stale, the edit is refused.
export function patchLayer(project, { sceneId, layerId, patch, baseline }) {
  const at = locate(project, sceneId, layerId);
  if (at.error) return fail(at.error);
  const cur = at.layers[at.li];
  if (baseline && baseline !== layerHash(cur)) return fail(`scene "${sceneId}" layer "${layerId}" changed since you read it (now ${layerHash(cur)}, you had ${baseline}). Read it again and re-apply.`, { current: clone(cur), hash: layerHash(cur) });
  const keys = Object.keys(patch || {});
  if (!keys.length) return fail('patch is empty');
  if (cur.locked && !(keys.length === 1 && keys[0] === 'locked')) return fail(`scene "${sceneId}" layer "${layerId}" is locked. Unlock it first (patch {locked:false}).`);
  if ('id' in patch) return fail('a layer id cannot be changed (other layers may point at it)');
  const p = clone(project), L = p.scenes[at.si].params.layers[at.li];
  for (const [k, v] of Object.entries(patch)) { if (v === null) delete L[k]; else L[k] = v; }
  const r = checked(p, `patching "${layerId}"`);
  return r.ok ? { ...r, hash: layerHash(L) } : { ...r, error: `scene "${sceneId}" layer "${layerId}": ${r.error}` };
}
export function groupLayers(project, { sceneId, ids, groupId, name = 'Group', role = 'other' }) {
  const si = sceneIndex(project, sceneId);
  if (si < 0) return fail(`scene "${sceneId}" is not a graphic scene in this project`);
  if (!Array.isArray(ids) || !ids.length) return fail('ids: at least one layer');
  const p = clone(project), layers = p.scenes[si].params.layers;
  if (layers.some((l) => l.id === groupId)) return fail(`scene "${sceneId}": id "${groupId}" is already used`);
  const idx = ids.map((id) => layers.findIndex((l) => l.id === id));
  const missing = ids.filter((_, i) => idx[i] < 0);
  if (missing.length) return fail(`scene "${sceneId}": no layer with id ${missing.map((m) => `"${m}"`).join(', ')}`);
  const locked = ids.filter((id) => layers.find((l) => l.id === id).locked);
  if (locked.length) return fail(`scene "${sceneId}": layer ${locked[0]} is locked`);
  const parents = new Set(ids.map((id) => layers.find((l) => l.id === id).parent || null));
  if (parents.size > 1) return fail('layers to group must share the same parent');
  const first = Math.min(...idx), parent = [...parents][0];
  const group = { id: groupId, name, role, shape: 'group', x: 0, y: 0 };
  if (parent) group.parent = parent;
  layers.splice(first, 0, group);
  for (const l of layers) if (ids.includes(l.id)) l.parent = groupId;
  return checked(p, `grouping into "${groupId}"`);
}
export function ungroup(project, { sceneId, groupId }) {
  const at = locate(project, sceneId, groupId);
  if (at.error) return fail(at.error);
  const g = at.layers[at.li];
  if (g.shape !== 'group') return fail(`scene "${sceneId}": "${groupId}" is not a group`);
  if (g.rotate || (g.scale && g.scale !== 1) || (g.sx && g.sx !== 1) || (g.sy && g.sy !== 1) || g.opacity != null || g.motion || g.keys) return fail(`scene "${sceneId}": group "${groupId}" has its own transform or animation; ungrouping would change how the children look. Remove it first.`);
  const p = clone(project), layers = p.scenes[at.si].params.layers;
  for (const l of layers) if (l.parent === groupId) { if (g.parent) l.parent = g.parent; else delete l.parent; if (l.x !== undefined) l.x += g.x || 0; if (l.y !== undefined) l.y += g.y || 0; }
  layers.splice(at.li, 1);
  return checked(p, `ungrouping "${groupId}"`);
}
// Move a layer (and nothing else) to a new draw position, or set an explicit stacking z. Parents must stay before their children.
export function reorderLayer(project, { sceneId, layerId, toIndex, z }) {
  const at = locate(project, sceneId, layerId);
  if (at.error) return fail(at.error);
  const p = clone(project), layers = p.scenes[at.si].params.layers;
  if (layers[at.li].locked) return fail(`scene "${sceneId}" layer "${layerId}" is locked`);
  if (z !== undefined) layers[at.li].z = z;
  if (toIndex !== undefined) {
    const kids = descendants(layers, layerId);
    const block = layers.filter((l) => l.id === layerId || kids.has(l.id));
    const rest = layers.filter((l) => !(l.id === layerId || kids.has(l.id)));
    const at2 = Math.max(0, Math.min(rest.length, toIndex));
    rest.splice(at2, 0, ...block);
    p.scenes[at.si].params.layers = rest;
  }
  return checked(p, `reordering "${layerId}"`);
}
export function removeLayer(project, { sceneId, layerId, withChildren = false }) {
  const at = locate(project, sceneId, layerId);
  if (at.error) return fail(at.error);
  if (at.layers[at.li].locked) return fail(`scene "${sceneId}" layer "${layerId}" is locked`);
  const kids = descendants(at.layers, layerId);
  if (kids.size && !withChildren) return fail(`scene "${sceneId}": "${layerId}" has ${kids.size} child layer(s). Pass withChildren:true or ungroup first.`);
  const p = clone(project);
  p.scenes[at.si].params.layers = p.scenes[at.si].params.layers.filter((l) => l.id !== layerId && !kids.has(l.id));
  return checked(p, `removing "${layerId}"`);
}
// Copy a layer and its children under new ids (prefix + original id).
export function duplicateLayer(project, { sceneId, layerId, prefix = 'copy-', dx = 0, dy = 0 }) {
  const at = locate(project, sceneId, layerId);
  if (at.error) return fail(at.error);
  const kids = descendants(at.layers, layerId), p = clone(project), layers = p.scenes[at.si].params.layers;
  const take = layers.filter((l) => l.id === layerId || kids.has(l.id));
  const ids = new Set(layers.map((l) => l.id));
  const map = new Map(take.map((l) => [l.id, (prefix + l.id).slice(0, 24)]));
  for (const n of map.values()) if (ids.has(n)) return fail(`scene "${sceneId}": id "${n}" is already used; choose another prefix`);
  const copies = take.map((l) => { const c = clone(l); c.id = map.get(l.id); if (c.name) c.name = (c.name + ' copy').slice(0, 40); if (c.parent && map.has(c.parent)) c.parent = map.get(c.parent); delete c.locked; if (l.id === layerId) { if (c.x !== undefined) c.x += dx; if (c.y !== undefined) c.y += dy; } return c; });
  layers.splice(Math.max(...take.map((l) => layers.indexOf(layers.find((x) => x.id === l.id)))) + 1, 0, ...copies);
  return { ...checked(p, `duplicating "${layerId}"`), newIds: copies.map((c) => c.id) };
}
// Swap the picture or clip a layer uses (replace a background, keep everything else).
export function replaceAsset(project, { sceneId, layerId, imageId }) {
  const at = locate(project, sceneId, layerId);
  if (at.error) return fail(at.error);
  if (!['image', 'video'].includes(at.layers[at.li].shape)) return fail(`scene "${sceneId}": "${layerId}" is a ${at.layers[at.li].shape}, not an image or video layer`);
  return patchLayer(project, { sceneId, layerId, patch: { imageId } });
}

// ---- reusable compositions --------------------------------------------------------------------------
// Save a group (with its children) as a portable composition, and place copies of it anywhere.
export function saveComposition(project, { sceneId, groupId, name }) {
  const at = locate(project, sceneId, groupId);
  if (at.error) return fail(at.error);
  const kids = descendants(at.layers, groupId);
  const layers = at.layers.filter((l) => l.id === groupId || kids.has(l.id)).map((l) => { const c = clone(l); if (c.id === groupId) delete c.parent; delete c.locked; return c; });
  return { ok: true, composition: { name: name || at.layers[at.li].name || groupId, root: groupId, layers } };
}
export function placeComposition(project, { sceneId, composition, prefix, x, y }) {
  const si = sceneIndex(project, sceneId);
  if (si < 0) return fail(`scene "${sceneId}" is not a graphic scene in this project`);
  if (!composition || !Array.isArray(composition.layers) || !prefix) return fail('composition and prefix are required');
  const p = clone(project), layers = p.scenes[si].params.layers, used = new Set(layers.map((l) => l.id));
  const map = new Map(composition.layers.map((l) => [l.id, (prefix + l.id).slice(0, 24)]));
  for (const n of map.values()) if (used.has(n)) return fail(`scene "${sceneId}": id "${n}" is already used; choose another prefix`);
  const placed = composition.layers.map((l) => { const c = clone(l); c.id = map.get(l.id); if (c.parent && map.has(c.parent)) c.parent = map.get(c.parent); if (l.id === composition.root) { if (x !== undefined) c.x = x; if (y !== undefined) c.y = y; } return c; });
  layers.push(...placed);
  return { ...checked(p, `placing "${composition.name}"`), newIds: placed.map((c) => c.id) };
}

// ---- keying -------------------------------------------------------------------------------------------
// Four copies of a project with one keyed layer shown as final / original / foreground / matte, for model-visible review.
// Render each with scripts/export-ad-still.mjs; nothing is written back to the saved ad.
export function keyViews(project, { sceneId, layerId }) {
  const at = locate(project, sceneId, layerId);
  if (at.error) return fail(at.error);
  if (!at.layers[at.li].key) return fail(`scene "${sceneId}" layer "${layerId}" is not keyed. Patch {key:"green"|"blue"|"custom"} first.`);
  const views = {};
  for (const view of ['final', 'original', 'foreground', 'matte']) {
    const r = patchLayer(project, { sceneId, layerId, patch: { keyView: view } });
    if (!r.ok) return r;
    views[view] = r.project;
  }
  return { ok: true, views };
}

// ---- mattes and reveals ---------------------------------------------------------------------------
// A matte polygon is in percent of the layer's own box. polygons: [[{x,y},...],...] (each 3+ points).
export function setMatte(project, { sceneId, layerId, polygons, mode = 'keep', feather = 0, baseline }) {
  if (!Array.isArray(polygons) || !polygons.length || polygons.length > 8) return fail('polygons must be a list of 1-8 polygons, each a list of {x,y} points in percent of the layer box');
  const matte = [];
  for (let g = 0; g < polygons.length; g++) {
    const P = polygons[g];
    if (!Array.isArray(P) || P.length < 3) return fail(`polygon ${g} needs at least 3 points`);
    for (const q of P) matte.push(g ? { x: q.x, y: q.y, g } : { x: q.x, y: q.y });
  }
  return patchLayer(project, { sceneId, layerId, baseline, patch: { matte, matteMode: mode, matteFeather: feather || null } });
}
export function clearMatte(project, { sceneId, layerId, baseline }) {
  return patchLayer(project, { sceneId, layerId, baseline, patch: { matte: null, matteMode: null, matteFeather: null, matteImage: null, matteChannel: null } });
}
const WIPES = { left: 'cropR', right: 'cropL', up: 'cropB', down: 'cropT' }; // reveal from this edge: the opposite side starts cropped away
const MATTE_AXIS = { left: ['mx', -100], right: ['mx', 100], up: ['my', -100], down: ['my', 100] };
// Reveal (or hide, with hide:true) a layer with a straight wipe that starts at `from` seconds and lasts `duration`.
// Images and video wipe with crop keys. Any other box layer or group wipes with a full-box matte that slides in or out.
export function revealWipe(project, { sceneId, layerId, direction = 'left', from = 0, duration = 1, hide = false, ease = 'smooth', baseline }) {
  const at = locate(project, sceneId, layerId);
  if (at.error) return fail(at.error);
  if (!WIPES[direction]) return fail(`direction must be one of ${Object.keys(WIPES).join(', ')}`);
  if (!(duration > 0)) return fail('duration must be greater than 0 seconds');
  if (!(from >= 0)) return fail('from must be 0 or more seconds');
  const cur = at.layers[at.li], t0 = Math.round(from * 1000) / 1000, t1 = Math.round((from + duration) * 1000) / 1000;
  if (['text', 'line', 'arc'].includes(cur.shape)) return fail(`scene "${sceneId}" layer "${layerId}" is a ${cur.shape}; wipe a group that contains it, or an image, video or shape layer`);
  const useCrop = cur.shape === 'image' || cur.shape === 'video';
  let keys = clone(cur.keys || []);
  const strip = ['cropL', 'cropT', 'cropR', 'cropB', 'mx', 'my', 'ms'];
  for (const k of keys) for (const f of strip) delete k[f];
  keys = keys.filter((k) => ['x', 'y', 'rotate', 'scale', 'opacity'].some((f) => k[f] !== undefined)); // a key that only held the old wipe is dropped
  const put = (t, props, e) => { let k = keys.find((q) => q.t === t); if (!k) { k = { t }; keys.push(k); } Object.assign(k, props); if (e) k.ease = e; };
  const patch = {};
  if (useCrop) {
    const prop = WIPES[direction], [a, b] = hide ? [0, 100] : [100, 0];
    if (t0 > 0) put(0, { [prop]: a });
    put(t0, { [prop]: a }); put(t1, { [prop]: b }, ease);
  } else {
    if (cur.matte !== undefined && !cur.keys?.some((q) => q.mx !== undefined || q.my !== undefined)) return fail(`scene "${sceneId}" layer "${layerId}" already has its own matte. Wipe a group that contains it, or remove the matte first.`);
    const [prop, off] = MATTE_AXIS[direction], [a, b] = hide ? [0, off] : [off, 0];
    patch.matte = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]; patch.matteMode = 'keep';
    if (t0 > 0) put(0, { [prop]: a });
    put(t0, { [prop]: a }); put(t1, { [prop]: b }, ease);
  }
  keys.sort((x, y) => x.t - y.t);
  if (keys.length > 32) return fail(`this layer would have ${keys.length} keyframes; the limit is 32`);
  patch.keys = keys;
  return patchLayer(project, { sceneId, layerId, baseline, patch });
}
