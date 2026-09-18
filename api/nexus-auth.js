// Dedicated Nexus launch-station authentication. Forge accounts and cookies
// are deliberately not imported here.

import crypto from 'node:crypto';
import {
  NEXUS_OWNER_COOKIE,
  clearOwnerLoginAttempts,
  consumeOwnerLoginAttempt,
  createOwnerSession,
  destroyOwnerSession,
  getNexusOwner,
  issueOwnerSetupTicket,
  ownerPasswordIsSet,
  parseCookies,
  serializeOwnerCookie,
  setOwnerPasswordWithTicket,
  verifyOwnerPassword,
} from '../lib/nexusOwnerAuth.js';

function safeEqual(left, right) {
  const a = crypto.createHash('sha256').update(String(left || '')).digest();
  const b = crypto.createHash('sha256').update(String(right || '')).digest();
  return crypto.timingSafeEqual(a, b);
}

function internalAgentAuthorized(req) {
  const expected = process.env.NEXUS_AGENT_API_TOKEN;
  const header = String(req.headers?.authorization || '');
  const supplied = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  return Boolean(expected && supplied && safeEqual(supplied, expected));
}

function requestIdentity(req) {
  return String(req.headers?.['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  try {
    if (req.method === 'GET') {
      const owner = await getNexusOwner(req);
      if (!owner) return res.status(401).json({ authenticated: false, setupRequired: !(await ownerPasswordIsSet()) });
      return res.status(200).json({ authenticated: true, owner });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { action, password, ticket } = req.body || {};

    if (action === 'issue_setup_link') {
      if (!internalAgentAuthorized(req)) return res.status(401).json({ error: 'Internal agent authorization required.' });
      const issued = await issueOwnerSetupTicket();
      const base = String(process.env.NEXUS_PUBLIC_URL || 'https://nexus-labs-sigma.vercel.app').replace(/\/$/u, '');
      return res.status(200).json({
        setupUrl: `${base}/nexus-login.html?setup=${encodeURIComponent(issued.ticket)}`,
        mode: issued.mode,
        expiresIn: issued.expiresIn,
      });
    }

    if (action === 'setup') {
      const owner = await setOwnerPasswordWithTicket(ticket, password);
      const token = await createOwnerSession();
      res.setHeader('Set-Cookie', serializeOwnerCookie(token));
      return res.status(200).json({ authenticated: true, owner });
    }

    if (action === 'login') {
      const identity = requestIdentity(req);
      if (!(await consumeOwnerLoginAttempt(identity))) {
        return res.status(429).json({ error: 'Too many attempts. Wait a few minutes and try again.' });
      }
      const owner = await verifyOwnerPassword(password);
      if (!owner) return res.status(401).json({ error: 'Wrong Nexus password.' });
      await clearOwnerLoginAttempts(identity);
      const token = await createOwnerSession();
      res.setHeader('Set-Cookie', serializeOwnerCookie(token));
      return res.status(200).json({ authenticated: true, owner });
    }

    if (action === 'logout') {
      await destroyOwnerSession(parseCookies(req)[NEXUS_OWNER_COOKIE]);
      res.setHeader('Set-Cookie', serializeOwnerCookie(null, { clear: true }));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (error) {
    console.error('nexus-auth:', error.message);
    const expected = /password|setup link|already been created|invalid or expired/iu.test(error.message);
    return res.status(expected ? 400 : 500).json({ error: expected ? error.message : 'Could not authenticate with Nexus.' });
  }
}

