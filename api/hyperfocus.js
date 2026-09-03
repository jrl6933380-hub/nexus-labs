// /api/hyperfocus.js
// HTTP surface for the Hyperfocus continuity plane (lib/hyperfocus.js),
// so any MCP-connected agent (Claude, ChatGPT, Nex) can reach it the
// same way they already reach the shared Board — GET to read, POST
// with an `action` field to write. Same shape as api/board.js.
//
// GET with no query -> list of active focuses (index view, no raw context)
// GET ?focus_id=X[&agent=Y][&tenant_id=Z][&project_id=W] -> read one focus
// POST { action: 'open' | 'publish' | 'append' | 'close', ...params }
//
// This endpoint is a thin router only — every safety property (secret
// redaction, untrusted-context wrapping, provenance stamping, version
// checks, lease rules) lives in lib/hyperfocus.js and is unchanged here.

import {
  openHyperfocus,
  publishChatContext,
  readHyperfocus,
  appendHyperfocusDelta,
  closeHyperfocus,
  listActiveHyperfocus,
} from '../lib/hyperfocus.js';

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const { focus_id, agent, tenant_id, project_id } = req.query || {};

      if (!focus_id) {
        const focuses = await listActiveHyperfocus();
        return res.status(200).json({ focuses });
      }

      const result = await readHyperfocus({ focus_id, agent, tenant_id, project_id });
      return res.status(200).json(result);
    }

    if (req.method === 'POST') {
      const { action, ...params } = req.body || {};
      if (!action) return res.status(400).json({ error: 'Missing action' });

      if (action === 'open') return res.status(200).json(await openHyperfocus(params));
      if (action === 'publish') return res.status(200).json(await publishChatContext(params));
      if (action === 'append') return res.status(200).json(await appendHyperfocusDelta(params));
      if (action === 'close') return res.status(200).json(await closeHyperfocus(params));

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method Not Allowed' });
  } catch (err) {
    console.error('hyperfocus handler crashed:', err.message);
    return res.status(500).json({ error: err.message });
  }
}
