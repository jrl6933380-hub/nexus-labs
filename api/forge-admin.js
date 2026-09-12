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

  const { targetUsername, role } = req.body || {};
  if (!targetUsername) return res.status(400).json({ error: 'targetUsername is required.' });
  if (role !== null && !Object.values(FORGE_ROLES).includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${Object.values(FORGE_ROLES).join(', ')}, or null to clear it.` });
  }

  try {
    const result = await setForgeRole(targetUsername, role);
    return res.status(200).json(result);
  } catch (err) {
    console.error('forge-admin handler failed:', err.message);
    return res.status(400).json({ error: err.message || 'Request failed.' });
  }
}
