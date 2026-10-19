// Selection map colours: identification metadata, never artwork. Every layer id gets one flat colour; a picture rendered with these
// colours (player ?select=1) lets an agent ask "what is at this pixel?" and get a real layer id back.
// Colours come from the id itself (a hash), so the same id keeps the same colour as long as the set of ids does not change much.
// Greys are never used (black is the empty background and antialiasing blends towards grey), so a colour is never confused with "nothing".
export const SELECT_VERSION = 1;
function selHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function selPalette(levels) {
  const v = Array.from({ length: levels }, (_, i) => Math.round(i * 255 / (levels - 1))), out = [];
  for (const r of v) for (const g of v) for (const b of v) if (!(r === g && g === b)) out.push([r, g, b]);
  return out;
}
const PAL8 = selPalette(8), PAL16 = selPalette(16);
const selHex = (c) => '#' + c.map((n) => n.toString(16).padStart(2, '0')).join('');
// ids: array of strings. Returns hex colours aligned with the input. Layers that share an id (or have none) must be given distinct strings by the caller.
export function selectionColors(ids) {
  const pal = ids.length <= 400 ? PAL8 : PAL16, used = new Uint8Array(pal.length), out = new Array(ids.length);
  const order = ids.map((id, i) => [String(id), i]).sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
  for (const [id, i] of order) {
    let k = selHash(id) % pal.length, guard = 0;
    while (used[k] && guard++ < pal.length) k = (k + 1) % pal.length;
    used[k] = 1; out[i] = selHex(pal[k]);
  }
  return out;
}
export const parseHex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
