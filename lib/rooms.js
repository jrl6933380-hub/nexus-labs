// /lib/rooms.js
// Room registry for Nex. Built-in rooms are always available, while a seeded
// Supabase `rooms` table can add project-specific rooms later.

const FALLBACK_ROOMS = [
  { slug: 'command-center', name: 'Command Center', description: 'The main Nexus Board: active work, agent status, and the Nex command dock.', url: '/mission-control.html', aliases: ['board', 'dashboard', 'home', 'mission control', 'main room'] },
  { slug: 'conference-room', name: 'Conference Room', description: 'Live round-table view of Nex and the available agents.', url: '/conference-room.html', aliases: ['conference', 'war room', 'round table', 'agent room'] },
  // NEXUS FORGE is the umbrella product/business, not a single page.
  // It spans three surfaces:
  //   - Forge Builder (/room.html)        -- this entry, the build tool
  //   - Forge Field   (/forge-caller.html)    -- worker lead/calling UI
  //   - Forge Ops     (/forge-dashboard.html) -- operator/manager view
  // The builder is the TOOL INSIDE the Forge business, which is why
  // it's "Forge Builder" rather than plain "Nexus Forge" -- calling
  // this one page "Nexus Forge" would wrongly imply the caller and
  // operator surfaces are something else.
  //
  // slug ('room-builder') and url ('/room.html') deliberately unchanged:
  // they're load-bearing in stored canvas state, saved panel keys, and
  // existing links. Old names stay in aliases so "room builder" still
  // resolves here.
  { slug: 'room-builder', name: 'Forge Builder', description: 'The build tool inside Nexus Forge \u2014 create and live-edit a custom room, site, tool, or client experience with Nex. Formerly called Room Builder. Part of the Nexus Forge product alongside Forge Field (caller workspace) and Forge Ops (operator dashboard).', url: '/room.html', aliases: ['forge builder', 'room builder', 'builder', 'canvas', 'live canvas', 'page builder', 'build room', 'workbench', 'site builder'] },
  { slug: 'forge-field', name: 'Forge Field', description: 'Nexus Forge worker workspace \u2014 assigned leads, business intelligence, generated site preview, pitch guide, and tap-to-call with outcome logging.', url: '/forge-caller.html', aliases: ['forge caller', 'caller', 'field', 'leads', 'lead queue', 'calling', 'worker view'] },
  { slug: 'forge-ops', name: 'Forge Ops', description: 'Nexus Forge operator/manager dashboard \u2014 customer accounts, plans, usage, billing status, and granting credits.', url: '/forge-dashboard.html', aliases: ['forge dashboard', 'forge ops', 'operator dashboard', 'forge admin', 'manager view'] },
  { slug: 'story-studio', name: 'Story Studio', description: 'Turn a rights-cleared chapter into an editable comic sequence with character and visual continuity.', url: '/story-studio.html', aliases: ['story', 'comic', 'comic builder', 'comic studio', 'writing studio', 'book to comic'] },
  { slug: 'memory-archive', name: 'Memory Archive', description: 'Search and manage Nex’s durable project and operating memories.', url: '/memory.html', aliases: ['memory', 'memories', 'archive', 'brain'] },
  { slug: 'approval-queue', name: 'Approval Queue', description: 'Review actions that need Justin’s explicit approval before they run.', url: '/queue.html', aliases: ['approvals', 'approval', 'queue', 'review queue'] },
  { slug: 'connector-bay', name: 'Connector Bay', description: 'View the connected services and capabilities available to the Nexus workspace.', url: '/connectors.html', aliases: ['connectors', 'connections', 'tools', 'integrations'] },
  { slug: 'tenant-hub', name: 'Tenant Hub', description: 'Manage hosted and bring-your-own provider workspaces, usage, and connections.', url: '/tenants.html', aliases: ['tenants', 'workspace', 'workspaces', 'accounts'] },
];

function normalize(value) {
  return String(value || '').trim().toLowerCase().replace(/\.html$/u, '').replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '');
}
function normalizeAliases(value) { return [...new Set((Array.isArray(value) ? value : []).map(normalize).filter(Boolean))]; }
function toRoom(record) {
  const slug = normalize(record.slug || record.id || record.name);
  if (!slug) return null;
  const route = record.url || record.route || record.path || (slug === 'conference-room' ? '/conference-room.html' : null);
  if (!route || !String(route).startsWith('/')) return null;
  return { slug, name: String(record.name || record.title || slug.replace(/-/gu, ' ')).trim(), description: String(record.description || record.summary || ''), url: String(route), aliases: normalizeAliases(record.aliases) };
}
function dedupe(rooms) { return [...new Map(rooms.filter(Boolean).map((room) => [room.slug, room])).values()]; }
async function fetchSupabaseRooms() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !key || typeof fetch !== 'function') return [];
  const response = await fetch(`${url.replace(/\/$/u, '')}/rest/v1/rooms?select=*`, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
  if (!response.ok) throw new Error(`Room registry unavailable (HTTP ${response.status})`);
  const rows = await response.json();
  return Array.isArray(rows) ? rows.map(toRoom).filter(Boolean) : [];
}
export async function listRooms({ fetchRemote = true } = {}) {
  let remoteRooms = [];
  if (fetchRemote) { try { remoteRooms = await fetchSupabaseRooms(); } catch (error) { console.warn('rooms: falling back to built-in registry:', error.message); } }
  return dedupe([...remoteRooms, ...FALLBACK_ROOMS.map(toRoom).filter(Boolean)]);
}
export async function getRoom(reference, options) {
  const needle = normalize(reference);
  if (!needle) return null;
  const rooms = await listRooms(options);
  return rooms.find((room) => room.slug === needle || normalize(room.name) === needle || (room.aliases || []).includes(needle)) || null;
}
