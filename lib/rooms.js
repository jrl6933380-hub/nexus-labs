// /lib/rooms.js
// Room registry for Nex. Built-in rooms are always available, while a seeded
// Supabase `rooms` table can add project-specific rooms later.

const FALLBACK_ROOMS = [
  {
    slug: 'command-center',
    name: 'Command Center',
    description: 'The main Nexus Board: active work, agent status, and the Nex command dock.',
    url: '/#command',
    aliases: ['board', 'dashboard', 'home', 'mission control', 'main room'],
  },
  {
    slug: 'conference-room',
    name: 'Conference Room',
    description: 'Live round-table view of Nex and the available agents.',
    url: '/#conference',
    aliases: ['conference', 'war room', 'round table', 'agent room'],
  },
  {
    slug: 'room-builder',
    name: 'Room Builder',
    description: 'Create and live-edit a custom room, site, tool, or client experience with Nex.',
    url: '/#builder',
    aliases: ['builder', 'canvas', 'live canvas', 'page builder', 'build room'],
  },
  {
    slug: 'memory-archive',
    name: 'Memory Archive',
    description: 'Search and manage Nex’s durable project and operating memories.',
    url: '/#memory',
    aliases: ['memory', 'memories', 'archive', 'brain'],
  },
  {
    slug: 'approval-queue',
    name: 'Approval Queue',
    description: 'Review actions that need Justin’s explicit approval before they run.',
    url: '/#queue',
    aliases: ['approvals', 'approval', 'queue', 'review queue'],
  },
  {
    slug: 'connector-bay',
    name: 'Connector Bay',
    description: 'View the connected services and capabilities available to the Nexus workspace.',
    url: '/#connectors',
    aliases: ['connectors', 'connections', 'tools', 'integrations'],
  },
  {
    slug: 'tenant-hub',
    name: 'Tenant Hub',
    description: 'Manage hosted and bring-your-own provider workspaces, usage, and connections.',
    url: '/#tenants',
    aliases: ['tenants', 'workspace', 'workspaces', 'accounts'],
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

function normalizeAliases(value) {
  return [...new Set((Array.isArray(value) ? value : []).map(normalize).filter(Boolean))];
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
    aliases: normalizeAliases(record.aliases),
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
  return dedupe([...remoteRooms, ...FALLBACK_ROOMS.map(toRoom).filter(Boolean)]);
}

export async function getRoom(reference, options) {
  const needle = normalize(reference);
  if (!needle) return null;
  const rooms = await listRooms(options);
  return rooms.find((room) =>
    room.slug === needle ||
    normalize(room.name) === needle ||
    (room.aliases || []).includes(needle)
  ) || null;
}
