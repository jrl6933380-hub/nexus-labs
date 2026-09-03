// api/room-history.js
// Read access to a signed-in user's saved live-canvas room builds (see
// lib/roomHistory.js). Requires a valid session — see lib/roomAuth.js.
// GET with no query -> list of that user's past builds (metadata only, no html).
// GET ?id=<id>      -> one full saved build, including its html — only
//                      ever looked up within the caller's own history,
//                      so there's no cross-account access by id guessing.

import { listBuilds, getBuild } from '../lib/roomHistory.js';
import { getRequestUser } from '../lib/roomAuth.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const username = await getRequestUser(req);
  if (!username) {
    return res.status(401).json({ error: 'Sign in required' });
  }

  try {
    const { id } = req.query || {};
    if (id) {
      const build = await getBuild(username, id);
      if (!build) return res.status(404).json({ error: 'Build not found' });
      return res.status(200).json({ build });
    }
    const builds = await listBuilds(username);
    return res.status(200).json({ builds });
  } catch (err) {
    console.error('room-history handler crashed:', err.message);
    return res.status(500).json({ error: 'Failed to load room history' });
  }
}
