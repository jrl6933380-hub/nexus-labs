// Owner-only: builds three concept previews and a call pitch from one Places lead, and saves it to Forge leads. Nothing is sent or published.
import '../lib/store/installFetch.js';
import { resolveWorkspaceAccount } from '../lib/workspaceConnector.js';
import { buildFromPlace, readLead } from '../lib/placesBuild.js';
import { saveBuiltLead } from '../lib/placesSave.js';
import { stockPhotosFor } from '../lib/stockPhotos.js';

function sameOrigin(req) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  if (!origin) return true;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
const within = (promise, ms, what) => Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error(what + ' timed out.'), { status: 504 })), ms))]);
export function createForgePlacesBuildHandler({ resolveAccount = resolveWorkspaceAccount, build = buildFromPlace, save = saveBuiltLead, stock = stockPhotosFor } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    try {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
      if (!sameOrigin(req) || !req.headers?.origin) return res.status(403).json({ error: 'Open Nexus Forge.' });
      if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return res.status(415).json({ error: 'JSON required.' });
      const owner = await within(resolveAccount(req), 8000, 'Sign-in check');
      if (owner?.owner !== true) return res.status(403).json({ error: 'Owner only.' });
      const b = req.body;
      if (!b || typeof b !== 'object' || Array.isArray(b)) return res.status(400).json({ error: 'Invalid request.' });
      const l = readLead(b);
      const photos = await stock(l.business, l.name).catch(() => []);
      const built = build(b, { photos });
      let saved;
      try { saved = await within(save({ lead: readLead(b), built, createdBy: owner.username || owner.name }), 15000, 'Saving the lead'); }
      catch (e) { console.error('forge-places save failed:', String(e?.message || e).slice(0, 200)); saved = { status: 'failed', message: 'Built, but could not save to Forge leads.' }; }
      return res.status(200).json({ ...built, saved });
    } catch (e) { console.error('forge-places-build failed:', String(e?.message || e).slice(0, 200)); return res.status(e.status || 503).json({ error: e.status ? e.message : 'Build unavailable.' }); }
  };
}
export default createForgePlacesBuildHandler();
