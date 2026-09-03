// api/room-auth.js
// Signup (invite-code gated), login, logout, and "who am I" for the
// live-canvas room's test-group accounts. See lib/roomAuth.js for the
// storage/session design.

import {
  createUser,
  verifyUser,
  createSession,
  destroySession,
  getRequestUser,
  parseCookies,
  serializeSessionCookie,
  SESSION_COOKIE,
} from '../lib/roomAuth.js';

export default async function handler(req, res) {
  if (req.method === 'GET') {
    // "me" check — used by room.html on load to decide whether to
    // redirect to the login page.
    try {
      const username = await getRequestUser(req);
      if (!username) return res.status(401).json({ error: 'Not signed in' });
      return res.status(200).json({ username });
    } catch (err) {
      console.error('room-auth: me check failed:', err.message);
      return res.status(500).json({ error: 'Could not check session' });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, username, password, inviteCode } = req.body || {};

  try {
    if (action === 'signup') {
      const user = await createUser(username, password, inviteCode);
      const token = await createSession(user.username);
      res.setHeader('Set-Cookie', serializeSessionCookie(token));
      return res.status(200).json({ username: user.username });
    }

    if (action === 'login') {
      const user = await verifyUser(username, password);
      if (!user) return res.status(401).json({ error: 'Wrong username or password.' });
      const token = await createSession(user.username);
      res.setHeader('Set-Cookie', serializeSessionCookie(token));
      return res.status(200).json({ username: user.username });
    }

    if (action === 'logout') {
      const cookies = parseCookies(req);
      await destroySession(cookies[SESSION_COOKIE]);
      res.setHeader('Set-Cookie', serializeSessionCookie(null, { clear: true }));
      return res.status(200).json({ ok: true });
    }

    return res.status(400).json({ error: 'Unknown action.' });
  } catch (err) {
    // createUser/verifyUser throw plain, already user-facing messages
    // for expected validation failures (bad invite code, taken
    // username, etc) — safe to surface directly rather than a generic
    // 500, but still logged for anything unexpected.
    console.error('room-auth error:', err.message);
    return res.status(400).json({ error: err.message || 'Something went wrong.' });
  }
}
