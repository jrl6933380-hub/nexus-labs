// /lib/rooms.js
// Flexible "rooms" directory Nex can navigate Mr. Lopez to — backed by
// a Supabase table (public.rooms) so new rooms/pages can be added
// later (a plain SQL insert) without touching code or redeploying.
// Uses the project's anon/publishable key directly — that key is
// meant to be public/embeddable, unlike a service role key, so this
// is safe to ship as-is. RLS is not yet configured on this table, so
// treat rows as low-sensitivity nav metadata only (name/slug/url),
// never anything private.

const SUPABASE_URL = 'https://wocoqkifvqremlpuoobx.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_4gYler19_N1sNi0ThCaceg_td2QmqH6';

function headers() {
  return {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    'Content-Type': 'application/json',
  };
}

// Normalizes a spoken/typed room reference into a slug-ish term —
// "Conference Room" / "the conference room" / "take me to the
// conference room" all collapse to "conference-room" — so Nex can
// pass through roughly what Mr. Lopez said instead of needing the
// exact stored slug.
function normalize(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/^(take me to|go to|bring me to|show me|open)\s+/i, '')
    .replace(/^(the)\s+/i, '')
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Looks up one room by slug (exact match first, then a loose
// name/slug search so close phrasing still hits). Returns null if
// nothing matches — callers should treat that as "room doesn't
// exist yet", not an error.
export async function findRoom(query) {
  const slug = normalize(query);
  if (!slug) return null;

  const exactRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rooms?slug=eq.${encodeURIComponent(slug)}&select=*&limit=1`,
    { headers: headers() }
  );
  if (exactRes.ok) {
    const exact = await exactRes.json();
    if (exact.length) return exact[0];
  }

  const rawQuery = String(query || '').replace(/[%,]/g, '');
  const looseRes = await fetch(
    `${SUPABASE_URL}/rest/v1/rooms?or=(slug.ilike.*${encodeURIComponent(slug)}*,name.ilike.*${encodeURIComponent(rawQuery)}*)&select=*&limit=1`,
    { headers: headers() }
  );
  if (looseRes.ok) {
    const loose = await looseRes.json();
    if (loose.length) return loose[0];
  }

  return null;
}

// Lists every registered room (name, slug, description) — used so
// Nex can check what actually exists before claiming a room is
// available, or when Mr. Lopez asks what spaces there are.
export async function listRooms() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/rooms?select=slug,name,description&order=name.asc`,
    { headers: headers() }
  );
  if (!res.ok) return [];
  return res.json();
}

// Resolves the actual URL to navigate to: an explicit backdrop_url
// on the row if set, otherwise the convention every existing Nexus
// page follows (/{slug}.html).
export function roomUrl(room) {
  return room.backdrop_url || `/${room.slug}.html`;
}
