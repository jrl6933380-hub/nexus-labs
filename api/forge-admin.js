// api/forge-admin.js
// Operator-only endpoint to seat the first Forge manager/worker
// accounts. There's no real admin console yet (see MVP scope item 2
// on the board — manager-created campaigns/assignment is still
// ahead) — this is just enough to unblock a real caller today.
//
// Auth: reuses the existing Room session cookie, and only proceeds if
// the signed-in user is an operator (roomAuth.isOperatorUser — the
// same allowlist that gates the Nex dock). Anyone else gets a 403.

import { getRequestUser, isOperatorUser, listUsers, createSession, destroySession, parseCookies, serializeSessionCookie, SESSION_COOKIE } from '../lib/roomAuth.js';
import { getNexusOwner } from '../lib/nexusOwnerAuth.js';
import { getConnection } from '../lib/forge/brainStore.js';
import { setForgeRole, FORGE_ROLES } from '../lib/forgeRoles.js';
import { provisionForgeAccount } from '../lib/forgeAccounts.js';
const TRACKED_KEY = 'nexus:forge:tracked-developers';
async function trackedCommand(command) {
  const response = await fetch(process.env.KV_REST_API_URL, { method:'POST',
    headers:{ Authorization:`Bearer ${process.env.KV_REST_API_TOKEN}`, 'Content-Type':'application/json' },
    body:JSON.stringify(command) });
  const data = await response.json();
  if (!response.ok || data.error) throw new Error('Could not update the developer account list.');
  return data.result;
}

// Account creation itself lives in lib/forgeAccounts.js so this endpoint
// and Nex's create_forge_account tool provision accounts identically
// (same recovery-field handling, same atomic create, same operator
// ceiling) instead of drifting apart.

const ROLE_TO_KIND = {
  [FORGE_ROLES.WORKER]: 'worker',
  [FORGE_ROLES.MANAGER]: 'manager',
};

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // The private Nexus owner can inspect and enter only accounts provisioned
  // for development through Nexus. Ordinary customers cannot use this path.
  const owner = await getNexusOwner(req).catch(() => null);
  if (req.method === 'GET') {
    if (!owner) return res.status(401).json({ error: 'Nexus owner access required.' });
    const users = await listUsers();
    const tracked = new Set(await trackedCommand(['SMEMBERS', TRACKED_KEY]) || []);
    const developers = users.filter((user) => /^forge-[a-f0-9]{8}@nexus-forge\.internal$/u.test(user.email || '')
      && !user.stripeCustomerId && !isOperatorUser(user.username));
    const accounts = await Promise.all(developers.slice(0, 60).map(async (user) => ({
      username: user.username, plan: user.plan, role: user.forgeRole || null,
      tracked: tracked.has(user.username), billed: Boolean(user.stripeCustomerId),
      brainConnected: Boolean((await getConnection(user.username).catch(() => null))?.connected),
    })));
    return res.status(200).json({ accounts });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { action, targetUsername, password, role } = req.body || {};
  if (['create_developer', 'track_developer', 'untrack_developer', 'switch_developer', 'return_to_owner'].includes(action)) {
    if (!owner) return res.status(401).json({ error: 'Nexus owner access required.' });
    try {
      const previous = parseCookies(req)[SESSION_COOKIE];
      if (action === 'return_to_owner') {
        await destroySession(previous);
        res.setHeader('Set-Cookie', serializeSessionCookie(null, { clear: true }));
        return res.status(200).json({ ok: true });
      }
      if (action === 'create_developer') {
        const account = await provisionForgeAccount({ username: targetUsername, kind: 'customer' });
        await trackedCommand(['SADD', TRACKED_KEY, account.username]);
        return res.status(200).json({ username: account.username, password: account.password });
      }
      const candidate = (await listUsers()).find((user) => user.username === targetUsername);
      if (!candidate || candidate.stripeCustomerId || isOperatorUser(candidate.username)
        || !/^forge-[a-f0-9]{8}@nexus-forge\.internal$/u.test(candidate.email || '')) {
        return res.status(403).json({ error: 'Only internally provisioned, unbilled developer accounts can be tracked for testing.' });
      }
      if (action === 'track_developer' || action === 'untrack_developer') {
        await trackedCommand([action === 'track_developer' ? 'SADD' : 'SREM', TRACKED_KEY, candidate.username]);
        return res.status(200).json({ username:candidate.username, tracked:action === 'track_developer' });
      }
      const tracked = await trackedCommand(['SISMEMBER', TRACKED_KEY, candidate.username]);
      if (!tracked) {
        return res.status(403).json({ error: 'Track this account as a developer before opening it.' });
      }
      const token = await createSession(candidate.username);
      await destroySession(previous);
      res.setHeader('Set-Cookie', serializeSessionCookie(token));
      return res.status(200).json({ username: candidate.username });
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Developer account action failed.' });
    }
  }

  const username = await getRequestUser(req);
  if (!username || !isOperatorUser(username)) {
    return res.status(403).json({ error: 'Operator access required.' });
  }

  if (!targetUsername) return res.status(400).json({ error: 'targetUsername is required.' });
  if (role !== null && !Object.values(FORGE_ROLES).includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${Object.values(FORGE_ROLES).join(', ')}, or null to clear it.` });
  }

  try {
    if (action === 'create') {
      if (typeof password !== 'string' || password.length < 8) {
        return res.status(400).json({ error: 'Password must be at least 8 characters — you set this, so pick something you can send them.' });
      }
      const account = await provisionForgeAccount({
        username: targetUsername,
        kind: ROLE_TO_KIND[role] || 'customer',
        password,
      });
      return res.status(200).json({ username: account.username, role: account.role });
    }
    const result = await setForgeRole(targetUsername, role);
    return res.status(200).json(result);
  } catch (err) {
    console.error('forge-admin handler failed:', err.message);
    return res.status(400).json({ error: err.message || 'Request failed.' });
  }
}
