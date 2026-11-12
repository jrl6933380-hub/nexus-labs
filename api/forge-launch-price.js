// Forge Launch price. GET: any Forge account. POST: Forge Ops managers only; changes apply to new sign-ups.
import '../lib/store/installFetch.js';
import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeManager, isForgeWorker } from '../lib/forgeRoles.js';
import { getPricing, setPricing } from '../lib/forgeLaunchPrice.js';

function sameOrigin(req) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site' || !origin) return false;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
export function createForgePricingHandler(d = {}) {
  const { user = getRequestUser, manager = isForgeManager, worker = isForgeWorker, get = getPricing, set = setPricing } = d;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const username = await user(req);
      if (!username) return res.status(401).json({ error: 'Sign in required.' });
      if (req.method === 'GET') {
        if (!(await worker(username))) return res.status(403).json({ error: 'Not a Forge account.' });
        return res.status(200).json({ pricing: await get() });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method Not Allowed' }); }
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Open Nexus Forge.' });
      if (!(await manager(username))) return res.status(403).json({ error: 'Forge admin access required.' });
      const out = await set(req.body, username);
      if (out.error) return res.status(400).json({ error: out.error });
      return res.status(200).json({ pricing: out.pricing });
    } catch (e) { console.error('forge-launch-price failed:', String(e?.message || e).slice(0, 160)); return res.status(500).json({ error: 'Pricing unavailable.' }); }
  };
}
export default createForgePricingHandler();
