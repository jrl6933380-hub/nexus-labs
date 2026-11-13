// Photo finder for demo sites. Forge accounts only. Returns licensed, credited candidates from Pixabay and Openverse
// (Pexels too when its key is set). Nothing is saved here; the caller picks photos in the demo editor.
import '../lib/store/installFetch.js';
import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeWorker } from '../lib/forgeRoles.js';
import { searchMedia } from '../lib/mediaBroker.js';

function sameOrigin(req) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site' || !origin) return false;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
export function createForgePhotosHandler(d = {}) {
  const { user = getRequestUser, worker = isForgeWorker, search = (i, o) => searchMedia(i, o) } = d;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return res.status(405).json({ error: 'Method Not Allowed' }); }
    try {
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Open Nexus Forge.' });
      const username = await user(req);
      if (!username) return res.status(401).json({ error: 'Sign in required.' });
      if (!(await worker(username))) return res.status(403).json({ error: 'Not a Forge account.' });
      const query = String(req.body?.query || '').trim().slice(0, 80);
      if (query.length < 2) return res.status(400).json({ error: 'Type what to look for, like "barber haircut".' });
      const out = await search({ query, kind: 'photo', limit: 12, sources: ['pixabay', 'openverse', 'pexels'] }, { includeDownload: true });
      const photos = out.candidates.filter(c => c.kind === 'photo' && c.download_url && c.credit)
        .map(c => ({ id: c.id, thumb: c.thumb_url || c.download_url, url: c.download_url, alt: String(c.title || '').slice(0, 100), credit: c.credit, license: c.license, source: c.source }));
      return res.status(200).json({ photos });
    } catch (e) {
      const bad = e?.status === 400;
      if (!bad) console.error('forge-photos failed:', String(e?.message || e).slice(0, 160));
      return res.status(bad ? 400 : 502).json({ error: bad ? e.message : 'Photo search is unavailable right now.' });
    }
  };
}
export default createForgePhotosHandler();
