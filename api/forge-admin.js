// api/forge-admin.js
// Operator-only endpoint to seat the first Forge manager/worker
// accounts. There's no real admin console yet (see MVP scope item 2
// on the board — manager-created campaigns/assignment is still
// ahead) — this is just enough to unblock a real caller today.
//
// Auth: reuses the existing Room session cookie, and only proceeds if
// the signed-in user is an operator (roomAuth.isOperatorUser — the
// same allowlist that gates the Nex dock). Anyone else gets a 403.

import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';
import { setForgeRole, FORGE_ROLES } from '../lib/forgeRoles.js';
import { provisionForgeAccount } from '../lib/forgeAccounts.js';

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

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const username = await getRequestUser(req);
  if (!username || !isOperatorUser(username)) {
    return res.status(403).json({ error: 'Operator access required.' });
  }

  const { action, targetUsername, password, role } = req.body || {};
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
