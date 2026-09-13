// api/debug-neon-org.js
// One-time, operator-only lookup: asks Neon directly for the
// organization(s) the configured NEON_API_KEY belongs to. Exists
// purely to unblock finding the org ID that Neon's own mobile console
// UI doesn't surface anywhere obvious (confirmed via several rounds
// of screenshots) \u2014 the key already lives server-side, this just
// asks Neon's API for it directly instead of hunting through menus.
//
// Safe to delete once the org ID is found and NEON_ORG_ID is set;
// this isn't meant to be a permanent endpoint.

import { getRequestUser, isOperatorUser } from '../lib/roomAuth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');

  const username = await getRequestUser(req);
  if (!username || !isOperatorUser(username)) {
    return res.status(403).json({ error: 'Operator access required.' });
  }

  const apiKey = process.env.NEON_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ error: 'NEON_API_KEY is not configured yet.' });
  }

  try {
    const r = await fetch('https://console.neon.tech/api/v2/users/me/organizations', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const text = await r.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!r.ok) {
      return res.status(502).json({ error: 'Neon API error', status: r.status, detail: data });
    }
    const organizations = (data?.organizations || []).map((org) => ({ id: org.id, name: org.name }));
    return res.status(200).json({ status: r.status, organizations, raw: organizations.length ? undefined : data });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Lookup failed.' });
  }
}
