// POST /api/connect  { name?: string }
// Creates a passwordless guest account, starts a 30-day session, and sets
// the session cookie. The session is what lets the user approve the
// workspace OAuth connection and open the Nexus board. A password can be
// added later via POST /api/connect-password on the same account.
import { createGuestUser, createSession, serializeSessionCookie } from '../lib/roomAuth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST.' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length > 80) return res.status(400).json({ ok: false, error: 'Name must be 80 characters or fewer.' });

  try {
    const { username } = await createGuestUser({ name });
    const token = await createSession(username);
    res.setHeader('Set-Cookie', serializeSessionCookie(token));
    return res.status(200).json({ ok: true, name: name || null });
  } catch (error) {
    console.error('connect guest account failed:', error.message);
    return res.status(503).json({ ok: false, error: 'Could not create your account right now. Try again.' });
  }
}
