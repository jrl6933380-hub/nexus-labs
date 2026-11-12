// Validates caller edits to a demo site. Plain fields only; no AI involved.
const clip = (v, n) => String(v ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);

export function cleanCustomize(changes, paletteIds = []) {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) return { error: 'Nothing to change.' };
  const content = {}; let palette;
  for (const [k, max] of [['headline', 90], ['intro', 220], ['about', 600]]) if (changes[k] !== undefined) content[k] = clip(changes[k], max);
  if (changes.services !== undefined) {
    if (!Array.isArray(changes.services) || changes.services.length > 12) return { error: 'Services: up to 12 rows.' };
    content.services = changes.services.map(s => ({ name: clip(s?.name, 60), price: clip(s?.price, 20) })).filter(s => s.name);
  }
  if (changes.hours !== undefined) {
    if (!Array.isArray(changes.hours) || changes.hours.length > 7) return { error: 'Hours: up to 7 rows.' };
    content.hours = changes.hours.map(h => ({ day: clip(h?.day, 30), time: clip(h?.time, 40) })).filter(h => h.day && h.time);
  }
  if (changes.palette !== undefined) {
    const p = String(changes.palette || '');
    if (p && !paletteIds.includes(p)) return { error: 'Pick one of the listed colors.' };
    palette = p;
  }
  if (!Object.keys(content).length && palette === undefined) return { error: 'Nothing to change.' };
  return { content, palette };
}
