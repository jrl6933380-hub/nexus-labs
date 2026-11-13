import './store/installFetch.js';
// Automatic stock photos for demo sites, so a demo looks finished from the first build.
// Searches Pixabay (and Pexels when its key is set) through the media broker, drops anything that could show minors,
// caches the shortlist per trade for a week, and picks a different run of photos per business so demos are not clones.
// Best effort: any failure returns [] and the demo falls back to its photo slots.
import { searchMedia } from './mediaBroker.js';

const KV_URL = process.env.KV_REST_API_URL, KV_TOKEN = process.env.KV_REST_API_TOKEN;
const TTL = 7 * 24 * 3600;
export const TRADE_QUERIES = [
  [/barber/i, 'barber haircut'], [/hair|salon|stylist/i, 'hair salon stylist'], [/nail/i, 'nail salon manicure'], [/tattoo/i, 'tattoo artist studio'],
  [/auto|mechanic|car repair/i, 'auto mechanic garage'], [/plumb/i, 'plumber repair'], [/electric/i, 'electrician wiring'], [/lawn|landscap/i, 'lawn care mowing'],
  [/clean|maid/i, 'house cleaning'], [/groom|pet/i, 'dog grooming salon'], [/restaurant|cafe|diner|grill/i, 'restaurant food'], [/gym|fitness/i, 'gym fitness training']
];
const UNSAFE = /\b(child|children|kid|kids|baby|babies|toddler|boy|boys|girl|girls|school|student|students|teen|teens|teenager|infant|nude|naked|sexy|erotic)\b/i;

async function redisCommand(command) {
  if (!KV_URL || !KV_TOKEN) throw new Error('no store');
  const res = await fetch(KV_URL, { method: 'POST', headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(command) });
  const data = await res.json();
  if (!res.ok || data.error) throw new Error('store failed');
  return data.result;
}
const fnv = s => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h >>> 0; };
export const queryFor = category => { const c = String(category || ''); const hit = TRADE_QUERIES.find(([re]) => re.test(c)); return hit ? hit[1] : ''; };

async function shortlist(query, { search, redis }) {
  const key = 'nexus:forge:stock:' + query.replace(/[^a-z]+/gi, '-').toLowerCase();
  try { const cached = await redis(['GET', key]); if (cached) { const v = JSON.parse(cached); if (Array.isArray(v) && v.length) return v; } } catch { /* search instead */ }
  const out = await search({ query, kind: 'photo', limit: 12, sources: ['pixabay', 'pexels'] }, { includeDownload: true });
  const list = (out.candidates || [])
    .filter(c => c.kind === 'photo' && c.download_url && c.credit && Number(c.width) >= 1000 && !UNSAFE.test(String(c.title || '')))
    .map(c => ({ url: c.download_url, alt: String(c.title || '').split(',').slice(0, 3).join(',').slice(0, 100) || 'Sample photo', credit: String(c.credit).slice(0, 120) }));
  if (list.length) { try { await redis(['SET', key, JSON.stringify(list), 'EX', String(TTL)]); } catch { /* cache is optional */ } }
  return list;
}

// Up to `count` credited stock photos for a trade, a different run for each business. [] when the trade is unknown or search fails.
export async function stockPhotosFor(category, seed, { search = searchMedia, redis = redisCommand, count = 5, timeoutMs = 7000 } = {}) {
  const query = queryFor(category);
  if (!query) return [];
  try {
    const list = await Promise.race([shortlist(query, { search, redis }), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs))]);
    if (!list.length) return [];
    const start = fnv(String(seed || '')) % list.length, n = Math.min(count, list.length);
    return Array.from({ length: n }, (_, i) => ({ ...list[(start + i) % list.length], stock: true }));
  } catch (e) { console.error('stock photos failed:', String(e?.message || e).slice(0, 120)); return []; }
}
