// Dependencies are supplied by api/board.js so these access rules can be tested without storage.
export function createBoardAccessGuard({getOwner, agentAuthorized}) {
  return async function authorizeBoard(req, res) {
    res.setHeader('Cache-Control', 'private, no-store');
    const owner = await getOwner(req).catch(() => null);
    const internal = agentAuthorized(req);
    if (!owner && !internal) { res.status(401).json({error:'Nexus owner or internal agent authentication required.'}); return null; }
    if (req.method === 'POST') {
      const origin = req.headers?.origin;
      let wrongOrigin = false;
      if (origin) { try { wrongOrigin = new URL(origin).host !== req.headers?.host; } catch { wrongOrigin = true; } }
      if (wrongOrigin || req.headers?.['sec-fetch-site'] === 'cross-site') { res.status(403).json({error:'Open the Agent Board on this Nexus site.'}); return null; }
      if (!String(req.headers?.['content-type'] || '').toLowerCase().startsWith('application/json')) { res.status(415).json({error:'Use application/json.'}); return null; }
      if (req.body?.action === 'add_note' && !owner) { res.status(403).json({error:'Only the owner can add owner notes.'}); return null; }
    }
    return {owner, internal};
  };
}
