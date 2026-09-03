// api/room-history.js
// Read access to saved live-canvas room builds (see lib/roomHistory.js).
// GET with no query -> list of past builds (metadata only, no html).
// GET ?id=<id>      -> one full saved build, including its html.

import { listBuilds, getBuild } from '../lib/roomHistory.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { id } = req.query || {};
    if (id) {
      const build = await getBuild(id);
      if (!build) return res.status(404).json({ error: 'Build not found' });
      return res.status(200).json({ build });
    }
    const builds = await listBuilds();
    return res.status(200).json({ builds });
  } catch (err) {
    console.error('room-history handler crashed:', err.message);
    return res.status(500).json({ error: 'Failed to load room history' });
  }
}
