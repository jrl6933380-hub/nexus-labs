// Customer support. Public (no login): GET ?t=<token> returns the business name; POST {t, name, contact, message} sends a message.
// Forge managers: GET list, POST {action:'link', key, businessName} makes a support link, PATCH {id, status} marks done.
import '../lib/store/installFetch.js';
import { getRequestUser } from '../lib/roomAuth.js';
import { isForgeManager } from '../lib/forgeRoles.js';
import { supportTokenFor, readToken, addMessage, listMessages, setMessageStatus, allowSend, TOKEN_RE } from '../lib/forgeSupport.js';
import { postMessage } from '../lib/board.js';

const clientIp = req => String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
function sameOrigin(req) {
  const origin = req.headers?.origin, host = req.headers?.host;
  if (req.headers?.['sec-fetch-site'] === 'cross-site' || !origin) return false;
  try { return Boolean(host && new URL(origin).host === host); } catch { return false; }
}
export function createForgeSupportHandler(d = {}) {
  const { user = getRequestUser, manager = isForgeManager, token = supportTokenFor, read = readToken, add = addMessage, list = listMessages, setStatus = setMessageStatus, allow = allowSend, notify = postMessage } = d;
  return async function handler(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    try {
      const body = req.body || {};
      if (req.method === 'GET' && req.query?.t !== undefined) {
        const t = String(req.query.t);
        const biz = TOKEN_RE.test(t) ? await read(t) : null;
        return biz ? res.status(200).json({ name: biz.businessName }) : res.status(404).json({ error: 'This support link is not valid.' });
      }
      if (req.method === 'GET' || req.method === 'PATCH' || (req.method === 'POST' && body.action === 'link')) {
        const username = await user(req);
        if (!username) return res.status(401).json({ error: 'Sign in required.' });
        if (!(await manager(username))) return res.status(403).json({ error: 'Forge admin access required.' });
        if (req.method === 'GET') return res.status(200).json({ messages: await list(req.query?.limit) });
        if (!sameOrigin(req)) return res.status(403).json({ error: 'Open Nexus Forge.' });
        if (req.method === 'PATCH') { const o = await setStatus(String(body.id || ''), body.status); return o.error ? res.status(400).json({ error: o.error }) : res.status(200).json({ message: o.entry }); }
        const key = String(body.key || '').trim();
        if (!key) return res.status(400).json({ error: 'key is required.' });
        const t = await token(key, body.businessName);
        return res.status(200).json({ path: '/support.html?s=' + t });
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST, PATCH'); return res.status(405).json({ error: 'Method Not Allowed' }); }
      // Public message from a customer.
      if (!sameOrigin(req)) return res.status(403).json({ error: 'Please use the support page.' });
      if (body.website) return res.status(200).json({ ok: true }); // honeypot: bots fill this, people never see it
      if (!(await allow(clientIp(req)))) return res.status(429).json({ error: 'Too many messages. Try again in an hour or call your rep.' });
      const out = await add(String(body.t || ''), { name: body.name, contact: body.contact, message: body.message });
      if (out.error) return res.status(out.status || 400).json({ error: out.error });
      Promise.resolve(notify({ from: 'support', message: `SUPPORT from ${out.entry.businessName || 'a customer'}${out.entry.name ? ' (' + out.entry.name + ')' : ''}: ${out.entry.message.slice(0, 240)}${out.entry.contact ? ' Reach them: ' + out.entry.contact : ''}` })).catch(() => {});
      return res.status(200).json({ ok: true });
    } catch (e) { console.error('forge-support failed:', String(e?.message || e).slice(0, 160)); return res.status(500).json({ error: 'Support is unavailable right now. Please call your rep.' }); }
  };
}
export default createForgeSupportHandler();
