// Build orders. Caller (own lead) or manager: POST {leadId, lookId, notes} saves the look the prospect picked plus notes.
// GET: callers see their own leads' orders; managers see all. PATCH {leadId, status}: managers only.
import '../lib/store/installFetch.js';
import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeWorker, isForgeManager } from '../lib/forgeRoles.js';
import { getLead } from '../lib/forgeLeads.js';
import { sendEmail } from '../lib/emailSender.js';
import { saveOrder, listOrders, getOrder, setOrderStatus } from '../lib/forgeOrders.js';

function sameOrigin(req) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site' || !origin) return false;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
export function createForgeOrdersHandler(d = {}) {
  const { user = getRequestUser, worker = isForgeWorker, manager = isForgeManager, lead = getLead, save = saveOrder, list = listOrders, get = getOrder, setStatus = setOrderStatus, email = sendEmail } = d;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    try {
      const username = await user(req);
      if (!username) return res.status(401).json({ error: 'Sign in required.' });
      const [isWorker, isManager] = await Promise.all([worker(username), manager(username)]);
      if (!isWorker) return res.status(403).json({ error: 'Not a Forge account.' });
      if (req.method === 'GET') {
        const all = await list();
        return res.status(200).json({ orders: isManager ? all : all.filter(o => o.savedBy === username).map(({ leadId, lookLabel, status, updatedAt }) => ({ leadId, lookLabel, status, updatedAt })) });
      }
      if (req.method !== 'POST' && req.method !== 'PATCH') { res.setHeader('Allow', 'GET, POST, PATCH'); return res.status(405).json({ error: 'Method Not Allowed' }); }
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Open Nexus Forge.' });
      const body = req.body || {};
      if (req.method === 'PATCH') {
        if (!isManager) return res.status(403).json({ error: 'Forge admin access required.' });
        const out = await setStatus(String(body.leadId || ''), body.status, { liveUrl: body.liveUrl });
        if (out.error) return res.status(400).json({ error: out.error });
        // Tell the customer when their site goes live. Best effort: the rep can still text them from Ops.
        let emailed = false;
        if (body.status === 'live' && out.order.liveUrl) {
          try {
            const l = await lead(out.order.leadId);
            if (l?.email) { await email({ to: l.email, subject: `Your new website is live: ${out.order.businessName}`, html: `<p>Good news. Your new website is live:</p><p><a href="${out.order.liveUrl}">${out.order.liveUrl}</a></p><p>Questions or changes? Just reply to your rep.</p>` }); emailed = true; }
          } catch (e) { console.error('forge-orders live email failed:', String(e?.message || e).slice(0, 120)); }
        }
        return res.status(200).json({ order: out.order, emailed });
      }
      const l = typeof body.leadId === 'string' && body.leadId ? await lead(body.leadId) : null;
      if (!l) return res.status(404).json({ error: 'No such lead.' });
      if (!(isManager || l.assignedTo === username)) return res.status(403).json({ error: 'This lead is not assigned to you.' });
      const out = await save(l, { lookId: body.lookId, notes: body.notes, by: username });
      return out.error ? res.status(400).json({ error: out.error }) : res.status(200).json({ order: { leadId: out.order.leadId, lookLabel: out.order.lookLabel, status: out.order.status } });
    } catch (e) { console.error('forge-orders failed:', String(e?.message || e).slice(0, 160)); return res.status(500).json({ error: 'Orders unavailable.' }); }
  };
}
export default createForgeOrdersHandler();
