// lib/rooms.js
// Lookup helper for navigable "rooms" on the live board (e.g. the
// conference room) — backed by a Supabase `rooms` table so adding a
// new space later is just an insert, no code changes. Raw REST calls
// to Supabase's PostgREST API rather than pulling in @supabase/supabase-js,
// matching this repo's existing pattern (lib/board.js, lib/roomAuth.js)
// of talking to a backing store directly over fetch instead of adding
// a client-library dependency.
//
// Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The rooms table
// has RLS enabled, so the service role key is required server-side —
// the anon key would not be able to read it.

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function assertConfigured() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  }
}

async function supabaseRequest(pathAndQuery) {
  assertConfigured();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${pathAndQuery}`, {
    headers: {
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Supabase request failed (${res.status}): ${text.slice(0, 300)}`);
  }
  return res.json();
}

// Look up a single room by its slug (e.g. "conference-room"). Returns
// null when no room matches — a miss is a normal outcome for a
// lookup, not an error condition.
export async function getRoom(slug) {
  if (!slug || typeof slug !== 'string') {
    throw new Error('getRoom requires a slug string.');
  }
  const rows = await supabaseRequest(
    `rooms?slug=eq.${encodeURIComponent(slug)}&select=slug,name,description,backdrop_url,view_config&limit=1`
  );
  return rows[0] || null;
}

// List every navigable room (lightweight fields only — enough for a
// menu/listing without pulling every row's full view_config).
export async function listRooms() {
  return supabaseRequest('rooms?select=slug,name,description&order=name.asc');
}
