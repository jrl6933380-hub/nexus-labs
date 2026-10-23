// The owner's bell API. GET lists alerts (owner only), POST {action:'read'} clears the unread count,
// and GET ?sweep=1 is the cron that flags unstarted or stuck waitlist builds (Vercel sends the cron secret).
import crypto from 'node:crypto';
import { getNexusOwner } from './nexusOwnerAuth.js';
import { alertStore } from './ownerAlerts.js';
import { sweepWaitlistAlerts } from './waitlistAlerts.js';

function cronAuthorized(req) {
  const expected = String(process.env.CRON_SECRET || '');
  const supplied = String(req.headers?.authorization || '').replace(/^Bearer\s+/u, '');
  if (!expected || !supplied) return false;
  const left = crypto.createHash('sha256').update(expected).digest();
  const right = crypto.createHash('sha256').update(supplied).digest();
  return crypto.timingSafeEqual(left, right);
}

export function createAlertsHandler({ getOwner = getNexusOwner, store = alertStore, sweep = sweepWaitlistAlerts, authorized = cronAuthorized } = {}) {
  return async function handleAlerts(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    const query = new URL(req.url || '/', 'http://local').searchParams;
    try {
      if (req.method === 'GET' && query.get('sweep')) {
        if (!authorized(req)) return res.status(401).json({ error: 'Alert sweep is not authorized' });
        return res.status(200).json(await sweep());
      }
      const owner = await getOwner(req).catch(() => null);
      if (!owner) return res.status(401).json({ error: 'Sign in to see alerts.' });
      if (req.method === 'GET') return res.status(200).json({ ok: true, ...(await store.list(Number(query.get('limit')) || 30)) });
      if (req.method === 'POST') {
        if ((req.body || {}).action !== 'read') return res.status(400).json({ error: 'Unknown alert action' });
        return res.status(200).json({ ok: true, ...(await store.markRead()) });
      }
      return res.status(405).json({ error: 'Method Not Allowed' });
    } catch (error) {
      console.error('alerts failed:', error.message);
      return res.status(503).json({ error: 'Alerts are unavailable right now.' });
    }
  };
}
