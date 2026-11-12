// Demo links. GET ?t=<token> is public and read-only: it returns only the lead's business name and its saved previews.
// POST (Forge account on that lead, or a manager) creates or revokes the lead's link. Nothing is ever sent from here.
import '../lib/store/installFetch.js';
import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeWorker, isForgeManager } from '../lib/forgeRoles.js';
import { getLead } from '../lib/forgeLeads.js';
import { createLink, revokeLink, getLink, allowView, TOKEN_RE } from '../lib/forgeDemoLinks.js';

const MAX_HTML = 400000;
const clientIp = req => String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
function sameOrigin(req) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site') return false;
  if (!origin) return false;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
export function looksOf(lead) {
  const variants = (Array.isArray(lead?.siteVariants) ? lead.siteVariants : []).filter(v => v && typeof v.html === 'string' && v.html.length && v.html.length <= MAX_HTML).slice(0, 3)
    .map(v => ({ id: String(v.id || '').slice(0, 40), label: String(v.label || v.id || 'Look').slice(0, 40), html: v.html }));
  if (variants.length) return variants;
  if (typeof lead?.siteHtml === 'string' && lead.siteHtml.length && lead.siteHtml.length <= MAX_HTML) return [{ id: 'main', label: 'Preview', html: lead.siteHtml }];
  return [];
}

export function createForgeDemoHandler(d = {}) {
  const { user = getRequestUser, worker = isForgeWorker, manager = isForgeManager, lead = getLead, create = createLink, revoke = revokeLink, link = getLink, allow = allowView } = d;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      if (req.method === 'GET') {
        const t = String(req.query?.t || '');
        if (!TOKEN_RE.test(t)) return res.status(404).json({ error: 'This demo link is not available.' });
        if (!(await allow(clientIp(req)))) return res.status(429).json({ error: 'Too many views. Try again in a minute.' });
        const rec = await link(t);
        const l = rec && await lead(rec.leadId);
        const looks = l ? looksOf(l) : [];
        if (!looks.length) return res.status(404).json({ error: 'This demo link is not available.' });
        return res.status(200).json({ name: String(l.businessName || '').slice(0, 100), looks });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return res.status(405).json({ error: 'Method Not Allowed' }); }
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Open Nexus Forge.' });
      if (!/^application\/json(?:;|$)/i.test(req.headers?.['content-type'] || '')) return res.status(415).json({ error: 'JSON required.' });
      const username = await user(req);
      if (!username) return res.status(401).json({ error: 'Sign in required.' });
      const [isWorker, isManager] = await Promise.all([worker(username), manager(username)]);
      if (!isWorker) return res.status(403).json({ error: 'Not a Forge account.' });
      const { leadId, action } = req.body || {};
      const l = typeof leadId === 'string' && leadId ? await lead(leadId) : null;
      if (!l) return res.status(404).json({ error: 'No such lead.' });
      if (!(isManager || l.assignedTo === username)) return res.status(403).json({ error: 'This lead is not assigned to you.' });
      if (action === 'revoke') return res.status(200).json(await revoke(l.id));
      if (action !== 'create') return res.status(400).json({ error: 'action must be "create" or "revoke".' });
      if (!looksOf(l).length) return res.status(400).json({ error: 'Build the previews first, then share them.' });
      const { token, reused } = await create(l.id, username);
      return res.status(200).json({ path: '/demo.html?t=' + token, reused, days: 30 });
    } catch (e) { console.error('forge-demo failed:', String(e?.message || e).slice(0, 160)); return res.status(500).json({ error: 'Demo link unavailable.' }); }
  };
}
export default createForgeDemoHandler();
