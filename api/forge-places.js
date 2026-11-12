// Owner-only lead search through the Google Places API. Read-only: nothing is saved, sent or published.
import '../lib/store/installFetch.js';
import { resolveWorkspaceAccount } from '../lib/workspaceConnector.js';
import { searchPlaces } from '../lib/placesLeads.js';

function sameOrigin(req) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  if (!origin) return true;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
export function createForgePlacesHandler({ resolveAccount = resolveWorkspaceAccount, search = searchPlaces } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      if (!sameOrigin(req) || !req.headers?.origin) return res.status(403).json({ error: 'Open Nexus Forge.' });
      if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return res.status(415).json({ error: 'JSON required.' });
      const owner = await resolveAccount(req);
      if (owner?.owner !== true) return res.status(403).json({ error: 'Owner only.' });
      const b = req.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'Invalid request.' });
      return res.status(200).json(await search({ business: b.business, city: b.city, count: b.count }));
    } catch (e) { return res.status(e.status || 503).json({ error: e.status ? e.message : 'Lead search unavailable.' }); }
  };
}
export default createForgePlacesHandler();
