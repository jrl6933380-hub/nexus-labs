// Dedicated Nexus launch-station authentication. Forge accounts and cookies
// are deliberately not imported here.

import crypto from 'node:crypto';
import {
  NEXUS_OWNER_COOKIE,
  clearOwnerLoginAttempts,
  consumeOwnerLoginAttempt,
  createOwnerSession,
  deviceHasOwnerPin,
  destroyOwnerSession,
  forgetOwnerDevice,
  getNexusOwner,
  issueOwnerSetupTicket,
  ownerPasswordIsSet,
  ownerPinIsSet,
  parseCookies,
  serializeDeviceCookie,
  serializeOwnerCookie,
  setOwnerPasswordWithTicket,
  trustOwnerDevice,
  verifyOwnerPassword,
  verifyOwnerPin,
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
      const pinAvailable = await deviceHasOwnerPin(req);
      if (!owner) return res.status(401).json({ authenticated: false, setupRequired: !(await ownerPasswordIsSet()), pinAvailable });
      return res.status(200).json({ authenticated: true, owner, pinAvailable, pinConfigured: await ownerPinIsSet() });
    }

    if (req.method !== 'POST') {
      res.setHeader('Allow', 'GET, POST');
      return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { action, password, ticket, pin } = req.body || {};

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
      return res.status(200).json({ authenticated: true, owner, pinConfigured: false });
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
      return res.status(200).json({ authenticated: true, owner, pinAvailable: await deviceHasOwnerPin(req) });
    }

    if (action === 'set_pin') {
      const owner = await getNexusOwner(req);
      if (!owner) return res.status(401).json({ error: 'Sign in to Nexus first.' });
      const device = await trustOwnerDevice(pin);
      res.setHeader('Set-Cookie', serializeDeviceCookie(device));
      return res.status(200).json({ ok: true });
    }

    if (action === 'pin_login') {
      const owner = await verifyOwnerPin(req, pin);
      if (owner?.locked) return res.status(429).json({ error: 'Too many code attempts. Try later or use your Nexus password.' });
      if (!owner) return res.status(401).json({ error: 'Wrong Nexus code.' });
      const token = await createOwnerSession();
      res.setHeader('Set-Cookie', serializeOwnerCookie(token));
      return res.status(200).json({ authenticated: true, owner });
    }

    if (action === 'lock') {
      await destroyOwnerSession(parseCookies(req)[NEXUS_OWNER_COOKIE]);
      res.setHeader('Set-Cookie', serializeOwnerCookie(null, { clear: true }));
      return res.status(200).json({ ok: true });
    }

    if (action === 'logout') {
      await destroyOwnerSession(parseCookies(req)[NEXUS_OWNER_COOKIE]);
      await forgetOwnerDevice(req);
      res.setHeader('Set-Cookie', [serializeOwnerCookie(null, { clear: true }), serializeDeviceCookie(null, { clear: true })]);
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (error) {
    console.error('nexus-auth:', error.message);
    const expected = /password|four digits|setup link|already been created|invalid or expired/iu.test(error.message);
    return res.status(expected ? 400 : 500).json({ error: expected ? error.message : 'Could not authenticate with Nexus.' });
  }
}
