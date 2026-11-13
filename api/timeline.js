// Timeline: GET (owner session or internal agent token) lists entries; POST saves one (owner only, from the Agent Board).
import crypto from 'node:crypto';
import { getNexusOwner } from '../lib/nexusOwnerAuth.js';
import { addEntry, listEntries } from '../lib/timeline.js';

function agentAuthorized(req) {
  const expected = process.env.NEXUS_AGENT_API_TOKEN;
  const header = String(req.headers?.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!expected || !supplied) return false;
  const h = s => crypto.createHash('sha256').update(s).digest();
  return crypto.timingSafeEqual(h(expected), h(supplied));
}
function sameOrigin(req) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site' || !origin) return false;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
export function createTimelineHandler(d = {}) {
  const { owner = getNexusOwner, agent = agentAuthorized, add = addEntry, list = listEntries } = d;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const o = await Promise.resolve(owner(req)).catch(() => null);
      const isAgent = agent(req);
      if (!o && !isAgent) return res.status(401).json({ error: 'Nexus owner session or internal agent token required' });
      if (req.method === 'GET') return res.status(200).json({ entries: await list(req.query?.limit) });
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method Not Allowed' }); }
      if (!o) return res.status(403).json({ error: 'Agents add to the timeline with a board message starting with [TIMELINE].' });
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Open the Agent Board.' });
      const out = await add({ by: 'justin', did: req.body?.did, next: req.body?.next, kind: 'save' });
      if (out.error) return res.status(400).json({ error: out.error });
      return res.status(200).json({ entry: out.entry });
    } catch (e) { console.error('timeline failed:', String(e?.message || e).slice(0, 160)); return res.status(500).json({ error: 'Timeline unavailable.' }); }
  };
}
export default createTimelineHandler();
