// POST /api/connect  { name?: string, revoke?: boolean }
// Creates a passwordless guest account, starts a 30-day session, and returns
// the account's private connector address (no OAuth). The address only ever
// reaches that customer's own workspace, never the owner account.
// { revoke: true } kills the current address; the next call makes a new one.
import { createGuestUser, createSession, getRequestUser, isOperatorUser, serializeSessionCookie } from '../lib/roomAuth.js';
import { connectTokens } from '../lib/customerConnectToken.js';
import { allowConnect } from '../lib/connectRateLimit.js';

const ORIGIN = 'https://nexus-labs-sigma.vercel.app';
const mcpUrl = (token) => `${ORIGIN}/api/customer-mcp/${token}`;
const usernameOf = (user) => (typeof user === 'string' ? user : user?.username || user?.name || '');

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Use POST.' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (name.length > 80) return res.status(400).json({ ok: false, error: 'Name must be 80 characters or fewer.' });

  try {
    const existing = await getRequestUser(req);
    if (existing) {
      const username = usernameOf(existing);
      if (!username || isOperatorUser(username)) {
        return res.status(403).json({ ok: false, error: 'This is the owner account. Use a different browser to set up a customer connection.' });
      }
      if (body.revoke === true) {
        await connectTokens.revoke(username);
        return res.status(200).json({ ok: true, revoked: true });
      }
      const token = await connectTokens.ensure(username);
      return res.status(200).json({ ok: true, existing: true, mcp_url: mcpUrl(token) });
    }
    if (body.revoke === true) return res.status(200).json({ ok: true, revoked: false });

    if (!(await allowConnect(req))) {
      res.setHeader('Retry-After', '3600');
      return res.status(429).json({ ok: false, error: 'Too many new accounts from this network. Try again in an hour.' });
    }

    const { username } = await createGuestUser({ name });
    const session = await createSession(username);
    res.setHeader('Set-Cookie', serializeSessionCookie(session));
    const token = await connectTokens.ensure(username);
    return res.status(200).json({ ok: true, name: name || null, mcp_url: mcpUrl(token) });
  } catch (error) {
    console.error('connect guest account failed:', error.message);
    return res.status(503).json({ ok: false, error: 'Could not create your account right now. Try again.' });
  }
}
