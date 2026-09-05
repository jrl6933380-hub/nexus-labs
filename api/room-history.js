// api/room-history.js
// Read access to a signed-in user's saved live-canvas room builds (see
// lib/roomHistory.js). Requires a valid session — see lib/roomAuth.js.
// GET with no query -> list of that user's past builds (metadata only, no html).
// GET ?id=<id>      -> one full saved build, including its html — only
//                      ever looked up within the caller's own history,
//                      so there's no cross-account access by id guessing.

import { listBuilds, getBuild } from '../lib/roomHistory.js';
import { getRequestUser } from '../lib/roomAuth.js';

// Dependencies are injectable so ownership is exercised through the real handler.
export function createHistoryHandler({ resolveUser = getRequestUser, readBuild = getBuild, readList = listBuilds } = {}) {
return async function handler(req, res) {
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
  const username = await resolveUser(req);
  if (!username) {
    return res.status(401).json({ error: 'Sign in required' });
  }

    const { id, download } = req.query || {};
    if ((id !== undefined && (typeof id !== 'string' || !id || id.length > 200)) ||
        (download !== undefined && download !== 'html')) {
      return res.status(400).json({ error: 'Invalid export request' });
    }
    if (download && !id) return res.status(400).json({ error: 'Build id required' });
    if (id) {
      const build = await readBuild(username, id);
      if (!build) return res.status(404).json({ error: 'Build not found' });
      if (download === 'html') {
        if (typeof build.html !== 'string') throw new Error('Build HTML unavailable');
        // Never use a model-authored label or request input as a header/filename.
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', 'attachment; filename="nexus-build.html"');
        res.setHeader('Content-Security-Policy', "sandbox; default-src 'none'");
        return res.status(200).send(build.html);
      }
      return res.status(200).json({ build });
    }
    const builds = await readList(username);
    return res.status(200).json({ builds });
  } catch (err) {
    console.error('room-history handler crashed:', err.message);
    return res.status(500).json({ error: 'Failed to load room history' });
  }
};
}

export default createHistoryHandler();
