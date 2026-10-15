// POST /api/connect-password  { password, email }
// Attaches a password and recovery email to the signed-in guest account, so
// the user can sign in later and keep their saved work. Only works for the
// account behind the current session, and never overwrites an existing
// password (see setGuestPassword).
import { getRequestUser, setGuestPassword } from '../lib/roomAuth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST.' });

  const username = await getRequestUser(req);
  if (!username) return res.status(401).json({ ok: false, error: 'Sign in first.' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  try {
    await setGuestPassword(username, body.password, body.email);
    return res.status(200).json({ ok: true });
  } catch (error) {
    return res.status(400).json({ ok: false, error: error.message });
  }
}
