// /lib/rooms.js
// Room registry for Nex. A seeded Supabase `rooms` table can supply future
// rooms when server-side credentials are configured; the known Conference Room
// remains available through this safe local fallback during outages/config gaps.

const FALLBACK_ROOMS = [
  {
    slug: 'conference-room',
    name: 'Conference Room',
    description: 'Live round-table view of Nex and the available agents.',
    url: '/conference-room.html',
  },
];

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.html$/u, '')
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-|-$/gu, '');
}

function toRoom(record) {
  const slug = normalize(record.slug || record.id || record.name);
  if (!slug) return null;
  const route = record.url || record.route || record.path || (slug === 'conference-room' ? '/conference-room.html' : null);
  if (!route || !String(route).startsWith('/')) return null;
  return {
    slug,
    name: String(record.name || record.title || slug.replace(/-/gu, ' ')).trim(),
    description: String(record.description || record.summary || ''),
    url: String(route),
  };
}

function dedupe(rooms) {
  return [...new Map(rooms.filter(Boolean).map((room) => [room.slug, room])).values()];
}

async function fetchSupabaseRooms() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key || typeof fetch !== 'function') return [];

  const response = await fetch(`${url.replace(/\/$/u, '')}/rest/v1/rooms?select=*`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
  });
  if (!response.ok) throw new Error(`Room registry unavailable (HTTP ${response.status})`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows.map(toRoom).filter(Boolean) : [];
}

export async function listRooms({ fetchRemote = true } = {}) {
  let remoteRooms = [];
  if (fetchRemote) {
    try {
      remoteRooms = await fetchSupabaseRooms();
    } catch (error) {
      // A room link should never disappear because the optional registry is down.
      console.warn('rooms: falling back to built-in registry:', error.message);
    }
  }
  return dedupe([...remoteRooms, ...FALLBACK_ROOMS]);
}

export async function getRoom(reference, options) {
  const needle = normalize(reference);
  if (!needle) return null;
  const rooms = await listRooms(options);
  return rooms.find((room) => room.slug === needle || normalize(room.name) === needle) || null;
}
